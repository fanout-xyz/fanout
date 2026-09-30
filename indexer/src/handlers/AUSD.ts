import { indexer } from "envio";
import { activityId } from "./shared";

// Money a payee moves after claiming, for the wallet page. A wallet becomes a payee on its
// first claim (see Claimed); transfers before that aren't Fanout activity and are skipped.
// The claim payout itself (ClaimEscrow -> recipient) is recorded by Claimed, so it's skipped here.

indexer.onEvent({ contract: "AUSD", event: "Transfer" }, async ({ event, context }) => {
  const { from, to, value } = event.params;
  if (value === 0n) return;
  const escrows = indexer.chains[10143].ClaimEscrow.addresses;
  if (escrows.includes(from)) return;

  const [sender, receiver] = await Promise.all([context.Payee.get(from), context.Payee.get(to)]);

  if (sender) {
    context.Payee.set({ ...sender, totalSent: sender.totalSent + value });
    context.PayeeActivity.set({
      id: activityId(event.block.number, event.logIndex, "_sent"),
      payee_id: from,
      kind: "Sent",
      amount: value,
      counterparty: to,
      claim_id: undefined,
      txHash: event.transaction.hash,
      timestamp: event.block.timestamp,
    });
  }
  if (receiver && from !== to) {
    context.Payee.set({ ...receiver, totalReceived: receiver.totalReceived + value });
    context.PayeeActivity.set({
      id: activityId(event.block.number, event.logIndex, "_received"),
      payee_id: to,
      kind: "Received",
      amount: value,
      counterparty: from,
      claim_id: undefined,
      txHash: event.transaction.hash,
      timestamp: event.block.timestamp,
    });
  }
});
