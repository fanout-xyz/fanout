import { describe, it } from "vitest";
import { createTestIndexer, TestHelpers } from "envio";

const CHAIN = 10143;
const [platform, signerA, signerB, payee, friend, stranger] = TestHelpers.Addresses.mockAddresses;
const ESCROW = "0xf1de07BFfAF3D3D4279399D63049F0C01b8aFD11";
const TREASURY = "0x245C9b855fd63395BccEC46f7Bac2671e18e79fE";
const BATCH_PAYOUT = "0xfc15b4f0811C6F88e8D572cFB01fCE5b166FE3dF";
const EXPIRES = 1_800_000_000n;

const tx = (n: number) => ({ hash: `0x${n.toString(16).padStart(64, "0")}` });
// Blocks must be at or after start_block in config.yaml, or the events are filtered out.
const START = 66_791_223;
const at = (n: number) => ({ number: START + n, timestamp: 1_790_000_000 + n });

// Deposit 100, pay 60 to two people, one claims and spends, the other is refunded.
async function runLifecycle() {
  const indexer = createTestIndexer();
  await indexer.process({
    chains: {
      [CHAIN]: {
        simulate: [
          { contract: "Treasury", event: "Deposited", block: at(1), transaction: tx(1), params: { platform, amount: 100n } },

          // createBatch: Debited, then one ClaimOpened per row, then BatchCreated.
          { contract: "Treasury", event: "Debited", block: at(2), transaction: tx(2), params: { platform, amount: 60n } },
          { contract: "ClaimEscrow", event: "ClaimOpened", block: at(2), transaction: tx(2),
            params: { claimSigner: signerA, platform, batchId: 1n, amount: 40n, expiresAt: EXPIRES } },
          { contract: "ClaimEscrow", event: "ClaimOpened", block: at(2), transaction: tx(2),
            params: { claimSigner: signerB, platform, batchId: 1n, amount: 20n, expiresAt: EXPIRES } },
          { contract: "BatchPayout", event: "BatchCreated", block: at(2), transaction: tx(2),
            params: { batchId: 1n, platform, total: 60n, count: 2n } },

          // Claim: the escrow's AUSD transfer comes before Claimed.
          { contract: "AUSD", event: "Transfer", block: at(3), transaction: tx(3), params: { from: ESCROW, to: payee, value: 40n } },
          { contract: "ClaimEscrow", event: "Claimed", block: at(3), transaction: tx(3),
            params: { claimSigner: signerA, recipient: payee, amount: 40n } },

          // Payee spends some; an unrelated transfer is ignored.
          { contract: "AUSD", event: "Transfer", block: at(4), transaction: tx(4), params: { from: payee, to: friend, value: 15n } },
          { contract: "AUSD", event: "Transfer", block: at(4), transaction: tx(5), params: { from: stranger, to: friend, value: 999n } },

          // Refund of the unclaimed row: AUSD back to Treasury, Credited, then Refunded.
          { contract: "AUSD", event: "Transfer", block: at(5), transaction: tx(6), params: { from: ESCROW, to: TREASURY, value: 20n } },
          { contract: "Treasury", event: "Credited", block: at(5), transaction: tx(6), params: { platform, amount: 20n } },
          { contract: "ClaimEscrow", event: "Refunded", block: at(5), transaction: tx(6),
            params: { claimSigner: signerB, platform, amount: 20n } },

          { contract: "Treasury", event: "Withdrawn", block: at(6), transaction: tx(7), params: { platform, amount: 10n } },
        ],
      },
    },
  });
  return indexer;
}

describe("payout lifecycle", () => {
  it("tracks the platform's balance and totals like Treasury does", async (t) => {
    const indexer = await runLifecycle();
    t.expect(await indexer.Platform.getOrThrow(platform)).toMatchObject({
      balance: 50n, // 100 - 60 + 20 - 10
      totalDeposited: 100n,
      totalWithdrawn: 10n,
      totalPaidOut: 60n,
      totalClaimed: 40n,
      totalRefunded: 20n,
      batchCount: 1,
      claimCount: 2,
      claimedCount: 1,
    });
  });

  it("records the batch with its transaction and claim progress", async (t) => {
    const indexer = await runLifecycle();
    t.expect(await indexer.Batch.getOrThrow("1")).toMatchObject({
      platform_id: platform,
      total: 60n,
      rowCount: 2,
      claimedCount: 1,
      claimedAmount: 40n,
      refundedCount: 1,
      refundedAmount: 20n,
      createdAt: 1_790_000_002,
      txHash: tx(2).hash,
      batchPayout: BATCH_PAYOUT,
      expiresAt: Number(EXPIRES),
    });
  });

  it("settles each claim", async (t) => {
    const indexer = await runLifecycle();
    t.expect(await indexer.Claim.getOrThrow(signerA)).toMatchObject({
      batch_id: "1",
      status: "Claimed",
      recipient: payee,
      amount: 40n,
      expiresAt: Number(EXPIRES),
      openedTxHash: tx(2).hash,
      settledTxHash: tx(3).hash,
    });
    t.expect(await indexer.Claim.getOrThrow(signerB)).toMatchObject({
      status: "Refunded",
      recipient: undefined,
      settledTxHash: tx(6).hash,
    });
  });

  it("writes one dashboard row per balance movement", async (t) => {
    const indexer = await runLifecycle();
    const rows = (await indexer.PlatformActivity.getAll()).sort((a, b) => a.timestamp - b.timestamp);
    t.expect(rows.map((r) => [r.kind, r.amount, r.batch_id, r.txHash])).toEqual([
      ["Deposit", 100n, undefined, tx(1).hash],
      ["Payout", 60n, "1", tx(2).hash],
      ["Refund", 20n, "1", tx(6).hash],
      ["Withdraw", 10n, undefined, tx(7).hash],
    ]);
  });

  it("gives the payee a history of the claim and what they sent, nothing else", async (t) => {
    const indexer = await runLifecycle();
    t.expect(await indexer.Payee.getOrThrow(payee)).toMatchObject({ totalReceived: 40n, totalSent: 15n, claimCount: 1 });
    const rows = (await indexer.PayeeActivity.getAll()).sort((a, b) => a.timestamp - b.timestamp);
    t.expect(rows.map((r) => [r.payee_id, r.kind, r.amount, r.counterparty, r.claim_id])).toEqual([
      [payee, "Received", 40n, platform, signerA],
      [payee, "Sent", 15n, friend, undefined],
    ]);
    t.expect(await indexer.Payee.get(friend)).toBeUndefined();
    t.expect(await indexer.Payee.get(stranger)).toBeUndefined();
  });
});

describe("v3: per-payout claim windows and paying by email", () => {
  // A payer deposits and pays by email in one relayed transaction (depositAndCreateBatchFor) with a
  // 10-minute window; a platform pays with the default window. Payout ids start at 1001 on v3.
  async function run() {
    const indexer = createTestIndexer();
    const short = 1_790_000_010n + 600n;
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            { contract: "Treasury", event: "Deposited", block: at(10), transaction: tx(10), params: { platform: friend, amount: 25n } },
            { contract: "Treasury", event: "Debited", block: at(10), transaction: tx(10), params: { platform: friend, amount: 25n } },
            { contract: "ClaimEscrow", event: "ClaimOpened", block: at(10), transaction: tx(10),
              params: { claimSigner: signerA, platform: friend, batchId: 1001n, amount: 25n, expiresAt: short } },
            { contract: "BatchPayout", event: "BatchCreated", block: at(10), transaction: tx(10),
              params: { batchId: 1001n, platform: friend, total: 25n, count: 1n } },

            { contract: "Treasury", event: "Deposited", block: at(11), transaction: tx(11), params: { platform, amount: 10n } },
            { contract: "Treasury", event: "Debited", block: at(12), transaction: tx(12), params: { platform, amount: 10n } },
            { contract: "ClaimEscrow", event: "ClaimOpened", block: at(12), transaction: tx(12),
              params: { claimSigner: signerB, platform, batchId: 1002n, amount: 10n, expiresAt: EXPIRES } },
            { contract: "BatchPayout", event: "BatchCreated", block: at(12), transaction: tx(12),
              params: { batchId: 1002n, platform, total: 10n, count: 1n } },

            // The short window passes and refundMany returns the payer's money to their balance.
            { contract: "Treasury", event: "Credited", block: at(700), transaction: tx(13), params: { platform: friend, amount: 25n } },
            { contract: "ClaimEscrow", event: "Refunded", block: at(700), transaction: tx(13),
              params: { claimSigner: signerA, platform: friend, amount: 25n } },
          ],
        },
      },
    });
    return { indexer, short };
  }

  it("keeps each payout's own claim window end", async (t) => {
    const { indexer, short } = await run();
    t.expect(await indexer.Batch.getOrThrow("1001")).toMatchObject({ platform_id: friend, total: 25n, rowCount: 1, expiresAt: Number(short), txHash: tx(10).hash });
    t.expect(await indexer.Batch.getOrThrow("1002")).toMatchObject({ platform_id: platform, total: 10n, expiresAt: Number(EXPIRES) });
    t.expect(await indexer.Claim.getOrThrow(signerA)).toMatchObject({ expiresAt: Number(short), status: "Refunded" });
  });

  it("credits a refund to the payer who paid by email, not the relayer", async (t) => {
    const { indexer } = await run();
    t.expect(await indexer.Platform.getOrThrow(friend)).toMatchObject({ balance: 25n, totalDeposited: 25n, totalPaidOut: 25n, totalRefunded: 25n });
    t.expect(await indexer.Batch.getOrThrow("1001")).toMatchObject({ refundedCount: 1, refundedAmount: 25n });
  });
});
