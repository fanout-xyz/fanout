import { AiInvalid, check } from "@/lib/ai/validate";
import type { RiskKind } from "@/lib/payout-risk";

/**
 * Optional plain-language wording for the unusual-payout warning. The checks themselves are code
 * (lib/payout-risk.ts); the AI gets only which rules fired and their numbers (no emails, no names),
 * and its answer may not mention a dollar figure that isn't one of those numbers.
 */

const KINDS: RiskKind[] = ["total-high", "first-large", "new-payee-large", "same-amount", "many-new"];
export const MAX_REASONS = KINDS.length;

export type RiskFacts = { kind: RiskKind; facts: Record<string, number> }[];

export const RISK_SYSTEM_PROMPT = `You explain to a business why a payout it is about to send was flagged as unusual. The user message is JSON: a list of checks that fired, each with a kind and its numbers.
Kinds: "total-high" (total far above their usual payout), "first-large" (a large first payout), "new-payee-large" (people never paid before get large amounts), "same-amount" (many people get exactly the same amount), "many-new" (most people were never paid before).
Write 1 to 3 short, calm, plain sentences that say what looks different and what to double-check. Money in US dollars like $1,200. Use only the numbers given. No crypto words, no blame, no advice to contact anyone.
Return only {"explanation": "..."}.`;

export function riskUserMessage(reasons: RiskFacts): string {
  return JSON.stringify(reasons);
}

export function validRiskRequest(body: Record<string, unknown>): RiskFacts | null {
  const { reasons } = body;
  if (!Array.isArray(reasons) || reasons.length === 0 || reasons.length > MAX_REASONS) return null;
  const out: RiskFacts = [];
  for (const r of reasons) {
    const { kind, facts } = (r ?? {}) as { kind?: unknown; facts?: unknown };
    if (typeof kind !== "string" || !KINDS.includes(kind as RiskKind)) return null;
    if (typeof facts !== "object" || facts === null || Array.isArray(facts)) return null;
    const entries = Object.entries(facts);
    if (entries.length > 6 || !entries.every(([k, v]) => /^[a-z_]{1,32}$/.test(k) && typeof v === "number" && Number.isFinite(v))) return null;
    out.push({ kind: kind as RiskKind, facts: Object.fromEntries(entries) as Record<string, number> });
  }
  return out;
}

/** Dollar figures in a sentence: "$1,200.50" -> 1200.5. */
function dollarFigures(text: string): number[] {
  return [...text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
}

export function riskExplanationSchema(reasons: RiskFacts) {
  const shape = check.object({ explanation: check.string({ min: 10, max: 500 }) });
  const allowed = reasons.flatMap((r) => Object.values(r.facts));
  return (value: unknown, path: string): { explanation: string } => {
    const { explanation } = shape(value, path);
    if (/https?:|www\./i.test(explanation)) throw new AiInvalid("explanation has a link");
    // Every dollar amount must be one of the checked numbers (rounded to the cent or the dollar).
    const unknown = dollarFigures(explanation).find((n) => !allowed.some((a) => Math.abs(a - n) < 0.01 || Math.round(a) === n));
    if (unknown !== undefined) throw new AiInvalid("explanation has a dollar amount that wasn't given");
    return { explanation: explanation.trim() };
  };
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Demo stand-in: a fixed template from the same facts. */
export function demoRiskExplanation(reasons: RiskFacts): { explanation: string } {
  const parts = reasons.map(({ kind, facts }) => {
    switch (kind) {
      case "total-high":
        return `At ${usd(facts.total_usd)}, this is much bigger than your usual ${usd(facts.usual_total_usd)} payout.`;
      case "first-large":
        return `It's a large first payout (${usd(facts.total_usd)}).`;
      case "new-payee-large":
        return `${facts.new_large_count} new ${facts.new_large_count === 1 ? "person gets" : "people get"} far more than the usual ${usd(facts.usual_per_person_usd)}.`;
      case "same-amount":
        return `${facts.same_count} people get the same ${usd(facts.amount_usd)}.`;
      case "many-new":
        return `${facts.new_count} of ${facts.people} people are new to you.`;
    }
  });
  return { explanation: `${parts.join(" ")} Check the file is the one you meant to send.` };
}
