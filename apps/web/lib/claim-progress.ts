import type { PayoutStatus } from "@/lib/fanout/types";

export type ClaimProgress = {
  people: number;
  claimed: number;
  waiting: number;
  returned: number;
  totalAmount: bigint;
  claimedAmount: bigint;
  waitingAmount: bigint;
  returnedAmount: bigint;
  /** 0..1 share of people who claimed. 0 for an empty payout. */
  claimedShare: number;
  /** 0..1 share of people whose money went back to the balance. */
  returnedShare: number;
  /** Nobody is left waiting: every row was claimed or returned. Nothing more can change. */
  settled: boolean;
};

/** Counts and dollar totals per status for one payout. */
export function claimProgress(rows: readonly { amount: bigint; status: PayoutStatus }[]): ClaimProgress {
  let claimed = 0;
  let returned = 0;
  let claimedAmount = 0n;
  let waitingAmount = 0n;
  let returnedAmount = 0n;
  for (const r of rows) {
    if (r.status === "claimed") {
      claimed++;
      claimedAmount += r.amount;
    } else if (r.status === "refunded") {
      returned++;
      returnedAmount += r.amount;
    } else {
      waitingAmount += r.amount;
    }
  }
  const people = rows.length;
  return {
    people,
    claimed,
    waiting: people - claimed - returned,
    returned,
    totalAmount: claimedAmount + waitingAmount + returnedAmount,
    claimedAmount,
    waitingAmount,
    returnedAmount,
    claimedShare: people ? claimed / people : 0,
    returnedShare: people ? returned / people : 0,
    settled: people > 0 && claimed + returned === people,
  };
}

/** How often the payout page refreshes right after it opens, when people are most likely to be claiming. */
export const FAST_POLL_MS = 2_500;
/** How long the fast refresh lasts after the page opens. */
export const FAST_POLL_WINDOW_MS = 2 * 60_000;
/** Steady refresh afterwards. */
export const POLL_MS = 5_000;

/**
 * Refresh interval for a payout's detail page, or false to stop. Stops once the payout is
 * settled (nothing can change any more); refreshes faster for a short while after the page opens.
 */
export function payoutPollInterval(input: {
  rows: readonly { status: PayoutStatus }[] | undefined;
  openedAt: number;
  now: number;
}): number | false {
  const { rows } = input;
  if (rows && rows.length > 0 && rows.every((r) => r.status !== "sent")) return false;
  return input.now - input.openedAt < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : POLL_MS;
}
