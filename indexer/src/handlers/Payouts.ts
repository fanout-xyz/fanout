import { indexer } from "envio";
import { activityId, getPayee, getPlatform } from "./shared";

// Within one createBatch transaction the order is Debited, ClaimOpened (one per row),
// then BatchCreated. So ClaimOpened points at a batch that BatchCreated writes a few logs later.
// (depositAndCreateBatchFor on v3 adds Deposited before them; the order after it is the same.)
//
// The payout's claim window end comes only with ClaimOpened, so the first ClaimOpened starts the
// Batch with it and BatchCreated fills in the rest. Both deployments (monad-ausd and monad-v3) emit
// the same events, and v3 payout ids start after monad-ausd's, so they share these entities.

indexer.onEvent({ contract: "ClaimEscrow", event: "ClaimOpened" }, async ({ event, context }) => {
  const { claimSigner, platform: platformId, batchId, amount, expiresAt } = event.params;
  const id = batchId.toString();
  if (!(await context.Batch.get(id))) {
    context.Batch.set({
      id,
      platform_id: platformId,
      batchPayout: "",
      expiresAt: Number(expiresAt),
      total: 0n,
      rowCount: 0,
      claimedCount: 0,
      claimedAmount: 0n,
      refundedCount: 0,
      refundedAmount: 0n,
      createdAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  }
  context.Claim.set({
    id: claimSigner,
    batch_id: id,
    platform_id: platformId,
    amount,
    expiresAt: Number(expiresAt),
    status: "Sent",
    recipient: undefined,
    openedAt: event.block.timestamp,
    openedTxHash: event.transaction.hash,
    settledAt: undefined,
    settledTxHash: undefined,
  });
  const platform = await getPlatform(context, platformId);
  context.Platform.set({ ...platform, claimCount: platform.claimCount + 1 });
});

indexer.onEvent({ contract: "BatchPayout", event: "BatchCreated" }, async ({ event, context }) => {
  const { batchId, platform: platformId, total, count } = event.params;
  const id = batchId.toString();
  const opened = await context.Batch.get(id);
  context.Batch.set({
    id,
    platform_id: platformId,
    batchPayout: event.srcAddress,
    expiresAt: opened?.expiresAt,
    total,
    rowCount: Number(count),
    claimedCount: 0,
    claimedAmount: 0n,
    refundedCount: 0,
    refundedAmount: 0n,
    createdAt: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  const platform = await getPlatform(context, platformId);
  context.Platform.set({
    ...platform,
    totalPaidOut: platform.totalPaidOut + total,
    batchCount: platform.batchCount + 1,
  });
  context.PlatformActivity.set({
    id: activityId(event.block.number, event.logIndex),
    platform_id: platformId,
    kind: "Payout",
    amount: total,
    batch_id: id,
    txHash: event.transaction.hash,
    timestamp: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "ClaimEscrow", event: "Claimed" }, async ({ event, context }) => {
  const { claimSigner, recipient, amount } = event.params;
  const claim = await context.Claim.get(claimSigner);
  if (!claim) {
    context.log.error(`Claimed for unknown claim ${claimSigner}`);
    return;
  }
  context.Claim.set({
    ...claim,
    status: "Claimed",
    recipient,
    settledAt: event.block.timestamp,
    settledTxHash: event.transaction.hash,
  });

  const batch = await context.Batch.getOrThrow(claim.batch_id);
  context.Batch.set({
    ...batch,
    claimedCount: batch.claimedCount + 1,
    claimedAmount: batch.claimedAmount + amount,
  });

  const platform = await getPlatform(context, claim.platform_id);
  context.Platform.set({
    ...platform,
    totalClaimed: platform.totalClaimed + amount,
    claimedCount: platform.claimedCount + 1,
  });

  const payee = await getPayee(context, recipient);
  context.Payee.set({
    ...payee,
    totalReceived: payee.totalReceived + amount,
    claimCount: payee.claimCount + 1,
  });
  context.PayeeActivity.set({
    id: activityId(event.block.number, event.logIndex),
    payee_id: recipient,
    kind: "Received",
    amount,
    counterparty: claim.platform_id,
    claim_id: claimSigner,
    txHash: event.transaction.hash,
    timestamp: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "ClaimEscrow", event: "Refunded" }, async ({ event, context }) => {
  const { claimSigner, platform: platformId, amount } = event.params;
  const claim = await context.Claim.get(claimSigner);
  if (!claim) {
    context.log.error(`Refunded for unknown claim ${claimSigner}`);
    return;
  }
  context.Claim.set({
    ...claim,
    status: "Refunded",
    settledAt: event.block.timestamp,
    settledTxHash: event.transaction.hash,
  });

  const batch = await context.Batch.getOrThrow(claim.batch_id);
  context.Batch.set({
    ...batch,
    refundedCount: batch.refundedCount + 1,
    refundedAmount: batch.refundedAmount + amount,
  });

  const platform = await getPlatform(context, platformId);
  context.Platform.set({ ...platform, totalRefunded: platform.totalRefunded + amount });
  context.PlatformActivity.set({
    id: activityId(event.block.number, event.logIndex),
    platform_id: platformId,
    kind: "Refund",
    amount,
    batch_id: batch.id,
    txHash: event.transaction.hash,
    timestamp: event.block.timestamp,
  });
});
