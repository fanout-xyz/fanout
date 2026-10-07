/**
 * How long a payout's claim links work before unclaimed money can return to the platform's
 * balance. The v3 contracts take any window from MIN to MAX (BatchPayout.MIN_CLAIM_WINDOW,
 * MAX_CLAIM_WINDOW); the dashboard offers these.
 */

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

export const MIN_CLAIM_WINDOW_SECONDS = 5 * MINUTE;
export const MAX_CLAIM_WINDOW_SECONDS = 90 * DAY;
export const DEFAULT_CLAIM_WINDOW_SECONDS = 30 * DAY;

export const CLAIM_WINDOW_OPTIONS = [
  { seconds: 10 * MINUTE, label: "10 minutes" },
  { seconds: DAY, label: "1 day" },
  { seconds: 7 * DAY, label: "7 days" },
  { seconds: DEFAULT_CLAIM_WINDOW_SECONDS, label: "30 days (default)" },
] as const;

/** Whether the contracts would accept this window. */
export function validClaimWindow(seconds: number): boolean {
  return Number.isInteger(seconds) && seconds >= MIN_CLAIM_WINDOW_SECONDS && seconds <= MAX_CLAIM_WINDOW_SECONDS;
}

/** Whether a payout uses a window other than the default (so it needs the v3 contracts). */
export function customClaimWindow(seconds: number | undefined): seconds is number {
  return seconds !== undefined && seconds !== DEFAULT_CLAIM_WINDOW_SECONDS;
}
