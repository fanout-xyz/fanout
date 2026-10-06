import { afterEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { indexedBatches, indexedBatchTx, indexedPayeeHistory, mergeHistory } from "./indexer";
import type { PayeeHistoryItem } from "./types";

vi.mock("@/lib/config", () => ({
  config: { useMock: false, indexerUrl: "https://indexer.test/v1/graphql", usdc: { settle: "0x5e771e5e771e5e771e5e771e5e771e5e771e5e77" } },
}));

const platform = "0x978D459587b9807375E7A02ff403BED7E68d0b0e";
const payee = "0xDb46e858d1F035dd097B20E186B5b8995B71FDdE";
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe("indexedBatches", () => {
  it("maps the platform's batches and reports the newest id seen from anyone", async () => {
    const fetchMock = respond({
      data: {
        Batch: [{ id: "3", total: "1000000", rowCount: 2, claimedCount: 1, createdAt: 1790716629, txHash: tx(3) }],
        latest: [{ id: "5" }],
      },
    });
    const { batches, latestId } = await indexedBatches(platform.toLowerCase() as `0x${string}`);
    expect(batches).toEqual([{ id: "3", total: 1_000_000n, rowCount: 2, claimedCount: 1, createdAt: 1_790_716_629_000, txHash: tx(3) }]);
    expect(latestId).toBe(5);
    // The indexer stores checksummed addresses, so a lowercase input is normalised before querying.
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.variables.platform).toBe(platform);
  });

  it("treats an empty indexer as having seen no batches", async () => {
    respond({ data: { Batch: [], latest: [] } });
    expect(await indexedBatches(platform)).toEqual({ batches: [], latestId: 0 });
  });

  it("throws on GraphQL errors and HTTP failures so callers can fall back to the chain", async () => {
    respond({ errors: [{ message: "field not found" }] });
    await expect(indexedBatches(platform)).rejects.toThrow("field not found");
    respond({}, 503);
    await expect(indexedBatches(platform)).rejects.toThrow("503");
  });
});

describe("indexedBatchTx", () => {
  it("returns the creating transaction, or undefined for an unknown batch", async () => {
    respond({ data: { Batch_by_pk: { txHash: tx(1) } } });
    expect(await indexedBatchTx("1")).toBe(tx(1));
    respond({ data: { Batch_by_pk: null } });
    expect(await indexedBatchTx("99")).toBeUndefined();
  });
});

describe("payee history", () => {
  it("maps indexed activity to the wallet page's items", async () => {
    respond({
      data: {
        PayeeActivity: [
          { kind: "Sent", amount: "5", counterparty: "0x5E771e5E771E5e771e5e771e5e771E5E771e5e77", txHash: tx(3), timestamp: 30 },
          { kind: "Sent", amount: "15", counterparty: platform, txHash: tx(2), timestamp: 20 },
          { kind: "Received", amount: "40", counterparty: platform, txHash: tx(1), timestamp: 10, claim_id: "0xclaim" },
        ],
      },
    });
    expect(await indexedPayeeHistory(payee)).toEqual([
      // AUSD sent to SettleToUsdc is the payee changing to USDC.
      { kind: "sent", amount: 5n, counterparty: "0x5E771e5E771E5e771e5e771e5e771E5E771e5e77", txHash: tx(3), timestamp: 30_000, toUsdc: true },
      { kind: "sent", amount: 15n, counterparty: platform, txHash: tx(2), timestamp: 20_000 },
      { kind: "received", amount: 40n, counterparty: platform, txHash: tx(1), timestamp: 10_000, payout: true },
    ]);
  });

  it("keeps local items the indexer hasn't caught up to, without duplicating ones it has", () => {
    const item = (kind: "sent" | "received", n: number, timestamp: number): PayeeHistoryItem =>
      ({ kind, amount: BigInt(n), counterparty: platform, txHash: tx(n), timestamp });
    const indexed = [item("received", 1, 10_000)];
    const local = [
      { ...item("received", 1, 10_500), txHash: tx(1).toUpperCase() as Hex }, // same claim, recorded on this device
      item("sent", 2, 30_000), // just sent, not indexed yet
    ];
    expect(mergeHistory(indexed, local)).toEqual([item("sent", 2, 30_000), item("received", 1, 10_000)]);
  });
});
