import type { Batch } from "@/lib/fanout/types";

/**
 * Unusual-payout checks, before approval: compares a payout with this platform's recent payouts.
 * All rules are plain code. When AI is on it may only reword the result (lib/assist/risk-ai.ts), and
 * only from the numbers here, never the emails.
 *
 * Amounts are base units of the payout dollar (6 decimals).
 */

export type PastPayout = { total: bigint; rowCount: number; createdAt: number };

export type RiskKind = "total-high" | "first-large" | "new-payee-large" | "same-amount" | "many-new";

export type RiskReason = {
  kind: RiskKind;
  /** Plain sentence for the platform. May name payees (it stays in the browser). */
  message: string;
  /** Numbers only (dollars as numbers, counts): all an AI rewording ever sees. */
  facts: Record<string, number>;
};

export type RiskInput = {
  rows: { email: string; amount: bigint }[];
  /** Recent payouts, or null when they couldn't be loaded (the checks that need them are skipped). */
  history: PastPayout[] | null;
  /** Payees paid before (email -> typical amount), from this browser's records of past payouts. */
  payees: Map<string, bigint>;
};

const UNIT = 1_000_000n; // one dollar in base units
const dollars = (amount: bigint) => Number(amount / 10_000n) / 100;
const usd = (amount: bigint) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: amount % UNIT === 0n ? 0 : 2 }).format(dollars(amount));

/** At least this many past payouts before "far above normal" means anything. */
export const MIN_HISTORY = 3;
export const TOTAL_MULTIPLE = 3n;
export const TOTAL_MIN_EXTRA = 500n * UNIT;
export const FIRST_PAYOUT_LARGE = 10_000n * UNIT;
export const NEW_PAYEE_MULTIPLE = 3n;
export const NEW_PAYEE_MIN = 500n * UNIT;
export const SAME_AMOUNT_MIN_PEOPLE = 10;
export const SAME_AMOUNT_SHARE = 0.8;
export const MANY_NEW_MIN_KNOWN = 10;

export function median(values: bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export function assessPayout({ rows, history: known, payees }: RiskInput): RiskReason[] {
  if (rows.length === 0) return [];
  const history = known ?? [];
  const reasons: RiskReason[] = [];
  const total = rows.reduce((s, r) => s + r.amount, 0n);

  // 1. The total, against this platform's usual payout.
  const usualTotal = history.length >= MIN_HISTORY ? median(history.map((h) => h.total)) : null;
  if (usualTotal !== null && usualTotal > 0n && total > usualTotal * TOTAL_MULTIPLE && total - usualTotal >= TOTAL_MIN_EXTRA) {
    const times = Number((total * 10n) / usualTotal) / 10;
    reasons.push({
      kind: "total-high",
      message: `This payout is ${usd(total)}, about ${times}× your usual ${usd(usualTotal)}.`,
      facts: { total_usd: dollars(total), usual_total_usd: dollars(usualTotal), times },
    });
  }
  if (known !== null && history.length === 0 && total >= FIRST_PAYOUT_LARGE) {
    reasons.push({
      kind: "first-large",
      message: `This is your first payout, and it's ${usd(total)}. Start with a small one if you're trying Fanout out.`,
      facts: { total_usd: dollars(total) },
    });
  }

  // 2. New payees with large amounts: large against what one person usually gets.
  const perPerson = history.filter((h) => h.rowCount > 0).map((h) => h.total / BigInt(h.rowCount));
  const usualPerPerson = median(perPerson.length ? perPerson : rows.map((r) => r.amount))!;
  const threshold = usualPerPerson * NEW_PAYEE_MULTIPLE > NEW_PAYEE_MIN ? usualPerPerson * NEW_PAYEE_MULTIPLE : NEW_PAYEE_MIN;
  if (payees.size > 0) {
    const large = rows.filter((r) => !payees.has(r.email) && r.amount >= threshold).sort((a, b) => (a.amount > b.amount ? -1 : 1));
    if (large.length) {
      const named = large.slice(0, 3).map((r) => `${r.email} (${usd(r.amount)})`).join(", ");
      const more = large.length > 3 ? ` and ${large.length - 3} more` : "";
      reasons.push({
        kind: "new-payee-large",
        message: `${large.length === 1 ? "Someone you haven't paid before gets" : `${large.length} people you haven't paid before get`} a large amount: ${named}${more}. One person usually gets about ${usd(usualPerPerson)}.`,
        facts: { new_large_count: large.length, largest_usd: dollars(large[0].amount), usual_per_person_usd: dollars(usualPerPerson) },
      });
    }
    const fresh = rows.filter((r) => !payees.has(r.email)).length;
    if (payees.size >= MANY_NEW_MIN_KNOWN && rows.length >= 10 && fresh / rows.length > 0.5) {
      reasons.push({
        kind: "many-new",
        message: `Most people here (${fresh} of ${rows.length}) haven't been paid by you before.`,
        facts: { new_count: fresh, people: rows.length },
      });
    }
  }

  // 3. The same amount to many people: a flat bonus, or a column filled down by mistake.
  const counts = new Map<bigint, number>();
  for (const r of rows) counts.set(r.amount, (counts.get(r.amount) ?? 0) + 1);
  const [commonAmount, commonCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (commonCount >= SAME_AMOUNT_MIN_PEOPLE && commonCount / rows.length >= SAME_AMOUNT_SHARE && rows.length > 1) {
    reasons.push({
      kind: "same-amount",
      message: `${commonCount === rows.length ? "Everyone" : `${commonCount} of ${rows.length} people`} get${commonCount === rows.length ? "s" : ""} exactly ${usd(commonAmount)}. Fine for a flat bonus; otherwise check the amount column wasn't filled down.`,
      facts: { same_count: commonCount, people: rows.length, amount_usd: dollars(commonAmount) },
    });
  }
  return reasons;
}

/** Changes whenever the reasons do, so a confirmation never carries over to a different payout. */
export function riskSignature(reasons: RiskReason[]): string {
  return reasons.map((r) => `${r.kind}:${Object.values(r.facts).join(",")}`).join("|");
}

/**
 * What each payee was typically paid, from past payouts' rows and this browser's saved claim links
 * (claim address -> email). Payees from payouts made on another device aren't known.
 */
export function payeeTypicals(batches: Pick<Batch, "rows">[], emailOf: (claimSigner: string) => string | undefined): Map<string, bigint> {
  const amounts = new Map<string, bigint[]>();
  for (const b of batches) {
    for (const row of b.rows) {
      const email = emailOf(row.claimSigner.toLowerCase());
      if (!email) continue;
      amounts.set(email, [...(amounts.get(email) ?? []), row.amount]);
    }
  }
  return new Map([...amounts].map(([email, list]) => [email, median(list)!]));
}
