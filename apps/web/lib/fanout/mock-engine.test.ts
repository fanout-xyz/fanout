import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeChain } from "@/lib/chains";
import { claimVerifyingContract, config } from "@/lib/config";
import { generateClaimKey, signClaim } from "./claim-keys";
import { emptyState, engine, type MockState } from "./mock-engine";
import { MOCK_TEST_DOLLARS, TEST_DOLLARS_COOLDOWN_MS, TestDollarsCooldown } from "./test-dollars";
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

  it("simulates claims for the sender only, never more than are waiting", () => {
    engine.deposit(s, platform, 150_000_000n);
    const rows = Array.from({ length: 150 }, () => ({ claimSigner: generateClaimKey().claimSigner, amount: 1_000_000n }));
    const { batchId } = engine.createBatchPayout(s, platform, rows);
    expect(() => engine.simulateClaims(s, friend, batchId, 5)).toThrow(/Only the sender/);
    expect(() => engine.simulateClaims(s, platform, batchId, 0)).toThrow(/at least one/);

    expect(engine.simulateClaims(s, platform, batchId, 40)).toBe(40);
    expect(engine.getBatch(s, batchId).rows.filter((r) => r.status === "claimed")).toHaveLength(40);
    expect(engine.simulateClaims(s, platform, batchId, 500)).toBe(110);
    expect(engine.simulateClaims(s, platform, batchId, 1)).toBe(0);
    expect(engine.listBatches(s, platform)[0]).toMatchObject({ rowCount: 150, claimedCount: 150 });
    expect(engine.getPayeeBalance(s, rows[0].claimSigner)).toBe(1_000_000n);
  });

  it("requires sign-in for writes", () => {
    expect(() => engine.deposit(s, undefined, 1n)).toThrow(/Sign in/);
  });

  it("changes a payee's dollars to USDC 1:1, with history", async () => {
    engine.deposit(s, platform, 10_000_000n);
    const a = generateClaimKey();
    engine.createBatchPayout(s, platform, [{ claimSigner: a.claimSigner, amount: 5_000_000n }]);
    await engine.claim(s, a.claimSigner, payee, await sign(a.privateKey, payee));

    const { amountOut } = engine.receiveAsUsdc(s, payee, 2_000_000n);
    const scale = 10n ** BigInt(config.usdc.decimals - config.stablecoin.decimals);
    expect(amountOut).toBe(2_000_000n * scale);
    expect(engine.getPayeeBalance(s, payee)).toBe(3_000_000n);
    expect(engine.getPayeeUsdcBalance(s, payee)).toBe(2_000_000n * scale);
    expect(engine.getPayeeHistory(s, payee)[0]).toMatchObject({ kind: "sent", amount: 2_000_000n, toUsdc: true });

    expect(() => engine.receiveAsUsdc(s, payee, 4_000_000n)).toThrow(/Not enough/);
    expect(() => engine.receiveAsUsdc(s, payee, 0n)).toThrow(/more than/);
    expect(() => engine.receiveAsUsdc(s, undefined, 1n)).toThrow(/Sign in/);
    expect(engine.getPayeeUsdcBalance(s, friend)).toBe(0n);
  });

  it("sends without a fee: moves the payee's dollars and records both sides", async () => {
    engine.deposit(s, platform, 10_000_000n);
    const a = generateClaimKey();
    engine.createBatchPayout(s, platform, [{ claimSigner: a.claimSigner, amount: 5_000_000n }]);
    await engine.claim(s, a.claimSigner, payee, await sign(a.privateKey, payee));

    const result = engine.sendGasless(s, payee, friend, 2_000_000n);
    expect(result).toMatchObject({ gasless: true, txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(engine.getPayeeBalance(s, payee)).toBe(3_000_000n);
    expect(engine.getPayeeBalance(s, friend)).toBe(2_000_000n);
    expect(engine.getPayeeHistory(s, payee)[0]).toMatchObject({ kind: "sent", amount: 2_000_000n, counterparty: friend, txHash: result.txHash });
    expect(engine.getPayeeHistory(s, friend)[0]).toMatchObject({ kind: "received", amount: 2_000_000n, counterparty: payee });
  });

  it("refuses fee-free sends the token would refuse, moving nothing", () => {
    s.balances[payee] = 1_000_000n;
    expect(() => engine.sendGasless(s, payee, friend, 2_000_000n)).toThrow(/Not enough/);
    expect(() => engine.sendGasless(s, payee, friend, 0n)).toThrow(/more than/);
    expect(() => engine.sendGasless(s, payee, "0x1234" as `0x${string}`, 1n)).toThrow(/isn't valid/);
    expect(() => engine.sendGasless(s, payee, payee, 1n)).toThrow(/your own address/);
    expect(() => engine.sendGasless(s, undefined, friend, 1n)).toThrow(/Sign in/);
    expect(engine.getPayeeBalance(s, payee)).toBe(1_000_000n);
    expect(engine.getPayeeHistory(s, payee)).toEqual([]);
  });

  it("loads state saved before USDC balances existed", () => {
    const old: Partial<MockState> = { ...emptyState(), balances: { [payee]: 1_000_000n } };
    delete old.usdcBalances;
    const loaded = fromWire<MockState>(toWire(old));
    expect(engine.getPayeeUsdcBalance(loaded, payee)).toBe(0n);
    engine.receiveAsUsdc(loaded, payee, 1_000_000n);
    expect(engine.getPayeeUsdcBalance(loaded, payee)).toBeGreaterThan(0n);
  });

  describe("test dollars", () => {
    afterEach(() => vi.useRealTimers());

    it("credits $10,000 to the payout balance, once per account per day", () => {
      vi.useFakeTimers({ now: 1_800_000_000_000 });
      const first = engine.getTestDollars(s, platform);
      expect(first.amount).toBe(MOCK_TEST_DOLLARS);
      expect(MOCK_TEST_DOLLARS).toBe(10_000n * 10n ** BigInt(config.stablecoin.decimals));
      expect(engine.getTreasuryBalance(s, platform)).toBe(MOCK_TEST_DOLLARS);

      vi.advanceTimersByTime(TEST_DOLLARS_COOLDOWN_MS - 1);
      const err = (() => {
        try {
          engine.getTestDollars(s, platform);
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(TestDollarsCooldown);
      expect((err as TestDollarsCooldown).retryAt).toBe(1_800_000_000_000 + TEST_DOLLARS_COOLDOWN_MS);
      expect(engine.getTreasuryBalance(s, platform)).toBe(MOCK_TEST_DOLLARS);

      // Another account isn't held back by this one.
      engine.getTestDollars(s, friend);
      expect(engine.getTreasuryBalance(s, friend)).toBe(MOCK_TEST_DOLLARS);

      vi.advanceTimersByTime(1);
      engine.getTestDollars(s, platform);
      expect(engine.getTreasuryBalance(s, platform)).toBe(2n * MOCK_TEST_DOLLARS);
    });

    it("needs a signed-in account", () => {
      expect(() => engine.getTestDollars(s, undefined)).toThrow(/Sign in/);
    });

    it("works on state saved before test dollars existed, and saves the limit", () => {
      const old: Partial<MockState> = emptyState();
      delete old.testDollars;
      const loaded = fromWire<MockState>(toWire(old));
      engine.getTestDollars(loaded, platform);
      const reloaded = fromWire<MockState>(toWire(loaded));
      expect(() => engine.getTestDollars(reloaded, platform)).toThrow(TestDollarsCooldown);
    });
  });

  it("round-trips state with bigints through the wire format", () => {
    engine.deposit(s, platform, 123n);
    expect(fromWire<MockState>(toWire(s)).treasury[platform]).toBe(123n);
  });
});
