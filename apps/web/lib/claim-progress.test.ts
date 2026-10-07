import { describe, expect, it } from "vitest";
import { claimProgress, FAST_POLL_MS, FAST_POLL_WINDOW_MS, payoutPollInterval, POLL_MS } from "./claim-progress";
import type { PayoutStatus } from "./fanout/types";

const usd = (n: number) => BigInt(n) * 1_000_000n;
const row = (amount: number, status: PayoutStatus) => ({ amount: usd(amount), status });

describe("claimProgress", () => {
  it("counts people and dollars per status", () => {
    const p = claimProgress([row(10, "claimed"), row(20, "sent"), row(30, "claimed"), row(5, "refunded")]);
    expect(p).toMatchObject({
      people: 4,
      claimed: 2,
      waiting: 1,
      returned: 1,
      totalAmount: usd(65),
      claimedAmount: usd(40),
      waitingAmount: usd(20),
      returnedAmount: usd(5),
      claimedShare: 0.5,
      returnedShare: 0.25,
      settled: false,
    });
  });

  it("handles a full 150-person payout as it fills up", () => {
    const rows = Array.from({ length: 150 }, (_, i) => row(1, i < 149 ? "claimed" : "sent"));
    expect(claimProgress(rows)).toMatchObject({ claimed: 149, waiting: 1, claimedAmount: usd(149), settled: false });
    rows[149] = row(1, "claimed");
    expect(claimProgress(rows)).toMatchObject({ claimed: 150, waiting: 0, claimedShare: 1, settled: true });
  });

  it("is settled when everyone left was returned, and never for an empty payout", () => {
    expect(claimProgress([row(1, "claimed"), row(1, "refunded")]).settled).toBe(true);
    expect(claimProgress([])).toMatchObject({ people: 0, claimedShare: 0, returnedShare: 0, settled: false, totalAmount: 0n });
  });
});

describe("payoutPollInterval", () => {
  const openedAt = 1_000_000;
  const waiting = [{ status: "sent" as const }, { status: "claimed" as const }];

  it("refreshes fast right after the page opens, then slows down", () => {
    expect(payoutPollInterval({ rows: waiting, openedAt, now: openedAt })).toBe(FAST_POLL_MS);
    expect(payoutPollInterval({ rows: waiting, openedAt, now: openedAt + FAST_POLL_WINDOW_MS - 1 })).toBe(FAST_POLL_MS);
    expect(payoutPollInterval({ rows: waiting, openedAt, now: openedAt + FAST_POLL_WINDOW_MS })).toBe(POLL_MS);
  });

  it("keeps polling before the first load", () => {
    expect(payoutPollInterval({ rows: undefined, openedAt, now: openedAt })).toBe(FAST_POLL_MS);
  });

  it("stops once everyone has claimed or been returned", () => {
    expect(payoutPollInterval({ rows: [{ status: "claimed" }, { status: "refunded" }], openedAt, now: openedAt })).toBe(false);
  });
});
