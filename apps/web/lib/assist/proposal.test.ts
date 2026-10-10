import { describe, expect, it } from "vitest";
import { parsePayoutCsv } from "@/lib/csv";
import {
  buildProposal,
  canMerge,
  editAmount,
  flagRows,
  mergeDuplicates,
  proposalToCsv,
  summarize,
  summaryLine,
  type SheetReading,
} from "./proposal";
import { readTable } from "./table";

const reading = (columns: Partial<SheetReading["columns"]>, extra: Partial<SheetReading> = {}): SheetReading => ({
  columns: { email: 0, amount: 1, name: null, note: null, currency: null, country: null, language: null, ...columns },
  decimalSeparator: null,
  fileCurrency: null,
  amounts: [],
  ...extra,
});

const kinds = (flags: ReturnType<typeof flagRows>, id: number) => flags.get(id)?.map((f) => f.kind) ?? [];

describe("readTable", () => {
  it("reads tab-separated pastes and semicolon CSVs", () => {
    expect(readTable("Name\tEmail\tEarned\nAna\tana@x.com\t$1,200.00").headers).toEqual(["Name", "Email", "Earned"]);
    const semi = readTable("email;amount\nana@x.com;1.234,50\nbo@x.com;12,00");
    expect(semi.rows).toEqual([
      ["ana@x.com", "1.234,50"],
      ["bo@x.com", "12,00"],
    ]);
  });

  it("treats a first row with an email as data", () => {
    const t = readTable("ana@x.com,10\nbo@x.com,20");
    expect(t.hasHeader).toBe(false);
    expect(t.headers).toEqual(["Column 1", "Column 2"]);
    expect(t.rows).toHaveLength(2);
  });

  it("refuses empty and oversized input", () => {
    expect(() => readTable("  ")).toThrow();
    expect(() => readTable(`email,amount\n${"a@b.co,1\n".repeat(401)}`)).toThrow(/rows/);
  });
});

describe("buildProposal", () => {
  it("maps columns, normalises amounts and skips empty and total rows", () => {
    const table = readTable(
      [
        "Creator,Email,Net payout,Country",
        'Ana,ANA@x.com,"$1,200.00",Brazil',
        "Bo,bo@x.com,1.2k,US",
        ",,,",
        "Total,,1300.00,",
      ].join("\n"),
    );
    const { rows, emptyRows } = buildProposal(table, reading({ email: 1, amount: 2, name: 0, country: 3 }));
    expect(emptyRows).toBe(1); // the blank line never reaches here; the total row is dropped
    expect(rows.map((r) => [r.email, r.amount, r.name, r.language])).toEqual([
      ["ana@x.com", "1200.00", "Ana", "pt"],
      ["bo@x.com", "1200.00", "Bo", "en"],
    ]);
  });

  it("uses the assistant's reading only where the plain reader fails, and flags it", () => {
    const table = readTable("email,amount\nana@x.com,twelve hundred\nbo@x.com,30");
    const { rows } = buildProposal(table, reading({}, { amounts: [{ row: 0, value: "1200.00" }, { row: 1, value: "999.00" }] }));
    expect(rows[0]).toMatchObject({ amount: "1200.00", amountFrom: "assistant" });
    expect(rows[1]).toMatchObject({ amount: "30.00", amountFrom: "file" });
    expect(kinds(flagRows(rows), 0)).toEqual(["assistant-amount"]);
  });

  it("marks other currencies from the cell, a currency column or the whole file", () => {
    const table = readTable("email,amount,cur\na@x.com,€30,\nb@x.com,30,EUR\nc@x.com,30,USD");
    const { rows } = buildProposal(table, reading({ currency: 2 }));
    expect(rows.map((r) => r.currency)).toEqual(["EUR", "EUR", null]);
    const whole = buildProposal(readTable("email,amount\na@x.com,30"), reading({}, { fileCurrency: "GBP" }));
    expect(whole.rows[0].currency).toBe("GBP");
  });
});

describe("flagRows", () => {
  const table = readTable(
    [
      "email,amount",
      "ana@x.com,10",
      "bo@x.com,12",
      "cy@x.com,11",
      "di@x.com,9",
      "ed@x.com,950",
      "ana@x.com,5",
      "not-an-email,10",
      ",10",
      "fe@x.com,",
      "gi@x.com,abc",
    ].join("\n"),
  );
  const { rows } = buildProposal(table, reading({}));
  const flags = flagRows(rows);

  it("finds invalid, missing and duplicate emails", () => {
    expect(kinds(flags, 5)).toEqual(["duplicate"]);
    expect(flags.get(5)![0].duplicateOf).toBe(0);
    expect(kinds(flags, 6)).toEqual(["invalid-email"]);
    expect(kinds(flags, 7)).toEqual(["missing-email"]);
  });

  it("finds missing and unreadable amounts", () => {
    expect(kinds(flags, 8)).toEqual(["missing-amount"]);
    expect(kinds(flags, 9)).toEqual(["bad-amount"]);
  });

  it("flags amounts far above the file's typical value, as a warning", () => {
    expect(kinds(flags, 4)).toEqual(["outlier"]);
    expect(flags.get(4)![0].blocking).toBe(false);
    expect(kinds(flags, 0)).toEqual([]);
  });

  it("flags amounts far above what the payee usually gets", () => {
    const usual = new Map([["bo@x.com", 1_00n]]);
    expect(kinds(flagRows(rows, usual), 1)).toEqual([]); // $12 vs $1: under the $50 floor
    const usualEd = new Map([["ed@x.com", 100_00n]]);
    expect(kinds(flagRows(rows, usualEd), 4)).toEqual(["outlier", "above-usual"]);
  });

  it("summarises what's left to check", () => {
    const s = summarize(rows, flags);
    expect(s).toMatchObject({ people: 10, toCheck: 6 });
    expect(summaryLine(s)).toBe("10 people, $1,017 · 6 to check");
    const checked = rows.map((r) => (r.id === 4 ? { ...r, checked: true } : r));
    expect(summarize(checked, flagRows(checked)).toCheck).toBe(5);
  });

  it("doesn't flag outliers in small files", () => {
    const small = buildProposal(readTable("email,amount\na@x.com,1\nb@x.com,900"), reading({})).rows;
    expect([...flagRows(small).values()].flat()).toEqual([]);
  });
});

describe("fixing rows", () => {
  it("merges duplicates by adding cents", () => {
    const { rows } = buildProposal(readTable('email,amount,note\na@x.com,10.10,May\nA@x.com,"$5.05",June\nb@x.com,1'), reading({ note: 2 }));
    expect(canMerge(rows, "a@x.com")).toBe(15_15n);
    const merged = mergeDuplicates(rows, "a@x.com");
    expect(merged[0]).toMatchObject({ amount: "15.15", note: "May; June", dropped: false });
    expect(merged[1].dropped).toBe(true);
    expect([...flagRows(merged).values()].flat()).toEqual([]);
  });

  it("re-reads an edited amount", () => {
    const { rows } = buildProposal(readTable("email,amount\na@x.com,€30"), reading({}));
    const fixed = editAmount(rows[0], "32.40");
    expect(fixed).toMatchObject({ amount: "32.40", currency: null, amountFrom: "you" });
    expect(kinds(flagRows([fixed]), 0)).toEqual([]);
  });
});

describe("proposalToCsv", () => {
  it("goes through the same checks as an upload", () => {
    const table = readTable("Email,Amount,Lang\nana@x.com,$1.2k,es\nbo@x.com,€30,\nbad,5,\ncy@x.com,7,");
    const { rows } = buildProposal(table, reading({ language: 2 }));
    const kept = rows.map((r) => (r.email === "cy@x.com" ? { ...r, dropped: true } : r));
    const sheet = parsePayoutCsv(proposalToCsv(kept));
    expect(sheet.rows.map((r) => [r.email, r.amountRaw, r.language, r.errors.length > 0])).toEqual([
      ["ana@x.com", "1200.00", "es", false],
      ["bo@x.com", "EUR €30", undefined, true],
      ["bad", "5.00", undefined, true],
    ]);
  });
});
