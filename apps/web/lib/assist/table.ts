import Papa from "papaparse";

/**
 * Any table people paste or export (CSV, TSV, semicolon CSV from Excel in Europe, a range copied from
 * Google Sheets, Stripe or Shopify exports) as a header row and string cells.
 */

/** More than a payout's 150 rows, so a file with blanks, duplicates or totals still reads. */
export const MAX_TABLE_ROWS = 400;
export const MAX_TABLE_COLUMNS = 40;
export const MAX_TABLE_CHARS = 200_000;
/** Cells are cut to this before going to the assistant; nothing useful is longer. */
export const MAX_CELL_CHARS = 120;

export type Table = { headers: string[]; rows: string[][]; hasHeader: boolean };

export class TableUnreadable extends Error {}

const EMAIL_IN = /[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}/;

export function readTable(text: string): Table {
  const clean = text.replace(/^﻿/, "");
  if (!clean.trim()) throw new TableUnreadable("There's nothing in it.");
  if (clean.length > MAX_TABLE_CHARS) throw new TableUnreadable("That's too much to read at once. Split it into smaller payouts.");

  const parsed = Papa.parse<string[]>(clean.trim(), { skipEmptyLines: "greedy", delimitersToGuess: ["\t", ",", ";", "|"] });
  const grid = parsed.data.map((r) => r.map((c) => (c ?? "").trim()));
  if (grid.length === 0) throw new TableUnreadable("There's nothing in it.");
  const width = Math.max(...grid.map((r) => r.length));
  if (width > MAX_TABLE_COLUMNS) throw new TableUnreadable(`It has ${width} columns. Keep the ones with emails and amounts.`);

  // A first row with an email in it is data, not a header.
  const hasHeader = !grid[0].some((c) => EMAIL_IN.test(c));
  const headerRow = hasHeader ? grid[0] : [];
  const headers = Array.from({ length: width }, (_, i) => headerRow[i]?.trim() || `Column ${i + 1}`);
  const rows = (hasHeader ? grid.slice(1) : grid).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  if (rows.length > MAX_TABLE_ROWS) throw new TableUnreadable(`It has ${rows.length} rows. A payout can pay up to 150 people; split the file.`);
  if (rows.length === 0) throw new TableUnreadable("It has a header but no rows.");
  return { headers, rows, hasHeader };
}

/** What goes to the assistant: headers and cells, cut to MAX_CELL_CHARS. */
export function tableForAi(table: Table): { headers: string[]; rows: string[][] } {
  const cut = (c: string) => c.slice(0, MAX_CELL_CHARS);
  return { headers: table.headers.map(cut), rows: table.rows.map((r) => r.map(cut)) };
}
