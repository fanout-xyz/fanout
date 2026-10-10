import Papa from "papaparse";
import { EMAIL_RE, MAX_NOTE_LENGTH } from "@/lib/csv";
import { normalizeEmail } from "@/lib/email-hash";
import { languageForCountry, normalizeLanguage, type Lang } from "@/lib/i18n/languages";
import { formatCentsPlain, readAmount, type DecimalSeparator } from "./amount";
import type { Table } from "./table";

/**
 * The spreadsheet assistant's proposal: rows read from any table using the column mapping the
 * assistant suggested, with every check done here in code (email format, duplicates, amounts far
 * from the file's typical value, other currencies). The person fixes or drops flagged rows; the
 * result becomes a plain email,amount,note,language CSV and goes through parsePayoutCsv like any
 * upload before it can be approved.
 */

export type ColumnMapping = {
  email: number;
  amount: number;
  name: number | null;
  note: number | null;
  currency: number | null;
  country: number | null;
  language: number | null;
};

/** What the assistant returns (validated in lib/assist/sheet-ai.ts). */
export type SheetReading = {
  columns: ColumnMapping;
  decimalSeparator: DecimalSeparator | null;
  /** A currency the whole file is in, when a header or title says so (e.g. "Amount (EUR)"). */
  fileCurrency: string | null;
  /** Amounts the assistant read where the plain reader couldn't, e.g. "twelve hundred". Data rows are 0-based. */
  amounts: { row: number; value: string }[];
};

export type ProposedRow = {
  id: number;
  /** 1-based data row in the original file (after any header). */
  sourceRow: number;
  email: string;
  amountRaw: string;
  /** "1200.00", or null when it couldn't be read as dollars. */
  amount: string | null;
  amountFrom: "file" | "assistant" | "you";
  /** A currency other than dollars found in the amount, its column or the file. */
  currency: string | null;
  name: string;
  note: string;
  language: Lang | null;
  dropped: boolean;
  /** The person looked at this row's warnings and kept it. */
  checked: boolean;
};

export type FlagKind =
  | "missing-email"
  | "invalid-email"
  | "duplicate"
  | "missing-amount"
  | "bad-amount"
  | "currency"
  | "note-too-long"
  | "assistant-amount"
  | "outlier"
  | "above-usual";

/** blocking: must be fixed or dropped. Otherwise a warning the person confirms. */
export type Flag = { kind: FlagKind; message: string; blocking: boolean; duplicateOf?: number };

/** A row is "far above" the file's typical amount at this multiple of the median. */
export const OUTLIER_MULTIPLE = 5n;
/** ...and at least this much, so $5 among $1 tips isn't flagged. */
export const OUTLIER_MIN_CENTS = 50_00n;

const cell = (row: string[], i: number | null) => (i === null ? "" : (row[i] ?? "").trim());

export function buildProposal(table: Table, reading: SheetReading): { rows: ProposedRow[]; emptyRows: number } {
  const { columns } = reading;
  const fromAssistant = new Map(reading.amounts.map((a) => [a.row, a.value]));
  const rows: ProposedRow[] = [];
  let emptyRows = 0;

  table.rows.forEach((r, i) => {
    if (r.every((c) => !c.trim())) {
      emptyRows++;
      return;
    }
    const email = normalizeEmail(cell(r, columns.email));
    const amountRaw = cell(r, columns.amount);
    // Totals and subtotals at the bottom of exports: no email, and a label like "Total".
    if (!email && r.some((c) => /^(sub)?total\b/i.test(c.trim()))) {
      emptyRows++;
      return;
    }
    if (!email && !amountRaw) {
      emptyRows++;
      return;
    }

    const read = readAmount(amountRaw, reading.decimalSeparator ?? undefined);
    const columnCurrency = cell(r, columns.currency).toUpperCase() || null;
    let amount: string | null = read.ok ? read.value : null;
    let amountFrom: ProposedRow["amountFrom"] = "file";
    let currency: string | null = read.ok ? null : read.reason === "currency" ? read.currency : null;
    if (!currency && columnCurrency && !/^(USD|US\$|\$)$/.test(columnCurrency)) currency = columnCurrency;
    if (!currency && reading.fileCurrency && reading.fileCurrency !== "USD") currency = reading.fileCurrency;

    const assisted = fromAssistant.get(i);
    if (!read.ok && !currency && assisted && read.reason !== "empty" && read.reason !== "negative") {
      amount = assisted;
      amountFrom = "assistant";
    }

    const language = normalizeLanguage(cell(r, columns.language)) ?? languageForCountry(cell(r, columns.country));
    rows.push({
      id: rows.length,
      sourceRow: i + 1,
      email,
      amountRaw,
      amount: currency ? null : amount,
      amountFrom,
      currency,
      name: cell(r, columns.name),
      note: cell(r, columns.note).replace(/\s+/g, " "),
      language,
      dropped: false,
      checked: false,
    });
  });
  return { rows, emptyRows };
}

const toCents = (value: string | null): bigint | null => {
  if (value === null) return null;
  const m = value.match(/^(\d+)\.(\d{2})$/);
  return m ? BigInt(m[1]) * 100n + BigInt(m[2]) : null;
};

/** The middle value (lower middle for an even count). */
export function medianCents(values: bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * Every check, in code. `usual` is what each payee (by email) was typically paid before, when known;
 * it adds a warning for amounts far above it.
 */
export function flagRows(rows: ProposedRow[], usual?: Map<string, bigint>): Map<number, Flag[]> {
  const active = rows.filter((r) => !r.dropped);
  const flags = new Map<number, Flag[]>(active.map((r) => [r.id, []]));
  const add = (r: ProposedRow, f: Flag) => flags.get(r.id)!.push(f);

  const priced = active.map((r) => toCents(r.amount)).filter((c): c is bigint => c !== null && c > 0n);
  const median = priced.length >= 5 ? medianCents(priced) : null;
  const firstFor = new Map<string, ProposedRow>();

  for (const r of active) {
    if (!r.email) add(r, { kind: "missing-email", message: "Email is missing.", blocking: true });
    else if (!EMAIL_RE.test(r.email)) add(r, { kind: "invalid-email", message: `"${r.email}" isn't a valid email.`, blocking: true });
    else if (firstFor.has(r.email)) {
      const first = firstFor.get(r.email)!;
      add(r, { kind: "duplicate", message: `Same person as row ${first.sourceRow}.`, blocking: true, duplicateOf: first.id });
    } else firstFor.set(r.email, r);

    const cents = toCents(r.amount);
    if (r.currency) {
      add(r, { kind: "currency", message: `This amount is in ${r.currency}. Fanout pays in dollars: type the dollar amount, or leave this row out.`, blocking: true });
    } else if (!r.amountRaw && r.amount === null) {
      add(r, { kind: "missing-amount", message: "Amount is missing.", blocking: true });
    } else if (cents === null || cents <= 0n) {
      add(r, { kind: "bad-amount", message: `"${r.amountRaw}" isn't a dollar amount.`, blocking: true });
    } else {
      if (r.amountFrom === "assistant") {
        add(r, { kind: "assistant-amount", message: `Our assistant read "${r.amountRaw}" as $${r.amount}. Check it.`, blocking: false });
      }
      if (median !== null && cents >= median * OUTLIER_MULTIPLE && cents >= OUTLIER_MIN_CENTS) {
        add(r, { kind: "outlier", message: `Much more than most people in this file (typically $${formatCentsPlain(median)}).`, blocking: false });
      }
      const before = r.email ? usual?.get(r.email) : undefined;
      if (before !== undefined && before > 0n && cents >= before * OUTLIER_MULTIPLE && cents >= OUTLIER_MIN_CENTS) {
        add(r, { kind: "above-usual", message: `Much more than this person usually gets ($${formatCentsPlain(before)}).`, blocking: false });
      }
    }
    if (r.note.length > MAX_NOTE_LENGTH) add(r, { kind: "note-too-long", message: `Note is longer than ${MAX_NOTE_LENGTH} characters.`, blocking: true });
  }
  return flags;
}

/** A row still needs the person: a blocking flag, or warnings not yet confirmed. */
export function needsAttention(row: ProposedRow, rowFlags: Flag[] | undefined): boolean {
  if (row.dropped || !rowFlags?.length) return false;
  return rowFlags.some((f) => f.blocking) || !row.checked;
}

export type ProposalSummary = { people: number; totalCents: bigint; toCheck: number; dropped: number };

export function summarize(rows: ProposedRow[], flags: Map<number, Flag[]>): ProposalSummary {
  const active = rows.filter((r) => !r.dropped);
  return {
    people: active.length,
    totalCents: active.reduce((s, r) => s + (r.currency ? 0n : (toCents(r.amount) ?? 0n)), 0n),
    toCheck: active.filter((r) => needsAttention(r, flags.get(r.id))).length,
    dropped: rows.length - active.length,
  };
}

/** "48 people, $3,912 · 2 to check". */
export function summaryLine(s: ProposalSummary): string {
  const dollars = Number(s.totalCents) / 100;
  const total = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: s.totalCents % 100n === 0n ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(dollars);
  const people = `${s.people} ${s.people === 1 ? "person" : "people"}, ${total}`;
  return s.toCheck ? `${people} · ${s.toCheck} to check` : people;
}

/** Folds every later row for the same email into the first: amounts added (in cents), notes joined. */
export function mergeDuplicates(rows: ProposedRow[], email: string): ProposedRow[] {
  const same = rows.filter((r) => !r.dropped && r.email === email);
  if (same.length < 2 || same.some((r) => toCents(r.amount) === null || r.currency)) return rows;
  const [first, ...rest] = same;
  const total = same.reduce((s, r) => s + toCents(r.amount)!, 0n);
  const notes = [...new Set(same.map((r) => r.note).filter(Boolean))].join("; ");
  const restIds = new Set(rest.map((r) => r.id));
  return rows.map((r) =>
    r.id === first.id
      ? { ...r, amount: formatCentsPlain(total), amountFrom: "you" as const, note: notes, checked: false }
      : restIds.has(r.id)
        ? { ...r, dropped: true }
        : r,
  );
}

/** Whether a duplicate group can be merged (every amount read as dollars). */
export function canMerge(rows: ProposedRow[], email: string): bigint | null {
  const same = rows.filter((r) => !r.dropped && r.email === email);
  if (same.length < 2) return null;
  let total = 0n;
  for (const r of same) {
    const c = toCents(r.amount);
    if (c === null || r.currency) return null;
    total += c;
  }
  return total;
}

/** A person's edit to the amount: read with the same rules, and no longer the assistant's reading. */
export function editAmount(row: ProposedRow, typed: string): ProposedRow {
  const read = readAmount(typed, ".");
  return {
    ...row,
    amountFrom: "you",
    amountRaw: typed,
    amount: read.ok ? read.value : null,
    currency: !read.ok && read.reason === "currency" ? read.currency : null,
    checked: false,
  };
}

export function editEmail(row: ProposedRow, typed: string): ProposedRow {
  return { ...row, email: normalizeEmail(typed), checked: false };
}

/**
 * The rows that are kept, as the payout CSV. Amounts that aren't plain dollars are written as they
 * were in the file, so parsePayoutCsv refuses them exactly as it would in an upload.
 */
export function proposalToCsv(rows: ProposedRow[]): string {
  const active = rows.filter((r) => !r.dropped);
  return Papa.unparse({
    fields: ["email", "amount", "note", "language"],
    data: active.map((r) => [
      r.email,
      r.currency ? `${r.currency} ${r.amountRaw}` : (r.amount ?? r.amountRaw),
      r.note,
      r.language ?? "",
    ]),
  });
}
