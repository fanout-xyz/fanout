import Papa from "papaparse";
import { normalizeEmail } from "./email-hash";
import { parseUsd } from "./money";

/** Payout CSV: columns email, amount, note (note optional). Header names are case-insensitive. */

/** Matches BatchPayout.MAX_ROWS onchain: a full batch must fit in one transaction. */
export const MAX_ROWS = 150;
export const MAX_NOTE_LENGTH = 140;
export const MAX_FILE_BYTES = 1_000_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type PayoutRow = {
  /** 1-based line number in the file (header is line 1), for error messages. */
  line: number;
  email: string;
  /** Base units, or null if the amount didn't parse. */
  amount: bigint | null;
  amountRaw: string;
  note: string;
  errors: string[];
};

export type PayoutSheet = {
  rows: PayoutRow[];
  /** Problems with the file as a whole (missing columns, too many rows, ...). */
  fileErrors: string[];
  /** Sum of rows whose amount parsed (errors or not). */
  total: bigint;
  errorRowCount: number;
};

export function parsePayoutCsv(text: string, decimals?: number): PayoutSheet {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const fileErrors: string[] = [];
  const fields = parsed.meta.fields ?? [];
  const missing = ["email", "amount"].filter((f) => !fields.includes(f));
  if (missing.length) {
    fileErrors.push(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected email, amount, note.`);
    return { rows: [], fileErrors, total: 0n, errorRowCount: 0 };
  }
  if (parsed.data.length === 0) fileErrors.push("The file has a header but no rows.");
  if (parsed.data.length > MAX_ROWS) fileErrors.push(`This file has ${parsed.data.length} rows. The limit per payout is ${MAX_ROWS}.`);

  const firstLineForEmail = new Map<string, number>();
  const rows: PayoutRow[] = parsed.data.map((record, i) => {
    const line = i + 2;
    const email = normalizeEmail(record.email ?? "");
    const amountRaw = (record.amount ?? "").trim();
    const note = (record.note ?? "").trim();
    const errors: string[] = [];

    if (!email) errors.push("Email is missing.");
    else if (!EMAIL_RE.test(email)) errors.push(`"${email}" isn't a valid email.`);
    else if (firstLineForEmail.has(email)) errors.push(`Duplicate of line ${firstLineForEmail.get(email)}.`);
    else firstLineForEmail.set(email, line);

    const amount = amountRaw ? parseUsd(amountRaw, decimals) : null;
    if (!amountRaw) errors.push("Amount is missing.");
    else if (/^-/.test(amountRaw.replace(/^\$/, ""))) errors.push("Amount must be more than $0.00.");
    else if (amount === null) errors.push(`"${amountRaw}" isn't a dollar amount (use 1234.56).`);
    else if (amount <= 0n) errors.push("Amount must be more than $0.00.");

    if (note.length > MAX_NOTE_LENGTH) errors.push(`Note is longer than ${MAX_NOTE_LENGTH} characters.`);

    return { line, email, amount, amountRaw, note, errors };
  });

  // Papaparse reports malformed quotes / field counts per row.
  for (const err of parsed.errors) {
    const row = typeof err.row === "number" ? rows[err.row] : undefined;
    if (!row) {
      fileErrors.push(err.message);
      continue;
    }
    // The split fields can't be trusted (e.g. $1,250.00 unquoted reads as "$1").
    row.amount = null;
    row.errors = [
      err.code === "TooManyFields"
        ? "Too many commas on this line. Put amounts like 1,250.00 in quotes, or drop the comma."
        : "This line couldn't be read. Check quotes and commas.",
    ];
  }

  const total = rows.reduce((sum, r) => sum + (r.amount && r.amount > 0n ? r.amount : 0n), 0n);
  return { rows, fileErrors, total, errorRowCount: rows.filter((r) => r.errors.length).length };
}

/** Drops rows with errors. Totals are recomputed. */
export function withoutErrorRows(sheet: PayoutSheet): PayoutSheet {
  const rows = sheet.rows.filter((r) => r.errors.length === 0);
  return { ...sheet, rows, total: rows.reduce((s, r) => s + r.amount!, 0n), errorRowCount: 0 };
}
