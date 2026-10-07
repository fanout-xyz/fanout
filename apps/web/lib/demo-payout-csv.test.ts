import { describe, expect, it } from "vitest";
import { MAX_ROWS, parsePayoutCsv } from "./csv";
import {
  addressesFromList,
  assertDeliverableAddress,
  DEMO_DEFAULT_ROWS,
  DEMO_MAX_ROWS,
  DemoCsvError,
  demoAmounts,
  parseDollarsToCents,
  plusAddresses,
  toPayoutCsv,
} from "./demo-payout-csv";

describe("demo payout CSV", () => {
  it("uses the same row limit as the New payout page", () => {
    expect(DEMO_MAX_ROWS).toBe(MAX_ROWS);
    expect(DEMO_DEFAULT_ROWS).toBe(150);
  });

  it("plus-addresses one inbox", () => {
    const emails = plusAddresses(" Ana@Fanout.tech ", 150);
    expect(emails).toHaveLength(150);
    expect(emails[0]).toBe("ana+1@fanout.tech");
    expect(emails[149]).toBe("ana+150@fanout.tech");
    expect(new Set(emails).size).toBe(150);
  });

  it("refuses made-up domains, tagged addresses and bad counts", () => {
    for (const bad of ["you@example.com", "you@pay.test", "you@corp.local", "you@example.org", "not-an-email", "you@nodot"]) {
      expect(() => plusAddresses(bad, 3), bad).toThrow(DemoCsvError);
    }
    expect(() => plusAddresses("you+x@fanout.tech", 3)).toThrow(/without a "\+"/);
    expect(() => plusAddresses("you@fanout.tech", 0)).toThrow(/1 to 150/);
    expect(() => plusAddresses("you@fanout.tech", 151)).toThrow(/1 to 150/);
    expect(() => assertDeliverableAddress("ana@fanout.tech")).not.toThrow();
  });

  it("reads a list, skipping headers, comments, blanks and duplicates", () => {
    const text = "email,name\n# team\nana@fanout.tech,Ana\n\nBen@Fanout.tech\nana@fanout.tech\n\"cy@fanout.tech\",Cy\n";
    expect(addressesFromList(text, 3)).toEqual(["ana@fanout.tech", "ben@fanout.tech", "cy@fanout.tech"]);
    expect(addressesFromList(text, 2)).toEqual(["ana@fanout.tech", "ben@fanout.tech"]);
    expect(() => addressesFromList(text, 4)).toThrow(/has 3 different addresses; 4 are needed/);
    expect(() => addressesFromList("ana@fanout.tech\nbob@example.com\n", 1)).toThrow(/example\.com/);
  });

  it("makes repeatable amounts within the range", () => {
    const a = demoAmounts(150, { minCents: 100, maxCents: 300, seed: 7 });
    expect(a).toEqual(demoAmounts(150, { minCents: 100, maxCents: 300, seed: 7 }));
    expect(a).not.toEqual(demoAmounts(150, { minCents: 100, maxCents: 300, seed: 8 }));
    expect(Math.min(...a)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...a)).toBeLessThanOrEqual(300);
    expect(demoAmounts(3, { minCents: 250, maxCents: 250 })).toEqual([250, 250, 250]);
    expect(() => demoAmounts(3, { minCents: 0, maxCents: 10 })).toThrow(DemoCsvError);
    expect(() => demoAmounts(3, { minCents: 20, maxCents: 10 })).toThrow(DemoCsvError);
  });

  it("parses dollar inputs", () => {
    expect(parseDollarsToCents("1")).toBe(100);
    expect(parseDollarsToCents("$2.5")).toBe(250);
    expect(parseDollarsToCents("12.34")).toBe(1234);
    expect(() => parseDollarsToCents("1.234")).toThrow(DemoCsvError);
    expect(() => parseDollarsToCents("-1")).toThrow(DemoCsvError);
  });

  it("writes a 150-row file the New payout page accepts without errors", () => {
    const emails = plusAddresses("ana@fanout.tech", 150);
    const cents = demoAmounts(150, { minCents: 100, maxCents: 300 });
    const csv = toPayoutCsv(emails.map((email, i) => ({ email, cents: cents[i], note: 'Thanks, "team"' })));
    const sheet = parsePayoutCsv(csv, 6);
    expect(sheet.fileErrors).toEqual([]);
    expect(sheet.errorRowCount).toBe(0);
    expect(sheet.rows).toHaveLength(150);
    expect(sheet.rows[0]).toMatchObject({ email: "ana+1@fanout.tech", note: 'Thanks, "team"' });
    expect(sheet.total).toBe(BigInt(cents.reduce((a, b) => a + b, 0)) * 10_000n);
  });
});
