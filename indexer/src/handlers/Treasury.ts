import { indexer } from "envio";
import { activityId, getPlatform } from "./shared";

indexer.onEvent({ contract: "Treasury", event: "Deposited" }, async ({ event, context }) => {
  const { platform: id, amount } = event.params;
  const platform = await getPlatform(context, id);
  context.Platform.set({
    ...platform,
    balance: platform.balance + amount,
    totalDeposited: platform.totalDeposited + amount,
  });
  context.PlatformActivity.set({
    id: activityId(event.block.number, event.logIndex),
    platform_id: id,
    kind: "Deposit",
    amount,
    batch_id: undefined,
    txHash: event.transaction.hash,
    timestamp: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "Treasury", event: "Withdrawn" }, async ({ event, context }) => {
  const { platform: id, amount } = event.params;
  const platform = await getPlatform(context, id);
  context.Platform.set({
    ...platform,
    balance: platform.balance - amount,
    totalWithdrawn: platform.totalWithdrawn + amount,
  });
  context.PlatformActivity.set({
    id: activityId(event.block.number, event.logIndex),
    platform_id: id,
    kind: "Withdraw",
    amount,
    batch_id: undefined,
    txHash: event.transaction.hash,
    timestamp: event.block.timestamp,
  });
});

// Debited and Credited only move the balance. Their activity rows are written by
// BatchCreated and Refunded, which know the batch.
indexer.onEvent({ contract: "Treasury", event: "Debited" }, async ({ event, context }) => {
  const platform = await getPlatform(context, event.params.platform);
  context.Platform.set({ ...platform, balance: platform.balance - event.params.amount });
});

indexer.onEvent({ contract: "Treasury", event: "Credited" }, async ({ event, context }) => {
  const platform = await getPlatform(context, event.params.platform);
  context.Platform.set({ ...platform, balance: platform.balance + event.params.amount });
});
