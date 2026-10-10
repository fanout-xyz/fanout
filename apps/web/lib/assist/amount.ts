/**
 * Reads the amounts people actually put in spreadsheets: "$1,200.00", "1.2k", "1 200,50", "USD 45",
 * "€30". Deterministic: the assistant only hints which decimal separator a file uses, and only reads
 * values this can't (those are flagged for a person to check).
 *
 * Other currencies are recognised and reported, never converted: Fanout pays in dollars.
 */

export type DecimalSeparator = "." | ",";

export type ReadAmount =
  /** value: a plain dollar amount with 2 decimals, e.g. "1200.00". */
  | { ok: true; value: string; cents: bigint; currency: "USD" }
  | { ok: false; reason: "empty" | "negative" | "unreadable" | "too-precise"; currency: string | null }
  | { ok: false; reason: "currency"; currency: string; value: string | null };

const SYMBOLS: [RegExp, string][] = [
  [/US\$|USD|U\.S\.\s?dollars?|dollars?/i, "USD"],
  [/CA\$|C\$|CAD/i, "CAD"],
  [/AU\$|A\$|AUD/i, "AUD"],
  [/NZ\$|NZD/i, "NZD"],
  [/R\$|BRL/i, "BRL"],
  [/MX\$|MXN/i, "MXN"],
  [/HK\$|HKD/i, "HKD"],
  [/S\$|SGD/i, "SGD"],
  [/€|EUR|euros?/i, "EUR"],
  [/£|GBP/i, "GBP"],
  [/¥|JPY|CNY|RMB/i, "JPY_CNY"],
  [/₹|INR|Rs\.?/i, "INR"],
  [/₦|NGN/i, "NGN"],
  [/₱|PHP/i, "PHP"],
  [/Rp|IDR/i, "IDR"],
  [/৳|BDT|Tk/i, "BDT"],
  [/PKR/i, "PKR"],
  [/KES|KSh/i, "KES"],
  [/GHS|GH₵|₵/i, "GHS"],
  [/ZAR/i, "ZAR"],
  [/CHF/i, "CHF"],
];

/** Currency code from a symbol or code in the text, or null for none. "$" alone is dollars. */
export function detectCurrency(raw: string): string | null {
  for (const [re, code] of SYMBOLS) {
    if (re.test(raw)) return code === "JPY_CNY" ? (/CNY|RMB/i.test(raw) ? "CNY" : "JPY") : code;
  }
  if (/\$/.test(raw)) return "USD";
  const code = raw.match(/\b([A-Z]{3})\b/)?.[1];
  return code ?? null;
}

/** Text -> cents for a plain decimal like "1200.5". Null if it isn't one or has more than 2 decimals. */
function centsOf(plain: string): bigint | null | "too-precise" {
  const m = plain.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > 2) return /^0*$/.test(frac.slice(2)) ? BigInt(m[1]) * 100n + BigInt(frac.slice(0, 2).padEnd(2, "0")) : "too-precise";
  return BigInt(m[1]) * 100n + BigInt(frac.padEnd(2, "0") || "0");
}

export function formatCentsPlain(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/**
 * Normalises one amount. `separator` is the file's decimal separator when known ("," in much of
 * Europe and Latin America); without it, "1,200" reads as twelve hundred and "1,50" as one fifty.
 */
export function readAmount(input: string, separator?: DecimalSeparator): ReadAmount {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "empty", currency: null };
  const currency = detectCurrency(raw);

  // Keep digits, separators, a k/m suffix and a leading minus or brackets (accounting negatives).
  let s = raw
    .replace(/US\$|[A-Z]{1,3}\$|U\.S\.\s?dollars?|dollars?|euros?|Rs\.?|KSh|GH₵|Rp|Tk/gi, "")
    .replace(/\b[A-Z]{3}\b/g, "")
    .replace(/[$€£¥₹₦₱৳₵]/g, "")
    .replace(/[\s  '’]/g, "")
    .replace(/,-$|\.-$/, "");
  const negative = /^-|^\(.*\)$|-$/.test(s);
  s = s.replace(/^[-+(]|[)-]$/g, "");
  if (!s) return { ok: false, reason: "unreadable", currency };

  let multiplier = 1n;
  const suffix = s.match(/^([\d.,]+)([kKmM])$/);
  if (suffix) {
    s = suffix[1];
    multiplier = /k/i.test(suffix[2]) ? 1_000n : 1_000_000n;
  }
  if (!/^[\d.,]+$/.test(s)) return { ok: false, reason: "unreadable", currency };

  const plain = toPlainDecimal(s, separator);
  if (plain === null) return { ok: false, reason: "unreadable", currency };
  const base = centsOf(plain);
  if (base === null) return { ok: false, reason: "unreadable", currency };
  if (base === "too-precise" && multiplier === 1n) return { ok: false, reason: "too-precise", currency };

  let cents: bigint;
  if (base === "too-precise") {
    // "1.2345k" = 1234.5: scale the digits exactly, then insist on whole cents.
    const [int, frac = ""] = plain.split(".");
    const shift = multiplier === 1_000n ? 3 : 6;
    const digits = BigInt(int + frac) * 10n ** BigInt(Math.max(0, shift - frac.length + 2));
    const divisor = 10n ** BigInt(Math.max(0, frac.length - shift - 2));
    if (digits % divisor !== 0n) return { ok: false, reason: "too-precise", currency };
    cents = digits / divisor;
  } else {
    cents = base * multiplier;
  }

  if (negative && cents > 0n) return { ok: false, reason: "negative", currency };
  if (currency && currency !== "USD") return { ok: false, reason: "currency", currency, value: formatCentsPlain(cents) };
  return { ok: true, value: formatCentsPlain(cents), cents, currency: "USD" };
}

/** "1.234,50" / "1,234.50" / "1 234" (spaces already removed) -> "1234.50"; null if inconsistent. */
function toPlainDecimal(s: string, separator?: DecimalSeparator): string | null {
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  if (dots && commas) {
    // Both: whichever comes last is the decimal separator.
    const decimal = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    const [int, frac, extra] = s.split(decimal);
    if (extra !== undefined || !groupedOk(int, thousands)) return null;
    return `${int.split(thousands).join("")}.${frac}`;
  }
  const sep = dots ? "." : commas ? "," : null;
  if (!sep) return s;
  const parts = s.split(sep);
  const looksGrouped = groupedOk(s, sep) && parts.length > 1 && parts.at(-1)!.length === 3;
  // One separator followed by 1-2 digits is a decimal ("12,5", "1.50").
  const isDecimal =
    parts.length === 2 && (parts[1].length !== 3 || (separator ? separator === sep : sep === "."));
  if (isDecimal) return `${parts[0]}.${parts[1]}`;
  if (looksGrouped) return parts.join("");
  return null;
}

/** "1,234,567" style grouping with `sep` (or no separator at all). */
function groupedOk(int: string, sep: string): boolean {
  if (!int.includes(sep)) return /^\d+$/.test(int);
  const groups = int.split(sep);
  return /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g));
}
