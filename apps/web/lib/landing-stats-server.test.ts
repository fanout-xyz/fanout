import { afterEach, describe, expect, it, vi } from "vitest";
import { getAusdOnMonad, getFanoutStats } from "./landing-stats-server";

const mockConfig = vi.hoisted(() => ({ indexerUrl: "https://indexer.test/v1/graphql" }));
vi.mock("./config", () => ({ config: mockConfig }));

afterEach(() => {
  vi.unstubAllGlobals();
  mockConfig.indexerUrl = "https://indexer.test/v1/graphql";
});

describe("landing stats fetchers", () => {
  it("give null when the source is unreachable or errors, so the stat is hidden", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("timeout"))));
    expect(await getAusdOnMonad()).toBeNull();
    expect(await getFanoutStats()).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    expect(await getAusdOnMonad()).toBeNull();
    expect(await getFanoutStats()).toBeNull();
  });

  it("skips the indexer when it's turned off", async () => {
    mockConfig.indexerUrl = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getFanoutStats()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns parsed numbers on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ chains: [{ network: "monad", circulatingSupply: "100.5" }] })));
    expect(await getAusdOnMonad()).toBe(100.5);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { Platform: [{ totalPaidOut: "2000000", batchCount: 1, claimCount: 2, claimedCount: 1 }] } })));
    expect(await getFanoutStats()).toEqual({ paidOut: 2_000_000n, payouts: 1, peoplePaid: 2, claimed: 1 });
  });
});
