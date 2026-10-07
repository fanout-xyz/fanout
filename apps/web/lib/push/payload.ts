import { formatUsd } from "@/lib/money";

/**
 * What a "You've been paid" notification carries. It never holds the claim link: the claim key
 * stays in the email. Tapping opens the payee's balance, which they reach with their own sign-in
 * or passkey, and which points them to the claim email (see PaidNotice).
 */
export type PaidPayload = { title: string; body: string; url: string; tag: string };

/** Where a tap lands: the balance, with a note that a payment is waiting in their email. */
export const PAID_URL = "/balance?paid=1";

export function buildPaidPayload({ amount, platformName }: { amount: bigint; platformName: string }): PaidPayload {
  const from = platformName.trim() || "a platform";
  return {
    title: "You've been paid",
    body: `${formatUsd(amount)} from ${from}. Tap to see it.`,
    url: PAID_URL,
    // Same tag for every payment: a second payout replaces the first notification instead of stacking.
    tag: "fanout-paid",
  };
}
