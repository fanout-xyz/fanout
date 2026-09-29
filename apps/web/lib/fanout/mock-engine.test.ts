import { beforeEach, describe, expect, it } from "vitest";
import { activeChain } from "@/lib/chains";
import { claimVerifyingContract } from "@/lib/config";
import { generateClaimKey, signClaim } from "./claim-keys";
import { emptyState, engine, type MockState } from "./mock-engine";
import { NotFoundError } from "./types";
import { fromWire, toWire } from "./wire";

const platform = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const payee = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const friend = "0xcccccccccccccccccccccccccccccccccccccccc";

// Sign exactly as the claim page does, against whichever ClaimEscrow the config points at.
const sign = (key: `0x${string}`, recipient: `0x${string}`) =>
  signClaim(key, { recipient, claimContract: claimVerifyingContract(), chainId: activeChain.id });

describe("mock engine", () => {
  let s: MockState;
  beforeEach(() => {
    s = emptyState();
  });

  it("runs deposit -> batch -> claim -> send -> refund end to end", async () => {
    engine.deposit(s, platform, 100_000_000n);
    const a = generateClaimKey();
    const b = generateClaimKey();
    const { batchId } = engine.createBatchPayout(s, platform, [
      { claimSigner: a.claimSigner, amount: 30_000_000n },
      { claimSigner: b.claimSigner, amount: 20_000_000n },
    ]);
    expect(engine.getTreasuryBalance(s, platform)).toBe(50_000_000n);
    expect(engine.getClaim(s, a.claimSigner)).toEqual({ amount: 30_000_000n, platform, status: "sent" });

    await engine.claim(s, a.claimSigner, payee, await sign(a.privateKey, payee));
    expect(engine.getPayeeBalance(s, payee)).toBe(30_000_000n);
    await expect(engine.claim(s, a.claimSigner, payee, await sign(a.privateKey, payee))).rejects.toThrow(/already been claimed/);

    engine.send(s, payee, friend, 10_000_000n);
    expect(engine.getPayeeBalance(s, payee)).toBe(20_000_000n);
    expect(engine.getPayeeHistory(s, payee).map((h) => h.kind)).toEqual(["sent", "received"]);

    engine.refundUnclaimed(s, platform, batchId);
    expect(engine.getTreasuryBalance(s, platform)).toBe(70_000_000n);
    expect(engine.getClaim(s, b.claimSigner).status).toBe("refunded");
    expect(engine.listBatches(s, platform)[0]).toMatchObject({ rowCount: 2, claimedCount: 1 });
  });

  it("rejects a signature made for a different recipient (front-running)", async () => {
    engine.deposit(s, platform, 10_000_000n);
    const a = generateClaimKey();
    engine.createBatchPayout(s, platform, [{ claimSigner: a.claimSigner, amount: 5_000_000n }]);
    await expect(engine.claim(s, a.claimSigner, friend, await sign(a.privateKey, payee))).rejects.toThrow(NotFoundError);
    expect(engine.getClaim(s, a.claimSigner).status).toBe("sent");
  });

  it("rejects payouts larger than the balance, and unknown batches", () => {
    engine.deposit(s, platform, 1_000_000n);
    expect(() => engine.createBatchPayout(s, platform, [{ claimSigner: generateClaimKey().claimSigner, amount: 2_000_000n }])).toThrow(/Not enough/);
    expect(() => engine.getBatch(s, "42")).toThrow(NotFoundError);
  });

  it("only lets the sender expire a payout", () => {
    engine.deposit(s, platform, 1_000_000n);
    const { batchId } = engine.createBatchPayout(s, platform, [{ claimSigner: generateClaimKey().claimSigner, amount: 1_000_000n }]);
    expect(() => engine.refundUnclaimed(s, friend, batchId)).toThrow(/Only the sender/);
  });

  it("requires sign-in for writes", () => {
    expect(() => engine.deposit(s, undefined, 1n)).toThrow(/Sign in/);
  });

  it("round-trips state with bigints through the wire format", () => {
    engine.deposit(s, platform, 123n);
    expect(fromWire<MockState>(toWire(s)).treasury[platform]).toBe(123n);
  });
});
