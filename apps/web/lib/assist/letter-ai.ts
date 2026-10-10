import { AiInvalid, check } from "@/lib/ai/validate";
import { languageInfo, normalizeLanguage, type Lang } from "@/lib/i18n/languages";
import type { PassportStatement } from "@/lib/payee/passport";

/**
 * "Write a letter for a landlord or lender": the assistant drafts a short income letter from what a
 * signed Earnings Passport states, and nothing else. It gets the period, the monthly floor and the
 * number of platforms: no payments, no name, no email, no account. The verify link is put in by
 * code where the letter says {verify_link}. The payee edits the draft before copying it.
 */

export const LETTER_LINK = "{verify_link}";
export const AUDIENCES = ["landlord", "lender", "other"] as const;
export type Audience = (typeof AUDIENCES)[number];

export type LetterFacts = {
  language: Lang;
  audience: Audience;
  /** "July 2026", oldest first. */
  firstMonth: string;
  lastMonth: string;
  months: number;
  minMonthlyUsd: number;
  platforms: number;
  /** "October 10, 2026". */
  issued: string;
};

const monthName = (month: string, locale: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
};

export function letterFacts(s: PassportStatement, language: Lang, audience: Audience): LetterFacts {
  const locale = languageInfo(language).locale;
  return {
    language,
    audience,
    firstMonth: monthName(s.months[0], locale),
    lastMonth: monthName(s.months.at(-1)!, locale),
    months: s.months.length,
    minMonthlyUsd: s.minMonthlyUsd,
    platforms: s.platforms,
    issued: new Date(s.issuedAt).toLocaleDateString(locale, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }),
  };
}

export function parseLetterOptions(body: Record<string, unknown>): { language: Lang; audience: Audience } | null {
  const language = typeof body.language === "string" ? normalizeLanguage(body.language) : null;
  const audience = AUDIENCES.find((a) => a === body.audience);
  return language && audience ? { language, audience } : null;
}

export const LETTER_SYSTEM_PROMPT = `You draft a short, plain income letter that a freelancer gives to a landlord or lender. The user message is JSON with the only facts you may use:
{"language", "audience", "firstMonth", "lastMonth", "months", "minMonthlyUsd", "platforms", "issued"}.
The facts come from a signed Earnings Passport that the reader can check online.

Write the letter in the given language. 120 to 220 words. Plain, polite, no exaggeration. Say:
- that the writer earned at least minMonthlyUsd US dollars every month from firstMonth to lastMonth (months months), paid by platforms different platforms;
- that Fanout, the payout service, checked this from the payouts the writer actually received, and that the reader can check it at the link;
- the date issued.
Put the exact text {verify_link} on its own line where the link goes. Start with a greeting to the audience ("Dear landlord", or similar), end with a closing and the line [Your name].
Do not mention any other number, any single payment, employers or platform names, or anything not in the facts. No crypto words. Do not invent details.
Return only {"letter": "..."}.`;

export function letterUserMessage(facts: LetterFacts): string {
  return JSON.stringify({ ...facts, language: languageInfo(facts.language).name });
}

// Native digits (Devanagari, Bengali, Arabic-Indic, Extended Arabic-Indic) read as 0-9.
const ZEROS = [0x0966, 0x09e6, 0x0660, 0x06f0];
function asciiDigits(text: string): string {
  return text.replace(/[०-९০-৯٠-٩۰-۹]/g, (c) => {
    const code = c.codePointAt(0)!;
    const zero = ZEROS.find((z) => code >= z && code <= z + 9)!;
    return String(code - zero);
  });
}

/** Numbers in a text: "1,200", "1.200,00", "1 200" -> 1200; plain numbers as they are. */
export function numbersIn(text: string): number[] {
  // Grouped thousands ("1,200", "1.200", "1 200") or a plain number, with optional cents (dropped).
  const re = /\d{1,3}(?:[.,   ]\d{3})+(?!\d)(?:[.,]\d{1,2}(?!\d))?|\d+(?:[.,]\d{1,2}(?!\d))?/g;
  return [...asciiDigits(text).matchAll(re)].map((m) => Number(m[0].replace(/[.,]\d{1,2}$/, "").replace(/[.,   ]/g, "")));
}

/**
 * Checks the draft: the right length, the link placeholder, no links or emails of its own, and no
 * number that isn't one of the facts (so it can't invent payments or amounts).
 */
export function letterSchema(facts: LetterFacts, issuedAt: number, monthsList: string[]) {
  const shape = check.object({ letter: check.string({ min: 200, max: 3000 }) });
  const allowed = new Set<number>([facts.minMonthlyUsd, facts.platforms, facts.months]);
  for (const m of monthsList) allowed.add(Number(m.slice(0, 4))).add(Number(m.slice(5)));
  const issued = new Date(issuedAt);
  allowed.add(issued.getUTCFullYear()).add(issued.getUTCDate()).add(issued.getUTCMonth() + 1);
  return (value: unknown, path: string): { letter: string } => {
    let { letter } = shape(value, path);
    letter = letter.trim();
    if (/https?:|www\.|[^\s@]+@[^\s@]+\.\w/i.test(letter)) throw new AiInvalid("letter has a link or email");
    const withoutLink = letter.split(LETTER_LINK).join(" ");
    const stray = numbersIn(withoutLink).find((n) => !allowed.has(n));
    if (stray !== undefined) throw new AiInvalid("letter has a number that isn't in the passport");
    if (!letter.includes(LETTER_LINK)) letter = `${letter}\n\n${LETTER_LINK}`;
    return { letter };
  };
}

/** Demo stand-in (mock mode without a key): a fixed English letter from the same facts. */
export function demoLetter(f: LetterFacts): { letter: string } {
  const reader = f.audience === "landlord" ? "Dear landlord," : f.audience === "lender" ? "Dear lender," : "To whom it may concern,";
  const usd = `$${f.minMonthlyUsd.toLocaleString("en-US")}`;
  const period = f.months === 1 ? f.firstMonth : `${f.firstMonth} to ${f.lastMonth}`;
  return {
    letter: [
      reader,
      "",
      `I'm writing to confirm my income. From ${period}, I earned at least ${usd} every month in payouts, from ${f.platforms} ${f.platforms === 1 ? "platform" : "different platforms"}.`,
      "",
      "Fanout, the service those payouts came through, checked this against the payouts I actually received. You can see the check for yourself here:",
      "",
      LETTER_LINK,
      "",
      `The check is dated ${f.issued}. It confirms the amount above without showing individual payments.`,
      "",
      "Please let me know if you need anything else.",
      "",
      "Kind regards,",
      "[Your name]",
    ].join("\n"),
  };
}
