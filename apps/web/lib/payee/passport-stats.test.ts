import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type { PayeeHistoryItem } from "@/lib/fanout/types";
import { longestStreak, monthRange, passportStats, stampLook, STAMP_INKS, STAMP_SHAPES } from "./passport-stats";

const A = "0x00000000000000000000000000000000000000AA" as Address;
const B = "0x00000000000000000000000000000000000000bb" as Address;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
let n = 0;
const paid = (cents: number, platform: Address, iso: string, payout = true): PayeeHistoryItem => ({
  kind: "received",
  amount: BigInt(cents) * 10_000n,
  counterparty: platform,
  txHash: tx(++n),
  timestamp: Date.parse(iso),
  payout,
});
const now = Date.parse("2026-10-15T12:00:00Z");

describe("passport stats", () => {
  const history: PayeeHistoryItem[] = [
    paid(30_000, A, "2025-11-03T00:00:00Z"),
    paid(12_550, A, "2025-12-20T00:00:00Z"),
    paid(20_000, B, "2026-01-05T00:00:00Z"),
    // February: nothing
    paid(41_000, A, "2026-03-01T00:00:00Z"),
    paid(9_000, B, "2026-03-28T00:00:00Z"),
    paid(15_000, b(), "2026-04-02T00:00:00Z"),
    paid(99_999, A, "2026-05-02T00:00:00Z", false), // a transfer in: not income
    { kind: "sent", amount: 5_000_000n, counterparty: B, txHash: tx(999), timestamp: Date.parse("2026-05-03T00:00:00Z") },
  ];
  function b() {
    return B.toUpperCase().replace("0X", "0x") as Address; // same platform, different casing
  }
  const s = passportStats(history, now);

  it("totals only claimed payouts", () => {
    expect(s.totalCents).toBe(30_000 + 12_550 + 20_000 + 41_000 + 9_000 + 15_000);
    expect(s.payouts).toBe(6);
  });

  it("lists every month from the first payout to now, gaps included", () => {
    expect(s.months.map((m) => m.month)).toEqual(monthRange("2025-11", "2026-10"));
    expect(s.months.find((m) => m.month === "2026-02")).toEqual({ month: "2026-02", cents: 0, payouts: 0 });
    expect(s.months.find((m) => m.month === "2026-03")).toEqual({ month: "2026-03", cents: 50_000, payouts: 2 });
    expect(s.monthsPaid).toBe(5);
  });

  it("finds the longest run of paid months across a year end", () => {
    expect(s.longestStreak).toBe(3); // Nov, Dec, Jan
    expect(longestStreak([])).toBe(0);
    expect(longestStreak([{ month: "2026-01", cents: 1 }, { month: "2026-03", cents: 1 }])).toBe(1);
  });

  it("averages over months that were paid", () => {
    expect(s.averagePerPaidMonthCents).toBe(Math.floor(s.totalCents / 5));
  });

  it("groups by platform regardless of address casing, in the order they first paid", () => {
    expect(s.platforms.map((p) => [p.id, p.payouts, p.cents])).toEqual([
      [A.toLowerCase(), 3, 83_550],
      [B.toLowerCase(), 3, 44_000],
    ]);
    expect(s.platforms[1].firstPaidAt).toBe(Date.parse("2026-01-05T00:00:00Z"));
    expect(s.platforms[1].lastPaidAt).toBe(Date.parse("2026-04-02T00:00:00Z"));
  });

  it("reviews each year, newest first", () => {
    expect(s.years.map((y) => [y.year, y.cents, y.monthsPaid, y.platforms, y.bestMonth.month])).toEqual([
      [2026, 85_000, 3, 2, "2026-03"],
      [2025, 42_550, 2, 1, "2025-11"],
    ]);
  });

  it("is empty, not invented, for a new payee", () => {
    const empty = passportStats([], now);
    expect(empty).toMatchObject({ totalCents: 0, monthsPaid: 0, longestStreak: 0, averagePerPaidMonthCents: 0, firstPaidAt: null });
    expect(empty.months).toEqual([]);
    expect(empty.platforms).toEqual([]);
    expect(empty.years).toEqual([]);
  });
});

describe("stamps", () => {
  it("are the same every time for a platform, whatever the casing", () => {
    expect(stampLook(A)).toEqual(stampLook(A.toLowerCase()));
    const look = stampLook(B);
    expect(STAMP_SHAPES).toContain(look.shape);
    expect(STAMP_INKS).toContain(look.ink);
    expect(look.tilt).toBeGreaterThanOrEqual(-9);
    expect(look.tilt).toBeLessThanOrEqual(9);
    expect(look.code).toMatch(/^[A-HJ-NPR-Z]{3}$/);
  });

  it("vary between platforms", () => {
    const looks = Array.from({ length: 40 }, (_, i) => stampLook(`0x${(i + 1).toString(16).padStart(40, "0")}`));
    expect(new Set(looks.map((l) => l.shape)).size).toBeGreaterThan(2);
    expect(new Set(looks.map((l) => l.ink.light)).size).toBeGreaterThan(2);
    expect(new Set(looks.map((l) => l.code)).size).toBeGreaterThan(30);
  });
});
