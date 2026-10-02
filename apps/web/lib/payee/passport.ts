import { getAddress, isAddress, isHex, recoverMessageAddress, type Address, type Hex } from "viem";
import type { PayeeHistoryItem } from "@/lib/fanout/types";

/**
 * Earnings Passport: a payee proves "I earned at least $X a month for these months, from at least
 * N platforms" without showing each payment.
 *
 * Two keys sign it, both from the payee's passkey (Mera):
 * - the passport key, from a second PRF salt. It holds no money and signs only statements, so
 *   proving income never touches the key that moves funds.
 * - the account key signs once to vouch that the passport key belongs to the account.
 *
 * Anyone can check a statement: both signatures, then the payouts the account actually claimed
 * (from the indexer), month by month. The verify page shows the claim, not the payments. They
 * are on a public chain, so this hides them from casual view, not from someone who looks them up.
 */

export type PassportStatement = {
  v: 1;
  /** The payee account that received the payouts. */
  account: Address;
  /** The passport key that signs statements. */
  passportKey: Address;
  /** Calendar months covered, UTC, "YYYY-MM", oldest first. */
  months: string[];
  /** Whole dollars: every month had at least this much in payouts. */
  minMonthlyUsd: number;
  /** At least this many different platforms paid the account over the period. */
  platforms: number;
  /** Unix ms. */
  issuedAt: number;
};

export type Passport = {
  statement: PassportStatement;
  /** Account key's signature over linkMessage(account, passportKey). */
  link: Hex;
  /** Passport key's signature over statementMessage(statement). */
  sig: Hex;
};

export const linkMessage = (account: Address, passportKey: Address) =>
  `Fanout Earnings Passport\nThis passport key belongs to my account.\nAccount: ${getAddress(account)}\nPassport key: ${getAddress(passportKey)}`;

/** What the passport key signs: readable, so a wallet or a person can see what was claimed. */
export function statementMessage(s: PassportStatement): string {
  return [
    `Fanout Earnings Passport v${s.v}`,
    `Account: ${getAddress(s.account)}`,
    `Passport key: ${getAddress(s.passportKey)}`,
    `Months: ${s.months.join(", ")}`,
    `At least $${s.minMonthlyUsd} in payouts every month`,
    `From at least ${s.platforms} platform${s.platforms === 1 ? "" : "s"}`,
    `Issued: ${new Date(s.issuedAt).toISOString()}`,
  ].join("\n");
}

const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

/** The last `count` calendar months (UTC) ending with the month of `now`, oldest first. */
export function recentMonths(count: number, now: number): string[] {
  const d = new Date(now);
  return Array.from({ length: count }, (_, i) => {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (count - 1 - i), 1));
    return m.toISOString().slice(0, 7);
  });
}

export type MonthlyIncome = { months: { month: string; cents: number }[]; platforms: number };

/** Payouts per month (cents) and distinct paying platforms. Transfers don't count as income. */
export function monthlyIncome(history: PayeeHistoryItem[], months: string[]): MonthlyIncome {
  const wanted = new Set(months);
  const byMonth = new Map(months.map((m) => [m, 0]));
  const platforms = new Set<string>();
  for (const item of history) {
    if (item.kind !== "received" || !item.payout) continue;
    const month = monthOf(item.timestamp);
    if (!wanted.has(month)) continue;
    // AUSD has 6 decimals; cents = amount / 10^4, truncated.
    byMonth.set(month, (byMonth.get(month) ?? 0) + Number(item.amount / 10_000n));
    platforms.add(item.counterparty.toLowerCase());
  }
  return { months: months.map((month) => ({ month, cents: byMonth.get(month) ?? 0 })), platforms: platforms.size };
}

/** A round number at or below `usd`, so the claim reads naturally: 437 -> 400, 86 -> 80, 1260 -> 1200. */
export function niceFloor(usd: number): number {
  if (usd < 10) return 0;
  const step = usd < 100 ? 10 : usd < 1000 ? 50 : 100;
  return Math.floor(usd / step) * step;
}

/** The strongest honest claim for these months, or null when there's nothing to claim yet. */
export function bestClaim(income: MonthlyIncome): { minMonthlyUsd: number; platforms: number } | null {
  const lowest = Math.min(...income.months.map((m) => m.cents)) / 100;
  const minMonthlyUsd = niceFloor(lowest);
  if (minMonthlyUsd === 0 || income.platforms === 0) return null;
  return { minMonthlyUsd, platforms: income.platforms };
}

// --- Share links: the passport rides in the URL fragment, so no server ever sees it. ---

const toB64url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

export function encodePassport(p: Passport): string {
  return toB64url(JSON.stringify(p));
}

/** Parses a share link's payload; null for anything malformed. */
export function decodePassport(encoded: string): Passport | null {
  try {
    const p = JSON.parse(fromB64url(encoded)) as Passport;
    const s = p?.statement;
    const ok =
      s?.v === 1 &&
      isAddress(s.account) &&
      isAddress(s.passportKey) &&
      Array.isArray(s.months) &&
      s.months.length > 0 &&
      s.months.length <= 12 &&
      s.months.every((m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)) &&
      Number.isInteger(s.minMonthlyUsd) &&
      s.minMonthlyUsd > 0 &&
      Number.isInteger(s.platforms) &&
      s.platforms > 0 &&
      Number.isFinite(s.issuedAt) &&
      isHex(p.link) &&
      isHex(p.sig);
    return ok ? p : null;
  } catch {
    return null;
  }
}

export function passportUrl(origin: string, p: Passport): string {
  return `${origin}/verify#p=${encodePassport(p)}`;
}

// --- Verification ---

export type Verdict =
  | { ok: true; income: MonthlyIncome }
  | { ok: false; reason: "signature" | "short-month" | "few-platforms" | "future"; detail?: string; income?: MonthlyIncome };

/** Checks both signatures, then the account's actual payouts against the claim. */
export async function verifyPassport(p: Passport, history: PayeeHistoryItem[], now: number): Promise<Verdict> {
  const s = p.statement;
  try {
    const keyOwner = await recoverMessageAddress({ message: linkMessage(s.account, s.passportKey), signature: p.link });
    const signer = await recoverMessageAddress({ message: statementMessage(s), signature: p.sig });
    if (getAddress(keyOwner) !== getAddress(s.account) || getAddress(signer) !== getAddress(s.passportKey)) {
      return { ok: false, reason: "signature" };
    }
  } catch {
    return { ok: false, reason: "signature" };
  }
  if (s.issuedAt > now + 5 * 60_000 || s.months.some((m) => m > monthOf(now))) return { ok: false, reason: "future" };

  const income = monthlyIncome(history, s.months);
  const short = income.months.find((m) => m.cents < s.minMonthlyUsd * 100);
  if (short) return { ok: false, reason: "short-month", detail: short.month, income };
  if (income.platforms < s.platforms) return { ok: false, reason: "few-platforms", income };
  return { ok: true, income };
}

/** "Sep 2026" from "2026-09". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
