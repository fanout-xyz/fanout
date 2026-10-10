import { describe, expect, it } from "vitest";
import { checkAgentRows, toAmountString } from "./rows";

describe("checkAgentRows", () => {
  it("accepts valid rows and totals them in base units", () => {
    const r = checkAgentRows(
      [
        { email: " Ana@Example.com ", amount: "25.00", note: "March" },
        { email: "bo@example.com", amount: "0.50" },
      ],
      6,
    );
    expect(r).toEqual({
      ok: true,
      rows: [
        { email: "ana@example.com", amount: 25_000_000n, note: "March" },
        { email: "bo@example.com", amount: 500_000n, note: "" },
      ],
      total: 25_500_000n,
    });
  });

  it("refuses numbers and amounts without two decimals", () => {
    const r = checkAgentRows(
      [
        { email: "a@example.com", amount: 25 },
        { email: "b@example.com", amount: "25" },
        { email: "c@example.com", amount: "1,000.00" },
      ],
      6,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.map((p) => p.row)).toEqual([1, 2, 3]);
    expect(r.problems[0].problems[0]).toBe('Send the amount as a string with two decimals, like "25.00".');
    expect(r.problems[1].problems[0]).toMatch(/two decimals/);
  });

  it("uses the CSV rules: emails, duplicates, zero amounts, long notes", () => {
    const r = checkAgentRows(
      [
        { email: "not-an-email", amount: "1.00" },
        { email: "a@example.com", amount: "1.00" },
        { email: "A@example.com", amount: "1.00" },
        { email: "z@example.com", amount: "0.00" },
        { email: "n@example.com", amount: "1.00", note: "x".repeat(141) },
      ],
      6,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems).toEqual([
      { row: 1, email: "not-an-email", problems: ['"not-an-email" isn\'t a valid email.'] },
      { row: 3, email: "a@example.com", problems: ["Same email as row 2."] },
      { row: 4, email: "z@example.com", problems: ["Amount must be more than $0.00."] },
      { row: 5, email: "n@example.com", problems: ["Note is longer than 140 characters."] },
    ]);
    expect(r.message).toBe("4 rows have problems. Nothing was created; fix them and try again.");
  });

  it("handles commas and quotes in notes safely", () => {
    const r = checkAgentRows([{ email: "a@example.com", amount: "1.00", note: 'Thanks, "great" work\nreally' }], 6);
    expect(r.ok && r.rows[0].note).toBe('Thanks, "great" work\nreally');
  });

  it("caps the number of people", () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ email: `p${i}@example.com`, amount: "1.00" }));
    const r = checkAgentRows(rows, 6, 3);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/up to 3/);
    expect(checkAgentRows([], 6).ok).toBe(false);
    expect(checkAgentRows("nope", 6).ok).toBe(false);
  });
});

describe("toAmountString", () => {
  it("formats base units as dollars with two decimals", () => {
    expect(toAmountString(25_000_000n, 6)).toBe("25.00");
    expect(toAmountString(500_000n, 6)).toBe("0.50");
    expect(toAmountString(1n, 6)).toBe("0.00");
    expect(toAmountString(123_456_789n, 6)).toBe("123.45");
    expect(toAmountString(1234n, 2)).toBe("12.34");
  });
});
