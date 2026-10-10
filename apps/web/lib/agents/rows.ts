import Papa from "papaparse";
import { MAX_ROWS, parsePayoutCsv } from "@/lib/csv";

/**
 * Payout rows from an agent (MCP tool or x402 request), checked with exactly the rules a CSV upload
 * gets (lib/csv.ts): valid email, no duplicates, amount above $0.00, note up to 140 characters,
 * at most MAX_ROWS people. On top of that, amounts must be strings with two decimals ("12.50"),
 * so a model can't send a float that rounds differently than it meant.
 */

export type AgentRowInput = { email?: unknown; amount?: unknown; note?: unknown };
export type ValidRow = { email: string; amount: bigint; note: string };
export type RowProblem = { row: number; email: string; problems: string[] };

export type CheckedRows =
  | { ok: true; rows: ValidRow[]; total: bigint }
  | { ok: false; problems: RowProblem[]; message: string };

export const AMOUNT_RE = /^\d{1,12}\.\d{2}$/;

/** Base units -> "1234.56" (truncates below the cent). For agent-facing results: no "$", no commas. */
export function toAmountString(amount: bigint, decimals: number): string {
  const cents = decimals >= 2 ? amount / 10n ** BigInt(decimals - 2) : amount * 10n ** BigInt(2 - decimals);
  const digits = cents.toString().padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export function checkAgentRows(input: unknown, decimals: number, maxRows = MAX_ROWS): CheckedRows {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, problems: [], message: "Send at least one row: { email, amount, note? }." };
  }
  if (input.length > maxRows) {
    return { ok: false, problems: [], message: `That's ${input.length} people. One payout can pay up to ${maxRows}; split it into several payouts.` };
  }

  const problems: RowProblem[] = [];
  const records = input.map((raw, i) => {
    const r = (raw ?? {}) as AgentRowInput;
    const email = typeof r.email === "string" ? r.email : "";
    const rowProblems: string[] = [];
    if (typeof r.amount === "number") rowProblems.push(`Send the amount as a string with two decimals, like "${r.amount.toFixed(2)}".`);
    else if (typeof r.amount !== "string" || !AMOUNT_RE.test(r.amount.trim())) {
      rowProblems.push(`Amount must be a string with two decimals, like "25.00" (got ${JSON.stringify(r.amount ?? null)}).`);
    }
    if (r.note !== undefined && r.note !== null && typeof r.note !== "string") rowProblems.push("Note must be text.");
    if (rowProblems.length) problems.push({ row: i + 1, email, problems: rowProblems });
    return { email, amount: typeof r.amount === "string" ? r.amount.trim() : "", note: typeof r.note === "string" ? r.note : "" };
  });

  // Same parser as an uploaded file, so the rules can't drift apart.
  const sheet = parsePayoutCsv(Papa.unparse(records, { columns: ["email", "amount", "note"], quotes: true }), decimals);
  for (const row of sheet.rows) {
    if (!row.errors.length) continue;
    const index = row.line - 2;
    const existing = problems.find((p) => p.row === index + 1);
    // "Duplicate of line 3" -> "Duplicate of row 2": agents think in rows, not file lines.
    const errors = row.errors.map((e) => e.replace(/Duplicate of line (\d+)\./, (_, l) => `Same email as row ${Number(l) - 1}.`));
    if (existing) existing.problems.push(...errors.filter((e) => !existing.problems.includes(e) && !/dollar amount|Amount/.test(e)));
    else problems.push({ row: index + 1, email: row.email, problems: errors });
  }
  if (sheet.fileErrors.length || problems.length) {
    problems.sort((a, b) => a.row - b.row);
    const message = sheet.fileErrors[0] ?? `${problems.length === 1 ? "1 row has" : `${problems.length} rows have`} problems. Nothing was created; fix them and try again.`;
    return { ok: false, problems, message };
  }
  const rows = sheet.rows.map((r) => ({ email: r.email, amount: r.amount!, note: r.note }));
  return { ok: true, rows, total: rows.reduce((s, r) => s + r.amount, 0n) };
}
