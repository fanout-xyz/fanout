import { describe, expect, it } from "vitest";
import { batchToCsv, csvCell } from "./batch-export";

describe("batch export", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("plain")).toBe("plain");
  });

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("writes amounts as plain decimals and only includes links on request", () => {
    const rows = [{ email: "a@example.com", amount: 156_500_000n, note: "Weekly", status: "sent", claimLink: "https://x/claim#k=1" }];
    expect(batchToCsv(rows)).toBe("email,amount,note,status\na@example.com,156.50,Weekly,sent\n");
    expect(batchToCsv(rows, { includeLinks: true })).toContain(",claim_link\n");
    expect(batchToCsv(rows, { includeLinks: true })).toContain("https://x/claim#k=1");
  });
});
