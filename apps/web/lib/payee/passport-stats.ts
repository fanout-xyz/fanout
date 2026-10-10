import type { Address } from "viem";
import type { PayeeHistoryItem } from "@/lib/fanout/types";

/**
 * The numbers on the payee's own Passport, worked out only from payouts they actually claimed
 * (indexer plus this device's records). Transfers in and money sent out never count.
 * All amounts are whole cents; months are UTC "YYYY-MM".
 */

export type MonthTotal = { month: string; cents: number; payouts: number };

export type PlatformStamp = {
  /** The paying platform's account, lowercased. */
  id: string;
  firstPaidAt: number;
  lastPaidAt: number;
  payouts: number;
  cents: number;
};

export type YearReview = {
  year: number;
  cents: number;
  payouts: number;
  monthsPaid: number;
  platforms: number;
  /** The month with the most in payouts that year. */
  bestMonth: { month: string; cents: number };
};

export type PassportStats = {
  totalCents: number;
  payouts: number;
  monthsPaid: number;
  /** Most consecutive calendar months with at least one payout. */
  longestStreak: number;
  /** Total divided by the months that had a payout, rounded down. */
  averagePerPaidMonthCents: number;
  firstPaidAt: number | null;
  /** Every month from the first payout to `now`, oldest first, including months with nothing. */
  months: MonthTotal[];
  /** One per paying platform, in the order they first paid. */
  platforms: PlatformStamp[];
  /** Newest year first. */
  years: YearReview[];
};

export const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

/** AUSD has 6 decimals: cents = amount / 10^4, truncated (same rule as the signed statement). */
const centsOf = (amount: bigint) => Number(amount / 10_000n);

/** Claimed platform payouts only. */
export function payoutsOf(history: PayeeHistoryItem[]): PayeeHistoryItem[] {
  return history.filter((i) => i.kind === "received" && i.payout);
}

/** "2026-03" -> "2026-04", across year ends. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

/** Every month from `from` to `to` inclusive; empty when `from` is after `to`. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 1200; m = nextMonth(m)) out.push(m);
  return out;
}

/** Longest run of consecutive months with money in them. */
export function longestStreak(months: { month: string; cents: number }[]): number {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const { month, cents } of [...months].sort((a, b) => (a.month < b.month ? -1 : 1))) {
    if (cents <= 0) {
      run = 0;
    } else {
      run = prev !== null && nextMonth(prev) === month && run > 0 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    prev = month;
  }
  return best;
}

export function passportStats(history: PayeeHistoryItem[], now: number): PassportStats {
  const payouts = payoutsOf(history);
  const byMonth = new Map<string, MonthTotal>();
  const byPlatform = new Map<string, PlatformStamp>();
  let totalCents = 0;
  let first: number | null = null;

  for (const p of payouts) {
    const cents = centsOf(p.amount);
    const month = monthOf(p.timestamp);
    totalCents += cents;
    first = first === null ? p.timestamp : Math.min(first, p.timestamp);

    const m = byMonth.get(month) ?? { month, cents: 0, payouts: 0 };
    m.cents += cents;
    m.payouts += 1;
    byMonth.set(month, m);

    const id = p.counterparty.toLowerCase();
    const s = byPlatform.get(id) ?? { id, firstPaidAt: p.timestamp, lastPaidAt: p.timestamp, payouts: 0, cents: 0 };
    s.firstPaidAt = Math.min(s.firstPaidAt, p.timestamp);
    s.lastPaidAt = Math.max(s.lastPaidAt, p.timestamp);
    s.payouts += 1;
    s.cents += cents;
    byPlatform.set(id, s);
  }

  const last = monthOf(Math.max(now, ...payouts.map((p) => p.timestamp)));
  const months =
    first === null ? [] : monthRange(monthOf(first), last).map((month) => byMonth.get(month) ?? { month, cents: 0, payouts: 0 });
  const monthsPaid = months.filter((m) => m.payouts > 0).length;

  const years = new Map<number, { months: MonthTotal[]; platforms: Set<string> }>();
  for (const m of months) {
    const year = Number(m.month.slice(0, 4));
    const y = years.get(year) ?? { months: [], platforms: new Set<string>() };
    y.months.push(m);
    years.set(year, y);
  }
  for (const p of payouts) years.get(Number(monthOf(p.timestamp).slice(0, 4)))?.platforms.add(p.counterparty.toLowerCase());

  return {
    totalCents,
    payouts: payouts.length,
    monthsPaid,
    longestStreak: longestStreak(months),
    averagePerPaidMonthCents: monthsPaid ? Math.floor(totalCents / monthsPaid) : 0,
    firstPaidAt: first,
    months,
    platforms: [...byPlatform.values()].sort((a, b) => a.firstPaidAt - b.firstPaidAt),
    years: [...years.entries()]
      .filter(([, y]) => y.months.some((m) => m.payouts > 0))
      .sort(([a], [b]) => b - a)
      .map(([year, y]) => {
        const best = y.months.reduce((a, b) => (b.cents > a.cents ? b : a));
        return {
          year,
          cents: y.months.reduce((t, m) => t + m.cents, 0),
          payouts: y.months.reduce((t, m) => t + m.payouts, 0),
          monthsPaid: y.months.filter((m) => m.payouts > 0).length,
          platforms: y.platforms.size,
          bestMonth: { month: best.month, cents: best.cents },
        };
      }),
  };
}

// --- Stamps: a look for each platform, worked out from its account so it never changes. ---

export const STAMP_SHAPES = ["circle", "rounded", "hexagon", "octagon", "scallop"] as const;
export type StampShape = (typeof STAMP_SHAPES)[number];

/** Ink colours with enough contrast on paper (light) and on charcoal (dark). */
export const STAMP_INKS = [
  { light: "#2440D9", dark: "#8098FF" }, // cobalt
  { light: "#C2410C", dark: "#FF8A63" }, // tangerine
  { light: "#12805C", dark: "#4CC99A" }, // green
  { light: "#A16207", dark: "#F0B44B" }, // ochre
  { light: "#BE185D", dark: "#F47CAE" }, // rose
  { light: "#0E7490", dark: "#52C7DD" }, // teal
] as const;

export type StampLook = {
  shape: StampShape;
  ink: (typeof STAMP_INKS)[number];
  /** Degrees, -9..9: stamps never land perfectly straight. */
  tilt: number;
  /** A three-letter code, like a port code, so each stamp has a name to read. */
  code: string;
};

/** FNV-1a, 32-bit. Small and stable: the same account always gets the same stamp. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const CODE_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ"; // no I, O, Q: easy to misread on a stamp

export function stampLook(platform: Address | string): StampLook {
  const id = platform.toLowerCase();
  const h = hash32(id);
  const h2 = hash32(`${id}:code`);
  const code = [0, 1, 2].map((i) => CODE_LETTERS[Math.floor(h2 / CODE_LETTERS.length ** i) % CODE_LETTERS.length]).join("");
  return {
    shape: STAMP_SHAPES[h % STAMP_SHAPES.length],
    ink: STAMP_INKS[Math.floor(h / STAMP_SHAPES.length) % STAMP_INKS.length],
    tilt: (Math.floor(h / 97) % 19) - 9,
    code,
  };
}
