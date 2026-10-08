import { describe, expect, it } from "vitest";
import { formatCount, formatDollars, parseAusdOnMonad, parseFanoutStats, unitsToDollars } from "./landing-stats";

const monad = { chainId: "eip155:143", network: "monad", circulatingSupply: "141167380.223948", totalSupply: "144298108.189523" };
const ethereum = { chainId: "eip155:1", network: "ethereum", circulatingSupply: "63406136.894859", totalSupply: "77042442.671185" };

describe("parseAusdOnMonad", () => {
  it("reads Monad's circulating supply from the per-chain list", () => {
    expect(parseAusdOnMonad({ chains: [ethereum, monad], circulatingSupply: "1", totalSupply: "2", partial: false })).toBe(141167380.223948);
  });

  it("still works on a partial response, where the aggregates are left out", () => {
    expect(parseAusdOnMonad({ chains: [monad], partial: true })).toBe(141167380.223948);
  });

  it("gives null when Monad is missing, zero or malformed", () => {
    expect(parseAusdOnMonad({ chains: [ethereum], partial: true })).toBeNull();
    expect(parseAusdOnMonad({ chains: [{ ...monad, circulatingSupply: "0.000000" }] })).toBeNull();
    expect(parseAusdOnMonad({ chains: [{ ...monad, circulatingSupply: 141 }] })).toBeNull();
    expect(parseAusdOnMonad({ chains: [{ ...monad, circulatingSupply: "-5" }] })).toBeNull();
    expect(parseAusdOnMonad({ code: "rate_limit_exceeded" })).toBeNull();
    expect(parseAusdOnMonad(null)).toBeNull();
  });
});

describe("parseFanoutStats", () => {
  it("sums every platform", () => {
    const body = {
      data: {
        Platform: [
          { totalPaidOut: "1000000", batchCount: 1, claimCount: 1, claimedCount: 1 },
          { totalPaidOut: "1050000000", batchCount: 5, claimCount: 19, claimedCount: 4 },
        ],
      },
    };
    expect(parseFanoutStats(body)).toEqual({ paidOut: 1_051_000_000n, payouts: 6, peoplePaid: 20, claimed: 5 });
  });

  it("gives zeros for an indexer with no payouts yet", () => {
    expect(parseFanoutStats({ data: { Platform: [] } })).toEqual({ paidOut: 0n, payouts: 0, peoplePaid: 0, claimed: 0 });
  });

  it("gives null for errors or a malformed row, never a partial total", () => {
    expect(parseFanoutStats({ errors: [{ message: "field not found" }] })).toBeNull();
    expect(parseFanoutStats({ data: {} })).toBeNull();
    expect(parseFanoutStats({ data: { Platform: [{ totalPaidOut: 5, batchCount: 1, claimCount: 1, claimedCount: 0 }] } })).toBeNull();
    expect(parseFanoutStats({ data: { Platform: [{ totalPaidOut: "5", batchCount: -1, claimCount: 1, claimedCount: 0 }] } })).toBeNull();
    expect(parseFanoutStats({ data: { Platform: [null] } })).toBeNull();
    expect(parseFanoutStats("oops")).toBeNull();
  });
});

describe("formatDollars", () => {
  it("abbreviates millions and billions, rounding down", () => {
    expect(formatDollars(141_167_380.22)).toBe("$141.1M");
    expect(formatDollars(1_999_999)).toBe("$1.9M");
    expect(formatDollars(2_519_000_000)).toBe("$2.5B");
  });

  it("shows whole dollars from $100 and cents below", () => {
    expect(formatDollars(1051)).toBe("$1,051");
    expect(formatDollars(999_999.99)).toBe("$999,999");
    expect(formatDollars(12.5)).toBe("$12.50");
    expect(formatDollars(0.019)).toBe("$0.01");
  });
});

describe("unitsToDollars", () => {
  it("converts 6-decimal AUSD units, dropping sub-cent dust", () => {
    expect(unitsToDollars(1_051_000_000n)).toBe(1051);
    expect(unitsToDollars(1_234_567n)).toBe(1.23);
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(12345)).toBe("12,345");
  });
});
