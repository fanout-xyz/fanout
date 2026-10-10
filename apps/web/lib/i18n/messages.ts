import { formatUnits } from "viem";
import bn from "./messages/bn.json";
import en from "./messages/en.json";
import es from "./messages/es.json";
import fr from "./messages/fr.json";
import ha from "./messages/ha.json";
import hi from "./messages/hi.json";
import id from "./messages/id.json";
import pt from "./messages/pt.json";
import ur from "./messages/ur.json";
import yo from "./messages/yo.json";
import { languageInfo, normalizeLanguage, parseAcceptLanguage, pickLanguage, type Lang } from "./languages";

/**
 * Claim page and claim email strings. English (en.json) is the source; the others are static,
 * machine-translated once and committed (scripts/translate-messages.ts), never translated per view.
 * A missing key falls back to English.
 */

export type MessageKey = Exclude<keyof typeof en, "_meta">;
type Messages = Partial<Record<MessageKey, string>> & { _meta?: unknown };

export const MESSAGES: Record<Lang, Messages> = { en, es, pt, fr, hi, ur, bn, yo, ha, id };

export type Vars = Record<string, string | number>;

/** "Claim {amount}" + { amount: "$5.00" } -> "Claim $5.00". Unknown placeholders stay as they are. */
export function fill(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

export function t(lang: Lang, key: MessageKey, vars?: Vars): string {
  return fill(MESSAGES[lang]?.[key] ?? en[key], vars);
}

/** A translator bound to one language. */
export const translator = (lang: Lang) => (key: MessageKey, vars?: Vars) => t(lang, key, vars);

/** Dollars in the payee's own number format: "$1,234.50", "1.234,50 US$", "US$১,২৩৪.৫০". */
export function formatDollars(lang: Lang, cents: number): string {
  return new Intl.NumberFormat(languageInfo(lang).locale, { style: "currency", currency: "USD" }).format(Math.round(cents) / 100);
}

/** Base units -> dollars in the payee's format. Truncates below the cent, like formatUsd. */
export function formatDollarsFromUnits(lang: Lang, amount: bigint, decimals: number): string {
  const cents = decimals >= 2 ? amount / 10n ** BigInt(decimals - 2) : amount * 10n ** BigInt(2 - decimals);
  return formatDollars(lang, Number(formatUnits(cents, 2)) * 100);
}

/**
 * The claim page's language: the payee's own choice on this device, else the language the platform
 * set for the payout (?lang= on the emailed link), else the browser's Accept-Language, else English.
 */
export function claimPageLanguage(input: { saved?: string | null; query?: string | null; acceptLanguage?: string | null }): Lang {
  return normalizeLanguage(input.saved) ?? normalizeLanguage(input.query) ?? pickLanguage(parseAcceptLanguage(input.acceptLanguage));
}
