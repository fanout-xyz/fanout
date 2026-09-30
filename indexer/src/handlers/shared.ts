import type { EvmOnEventContext as HandlerContext, Payee, Platform } from "envio";

export const activityId = (blockNumber: number, logIndex: number, suffix = "") =>
  `${blockNumber}_${logIndex}${suffix}`;

export function getPlatform(context: HandlerContext, id: string): Promise<Platform> {
  return context.Platform.getOrCreate({
    id,
    balance: 0n,
    totalDeposited: 0n,
    totalWithdrawn: 0n,
    totalPaidOut: 0n,
    totalClaimed: 0n,
    totalRefunded: 0n,
    batchCount: 0,
    claimCount: 0,
    claimedCount: 0,
  });
}

export function getPayee(context: HandlerContext, id: string): Promise<Payee> {
  return context.Payee.getOrCreate({ id, totalReceived: 0n, totalSent: 0n, claimCount: 0 });
}
