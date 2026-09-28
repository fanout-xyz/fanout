import { beforeEach, describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";
import { activeChain } from "@/lib/chains";
import { generateClaimKey, signClaim } from "./claim-keys";
import { createMockClient, mockRefundUnclaimed, mockReset } from "./mock-client";

const platform = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const payee = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const friend = "0xcccccccccccccccccccccccccccccccccccccccc";

// No claim contract configured in tests, so the mock verifies against the zero address.
const sign = (key: `0x${string}`, recipient: `0x${string}`) =>
  signClaim(key, { recipient, claimContract: zeroAddress, chainId: activeChain.id });

describe("mock client", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    mockReset();
  });
  // Advance fake timers; observe the promise first so rejections aren't reported as unhandled.
  const run = async <T,>(p: Promise<T>): Promise<T> => {
    const settled = p.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.runAllTimersAsync();
    const r = await settled;
    if (!r.ok) throw r.error;
    return r.value;
  };

  it("runs deposit -> batch -> claim -> send end to end", async () => {
    const ops = createMockClient({ account: platform });
    await run(ops.deposit(100_000_000n));
    expect(await run(ops.getTreasuryBalance(platform))).toBe(100_000_000n);

    const a = generateClaimKey();
    const b = generateClaimKey();
    const { batchId, txHash } = await run(
      ops.createBatchPayout([
        { claimSigner: a.claimSigner, amount: 30_000_000n },
        { claimSigner: b.claimSigner, amount: 20_000_000n },
      ]),
    );
    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await run(ops.getTreasuryBalance(platform))).toBe(50_000_000n);

    const info = await run(ops.getClaim(a.claimSigner));
    expect(info).toEqual({ amount: 30_000_000n, platform, status: "sent" });

    const payeeClient = createMockClient({ account: payee });
    await run(payeeClient.claim(a.claimSigner, payee, await sign(a.privateKey, payee)));
    expect(await run(payeeClient.getPayeeBalance(payee))).toBe(30_000_000n);
    await expect(run(payeeClient.claim(a.claimSigner, payee, await sign(a.privateKey, payee)))).rejects.toThrow(/already been claimed/);

    const batch = await run(ops.getBatch(batchId));
    expect(batch.rows.map((r) => r.status)).toEqual(["claimed", "sent"]);
    const [summary] = await run(ops.listBatches(platform));
    expect(summary).toMatchObject({ id: batchId, rowCount: 2, claimedCount: 1, total: 50_000_000n });

    await run(payeeClient.send(friend, 10_000_000n));
    expect(await run(payeeClient.getPayeeBalance(payee))).toBe(20_000_000n);
    const history = await run(payeeClient.getPayeeHistory(payee));
    expect(history.map((h) => h.kind)).toEqual(["sent", "received"]);

    mockRefundUnclaimed(batchId);
    expect(await run(ops.getTreasuryBalance(platform))).toBe(70_000_000n);
    expect((await run(ops.getClaim(b.claimSigner))).status).toBe("refunded");
  });

  it("rejects a signature for a different recipient", async () => {
    const ops = createMockClient({ account: platform });
    await run(ops.deposit(10_000_000n));
    const a = generateClaimKey();
    await run(ops.createBatchPayout([{ claimSigner: a.claimSigner, amount: 5_000_000n }]));
    const sigForPayee = await sign(a.privateKey, payee);
    await expect(run(createMockClient({ account: friend }).claim(a.claimSigner, friend, sigForPayee))).rejects.toThrow(/isn't valid/);
  });

  it("rejects payouts larger than the treasury", async () => {
    const ops = createMockClient({ account: platform });
    await run(ops.deposit(1_000_000n));
    await expect(
      run(ops.createBatchPayout([{ claimSigner: generateClaimKey().claimSigner, amount: 2_000_000n }])),
    ).rejects.toThrow(/Not enough/);
  });

  it("requires sign-in for writes", async () => {
    await expect(run(createMockClient({}).deposit(1n))).rejects.toThrow(/Sign in/);
  });
});
