import { encodePassport, monthLabel, type Passport, type PassportStatement } from "./passport";
import { monthRange } from "./passport-stats";

/**
 * What a shared Passport shows. The payee picks; nothing else leaves the phone.
 *
 * The signed statement keeps its exact format. A field the payee hides is signed as the weakest
 * true claim instead (at least $10 a month, at least 1 platform), so even someone who decodes the
 * link learns nothing they weren't shown. The total is never signed: when the payee chooses to
 * show it, the verify page adds up the same payouts it checks and shows that sum.
 *
 * The link has two parts:
 * - `?…` the card preview (what link previews draw), holding only the fields the payee picked;
 * - `#p=…&show=…` the signed passport and which fields to show, in the fragment, which browsers
 *   never send to a server.
 */

export type ShareFields = {
  /** "At least $X a month". */
  amount: boolean;
  /** "From N platforms". */
  platforms: boolean;
  /** The exact total for the period. Off unless the payee turns it on. */
  total: boolean;
};

export const DEFAULT_FIELDS: ShareFields = { amount: true, platforms: true, total: false };

/** What older links (without `show=`) displayed. */
const LEGACY_FIELDS: ShareFields = { amount: true, platforms: true, total: false };

/** Signed in place of a hidden amount: every passport needs one, and $10 is the smallest claim. */
export const HIDDEN_AMOUNT_USD = 10;

/** The claim to sign for these choices: hidden fields become the weakest true claim. */
export function claimToSign(best: { minMonthlyUsd: number; platforms: number }, fields: ShareFields) {
  return {
    minMonthlyUsd: fields.amount ? best.minMonthlyUsd : Math.min(HIDDEN_AMOUNT_USD, best.minMonthlyUsd),
    platforms: fields.platforms ? best.platforms : 1,
  };
}

/** The public card. Months and the period are always shown: they're what the claim is about. */
export type ShareCard = {
  months: number;
  from: string;
  to: string;
  minMonthlyUsd?: number;
  platforms?: number;
  totalUsd?: number;
};

/** Builds the card from a signed statement, keeping only what the payee chose to show. */
export function shareCardFor(s: Pick<PassportStatement, "months" | "minMonthlyUsd" | "platforms">, fields: ShareFields, totalCents?: number): ShareCard {
  return {
    months: s.months.length,
    from: s.months[0],
    to: s.months.at(-1)!,
    ...(fields.amount ? { minMonthlyUsd: s.minMonthlyUsd } : {}),
    ...(fields.platforms ? { platforms: s.platforms } : {}),
    ...(fields.total && totalCents !== undefined && totalCents >= 100 ? { totalUsd: Math.floor(totalCents / 100) } : {}),
  };
}

// --- Encoding ---

const fieldCodes: [keyof ShareFields, string][] = [
  ["amount", "a"],
  ["platforms", "p"],
  ["total", "t"],
];

export function encodeFields(f: ShareFields): string {
  return fieldCodes
    .filter(([k]) => f[k])
    .map(([, c]) => c)
    .join("");
}

/** `show=` from a link's fragment. Missing means an older link: amount and platforms, as before. */
export function decodeFields(show: string | null): ShareFields {
  if (show === null) return LEGACY_FIELDS;
  const codes = new Set(show.split(""));
  return { amount: codes.has("a"), platforms: codes.has("p"), total: codes.has("t") };
}

export function cardQuery(card: ShareCard): string {
  const q = new URLSearchParams({ m: String(card.months), from: card.from, to: card.to });
  if (card.minMonthlyUsd !== undefined) q.set("a", String(card.minMonthlyUsd));
  if (card.platforms !== undefined) q.set("pl", String(card.platforms));
  if (card.totalUsd !== undefined) q.set("tot", String(card.totalUsd));
  return q.toString();
}

/** The share link: preview fields in the query, the signed passport in the fragment. */
export function shareUrl(origin: string, passport: Passport, fields: ShareFields, totalCents?: number): string {
  const card = shareCardFor(passport.statement, fields, totalCents);
  return `${origin}/verify?${cardQuery(card)}#p=${encodePassport(passport)}&show=${encodeFields(fields)}`;
}

// --- Parsing the preview (server side: the image route and link-preview metadata) ---

type Params = { get(name: string): string | null };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function int(raw: string | null, max: number): number | undefined | null {
  if (raw === null) return undefined;
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= max ? n : null;
}

/**
 * Reads a card from a share link's query. Null for anything malformed or implausible, so the
 * image route can't be made to draw arbitrary text: only digits and real months get through.
 */
export function parseShareCard(params: Params): ShareCard | null {
  const months = int(params.get("m"), 12);
  const from = params.get("from");
  const to = params.get("to");
  const minMonthlyUsd = int(params.get("a"), 10_000_000);
  const platforms = int(params.get("pl"), 1_000);
  const totalUsd = int(params.get("tot"), 1_000_000_000);
  if (!months || !from || !to || !MONTH.test(from) || !MONTH.test(to) || from > to) return null;
  if (minMonthlyUsd === null || platforms === null || totalUsd === null) return null;
  if (monthRange(from, to).length !== months) return null;
  return {
    months,
    from,
    to,
    ...(minMonthlyUsd !== undefined ? { minMonthlyUsd } : {}),
    ...(platforms !== undefined ? { platforms } : {}),
    ...(totalUsd !== undefined ? { totalUsd } : {}),
  };
}

export type CardFormat = "landscape" | "portrait";

export const CARD_SIZES: Record<CardFormat, { width: number; height: number }> = {
  landscape: { width: 1200, height: 630 },
  portrait: { width: 1080, height: 1350 },
};

export function parseFormat(raw: string | null): CardFormat | null {
  if (raw === null || raw === "landscape") return "landscape";
  return raw === "portrait" ? "portrait" : null;
}

// --- Words, shared by the card on screen, the image and link previews ---

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export function cardPeriod(card: Pick<ShareCard, "from" | "to">): string {
  if (card.from === card.to) return monthLabel(card.from);
  const [fy] = card.from.split("-");
  const [ty] = card.to.split("-");
  const short = (m: string) =>
    new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return fy === ty ? `${short(card.from)} – ${monthLabel(card.to)}` : `${monthLabel(card.from)} – ${monthLabel(card.to)}`;
}

/** The headline: "Earned at least $400 a month" or, with the amount hidden, "Paid every month". */
export function cardHeadline(card: ShareCard): string {
  return card.minMonthlyUsd !== undefined ? `Earned at least ${usd(card.minMonthlyUsd)} a month` : "Paid every month";
}

export function cardFacts(card: ShareCard): string[] {
  return [
    `${card.months} ${card.months === 1 ? "month" : "months"} in a row`,
    ...(card.platforms !== undefined ? [`${card.platforms} ${card.platforms === 1 ? "platform" : "platforms"}`] : []),
    ...(card.totalUsd !== undefined ? [`${usd(card.totalUsd)} in total`] : []),
  ];
}

/** One line for link previews. */
export function cardSummary(card: ShareCard): string {
  return `${cardHeadline(card)} · ${cardPeriod(card)} · ${cardFacts(card).join(" · ")}`;
}
