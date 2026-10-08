import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { decodePassport, type Passport, type PassportStatement } from "./passport";
import {
  cardFacts,
  cardHeadline,
  cardPeriod,
  claimToSign,
  decodeFields,
  DEFAULT_FIELDS,
  encodeFields,
  parseFormat,
  parseShareCard,
  shareCardFor,
  shareUrl,
} from "./passport-share";

const statement: PassportStatement = {
  v: 1,
  account: "0x1111111111111111111111111111111111111111" as Address,
  passportKey: "0x2222222222222222222222222222222222222222" as Address,
  months: ["2026-08", "2026-09", "2026-10"],
  minMonthlyUsd: 400,
  platforms: 2,
  issuedAt: Date.UTC(2026, 9, 15),
};
const passport: Passport = { statement, link: "0xaa" as Hex, sig: "0xbb" as Hex };
const q = (s: string) => new URLSearchParams(s);

describe("share card privacy", () => {
  it("shows the amount and platforms by default, never the total", () => {
    expect(DEFAULT_FIELDS).toEqual({ amount: true, platforms: true, total: false });
    expect(shareCardFor(statement, DEFAULT_FIELDS, 152_300)).toEqual({ months: 3, from: "2026-08", to: "2026-10", minMonthlyUsd: 400, platforms: 2 });
  });

  it("adds the total only when asked, in whole dollars", () => {
    expect(shareCardFor(statement, { ...DEFAULT_FIELDS, total: true }, 152_399).totalUsd).toBe(1523);
    expect(shareCardFor(statement, { ...DEFAULT_FIELDS, total: true }).totalUsd).toBeUndefined();
  });

  it("leaves hidden fields off the card", () => {
    const card = shareCardFor(statement, { amount: false, platforms: false, total: false });
    expect(card).toEqual({ months: 3, from: "2026-08", to: "2026-10" });
    expect(cardHeadline(card)).toBe("Paid every month");
    expect(cardFacts(card)).toEqual(["3 months in a row"]);
  });

  it("signs hidden fields as the weakest true claim", () => {
    const best = { minMonthlyUsd: 400, platforms: 3 };
    expect(claimToSign(best, DEFAULT_FIELDS)).toEqual(best);
    expect(claimToSign(best, { amount: false, platforms: false, total: true })).toEqual({ minMonthlyUsd: 10, platforms: 1 });
  });

  it("puts only the picked fields in the preview and the passport in the fragment", () => {
    const url = new URL(shareUrl("https://fanout.test", passport, { amount: true, platforms: false, total: false }));
    expect(url.pathname).toBe("/verify");
    expect([...url.searchParams.keys()].sort()).toEqual(["a", "from", "m", "to"]);
    expect(url.search).not.toContain(statement.account.slice(2));
    const hash = new URLSearchParams(url.hash.slice(1));
    expect(decodePassport(hash.get("p")!)).toEqual(passport);
    expect(decodeFields(hash.get("show"))).toEqual({ amount: true, platforms: false, total: false });
  });

  it("round-trips the field choices, and reads older links as before", () => {
    for (const f of [DEFAULT_FIELDS, { amount: false, platforms: true, total: true }, { amount: false, platforms: false, total: false }]) {
      expect(decodeFields(encodeFields(f))).toEqual(f);
    }
    expect(decodeFields(null)).toEqual({ amount: true, platforms: true, total: false });
  });
});

describe("share card preview input", () => {
  it("accepts a well-formed card", () => {
    expect(parseShareCard(q("m=3&from=2026-08&to=2026-10&a=400&pl=2&tot=1523"))).toEqual({
      months: 3,
      from: "2026-08",
      to: "2026-10",
      minMonthlyUsd: 400,
      platforms: 2,
      totalUsd: 1523,
    });
    expect(parseShareCard(q("m=2&from=2025-12&to=2026-01"))).toEqual({ months: 2, from: "2025-12", to: "2026-01" });
  });

  it.each([
    ["missing months", "from=2026-08&to=2026-10"],
    ["months out of range", "m=13&from=2025-10&to=2026-10"],
    ["months that don't match the period", "m=2&from=2026-08&to=2026-10"],
    ["period backwards", "m=1&from=2026-10&to=2026-08"],
    ["bad month", "m=1&from=2026-13&to=2026-13"],
    ["text in a number", "m=1&from=2026-10&to=2026-10&a=400<script>"],
    ["negative", "m=1&from=2026-10&to=2026-10&a=-5"],
    ["leading zero", "m=1&from=2026-10&to=2026-10&pl=02"],
    ["decimal", "m=1&from=2026-10&to=2026-10&tot=10.5"],
    ["zero", "m=1&from=2026-10&to=2026-10&a=0"],
    ["implausibly large", "m=1&from=2026-10&to=2026-10&pl=5000"],
    ["huge total", "m=1&from=2026-10&to=2026-10&tot=99999999999"],
  ])("rejects %s", (_, input) => {
    expect(parseShareCard(q(input))).toBeNull();
  });

  it("reads the image format", () => {
    expect(parseFormat(null)).toBe("landscape");
    expect(parseFormat("portrait")).toBe("portrait");
    expect(parseFormat("square")).toBeNull();
  });

  it("words the period plainly", () => {
    expect(cardPeriod({ from: "2026-10", to: "2026-10" })).toBe("Oct 2026");
    expect(cardPeriod({ from: "2026-08", to: "2026-10" })).toBe("Aug – Oct 2026");
    expect(cardPeriod({ from: "2025-12", to: "2026-02" })).toBe("Dec 2025 – Feb 2026");
  });
});
