import { describe, expect, it } from "vitest";
import { assessPayout, payeeTypicals, riskSignature, type PastPayout } from "./payout-risk";

const usd = (n: number) => BigInt(Math.round(n * 100)) * 10_000n;
const past = (...totals: [number, number][]): PastPayout[] => totals.map(([t, n], i) => ({ total: usd(t), rowCount: n, createdAt: i }));
const rows = (...amounts: [string, number][]) => amounts.map(([email, a]) => ({ email, amount: usd(a) }));
const kinds = (r: ReturnType<typeof assessPayout>) => r.map((x) => x.kind);

const usual = past([1000, 10], [1200, 12], [900, 9], [1100, 11]);
const known = new Map(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((e) => [`${e}@x.com`, usd(100)]));

describe("assessPayout", () => {
  it("passes a payout like the usual ones", () => {
    expect(assessPayout({ rows: rows(["a@x.com", 100], ["b@x.com", 120], ["c@x.com", 90]), history: usual, payees: known })).toEqual([]);
  });

  it("flags a total far above the usual payout", () => {
    const r = assessPayout({ rows: rows(["a@x.com", 2000], ["b@x.com", 2000]), history: usual, payees: known });
    expect(kinds(r)).toContain("total-high");
    const reason = r.find((x) => x.kind === "total-high")!;
    expect(reason.message).toBe("This payout is $4,000, about 4× your usual $1,000.");
    expect(reason.facts).toEqual({ total_usd: 4000, usual_total_usd: 1000, times: 4 });
  });

  it("needs a few past payouts before judging the total", () => {
    const r = assessPayout({ rows: rows(["a@x.com", 5000]), history: past([100, 1], [100, 1]), payees: known });
    expect(kinds(r)).not.toContain("total-high");
  });

  it("flags a large first payout, but not when history is unknown", () => {
    expect(kinds(assessPayout({ rows: rows(["a@x.com", 12_000]), history: [], payees: new Map() }))).toEqual(["first-large"]);
    expect(assessPayout({ rows: rows(["a@x.com", 12_000]), history: null, payees: new Map() })).toEqual([]);
  });

  it("flags new payees getting large amounts, and doesn't put emails in the facts", () => {
    const r = assessPayout({ rows: rows(["a@x.com", 100], ["new@x.com", 900], ["b@x.com", 100]), history: usual, payees: known });
    const reason = r.find((x) => x.kind === "new-payee-large")!;
    expect(reason.message).toContain("new@x.com ($900)");
    expect(JSON.stringify(reason.facts)).not.toContain("@");
    expect(reason.facts).toEqual({ new_large_count: 1, largest_usd: 900, usual_per_person_usd: 100 });
    // A new payee at the usual amount is fine.
    expect(kinds(assessPayout({ rows: rows(["new@x.com", 100]), history: usual, payees: known }))).toEqual([]);
  });

  it("flags the same amount to many people", () => {
    const same = Array.from({ length: 12 }, (_, i) => [`${"abcdefghijkl"[i]}@x.com`, 50] as [string, number]);
    const r = assessPayout({ rows: rows(...same), history: usual, payees: known });
    expect(kinds(r)).toContain("same-amount");
    expect(r.find((x) => x.kind === "same-amount")!.message).toMatch(/^Everyone gets exactly \$50/);
    // Nine people at the same amount is under the bar.
    expect(kinds(assessPayout({ rows: rows(...same.slice(0, 9)), history: usual, payees: known }))).not.toContain("same-amount");
  });

  it("flags a payout that's mostly people never paid before", () => {
    const fresh = Array.from({ length: 10 }, (_, i) => [`new${i}@x.com`, 90 + i] as [string, number]);
    expect(kinds(assessPayout({ rows: rows(...fresh), history: usual, payees: known }))).toContain("many-new");
  });

  it("gives a signature that changes with the reasons", () => {
    const a = assessPayout({ rows: rows(["a@x.com", 2000], ["b@x.com", 2000]), history: usual, payees: known });
    const b = assessPayout({ rows: rows(["a@x.com", 2000], ["b@x.com", 2500]), history: usual, payees: known });
    expect(riskSignature(a)).not.toBe(riskSignature(b));
    expect(riskSignature([])).toBe("");
  });
});

describe("payeeTypicals", () => {
  it("joins past rows to emails and takes the median", () => {
    const emails: Record<string, string> = { "0xa": "a@x.com", "0xb": "a@x.com", "0xc": "a@x.com", "0xd": "b@x.com" };
    const typical = payeeTypicals(
      [
        { rows: [{ claimSigner: "0xA" as `0x${string}`, amount: usd(10), status: "claimed" }, { claimSigner: "0xD" as `0x${string}`, amount: usd(5), status: "sent" }] },
        { rows: [{ claimSigner: "0xB" as `0x${string}`, amount: usd(30), status: "sent" }, { claimSigner: "0xE" as `0x${string}`, amount: usd(99), status: "sent" }] },
        { rows: [{ claimSigner: "0xC" as `0x${string}`, amount: usd(20), status: "sent" }] },
      ],
      (s) => emails[s],
    );
    expect(typical).toEqual(new Map([["a@x.com", usd(20)], ["b@x.com", usd(5)]]));
  });
});
