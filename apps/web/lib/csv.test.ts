import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_ROWS, parsePayoutCsv, withoutErrorRows } from "./csv";

const D = 6;
const usd = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10n ** 4n;

describe("parsePayoutCsv", () => {
  it("parses a clean file, case-insensitive headers, $ and commas", () => {
    const sheet = parsePayoutCsv("Email, Amount ,Note\nAna@Example.com ,\"$1,200.50\",March\nkofi@example.com,20,\n", D);
    expect(sheet.fileErrors).toEqual([]);
    expect(sheet.errorRowCount).toBe(0);
    expect(sheet.rows.map((r) => [r.line, r.email, r.amount, r.note])).toEqual([
      [2, "ana@example.com", usd(1200.5), "March"],
      [3, "kofi@example.com", usd(20), ""],
    ]);
    expect(sheet.total).toBe(usd(1220.5));
  });

  it("flags bad emails, non-positive or malformed amounts, and duplicates", () => {
    const sheet = parsePayoutCsv(
      ["email,amount,note", "not-an-email,10,", "a@example.com,0,", "b@example.com,-5,", "c@example.com,12.345,", "d@example.com,,", "A@example.com,5,", "e@example.com,abc,"].join("\n"),
      D,
    );
    const errs = Object.fromEntries(sheet.rows.map((r) => [r.line, r.errors.join(" ")]));
    expect(errs[2]).toMatch(/isn't a valid email/);
    expect(errs[3]).toMatch(/more than \$0.00/);
    expect(errs[4]).toMatch(/more than \$0.00/);
    expect(errs[5]).toMatch(/isn't a dollar amount/);
    expect(errs[6]).toMatch(/Amount is missing/);
    expect(errs[7]).toMatch(/Duplicate of line 3/);
    expect(errs[8]).toMatch(/isn't a dollar amount/);
    expect(sheet.errorRowCount).toBe(7);
  });

  it("explains unquoted thousands separators instead of misreading the amount", () => {
    const [row] = parsePayoutCsv("email,amount,note\ntunde@example.com,$1,250.00,Big\n", D).rows;
    expect(row.amount).toBeNull();
    expect(row.errors.join(" ")).toMatch(/Too many commas/);
  });

  it("reports missing columns and empty files", () => {
    expect(parsePayoutCsv("name,amount\nx,1", D).fileErrors[0]).toMatch(/Missing column: email/);
    expect(parsePayoutCsv("email,amount,note\n", D).fileErrors[0]).toMatch(/no rows/);
  });

  it("enforces the row limit", () => {
    const lines = ["email,amount"];
    for (let i = 0; i <= MAX_ROWS; i++) lines.push(`p${i}@example.com,1`);
    expect(parsePayoutCsv(lines.join("\n"), D).fileErrors.join(" ")).toMatch(/limit per payout/);
  });

  it("drops error rows on request", () => {
    const clean = withoutErrorRows(parsePayoutCsv("email,amount\na@example.com,10\nbad,5\n", D));
    expect(clean.rows).toHaveLength(1);
    expect(clean.total).toBe(usd(10));
  });

  it("ships a valid 50-row sample totalling $12,400.00", () => {
    const sheet = parsePayoutCsv(readFileSync("public/sample-payouts.csv", "utf8"), D);
    expect(sheet.fileErrors).toEqual([]);
    expect(sheet.errorRowCount).toBe(0);
    expect(sheet.rows).toHaveLength(50);
    expect(sheet.total).toBe(usd(12_400));
    expect(sheet.rows.every((r) => r.email.endsWith("@example.com"))).toBe(true);
  });
});

describe("language column", () => {
  it("reads an optional language for the claim email", () => {
    const sheet = parsePayoutCsv("email,amount,language\na@x.com,1,es\nb@x.com,1,Portuguese\nc@x.com,1,\nd@x.com,1,klingon", D);
    expect(sheet.rows.map((r) => r.language)).toEqual(["es", "pt", undefined, undefined]);
    expect(sheet.rows[3].errors[0]).toMatch(/Language "klingon" isn't available/);
    expect(sheet.errorRowCount).toBe(1);
  });
});
