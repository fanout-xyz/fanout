import { getAddress, type Address, type Hex } from "viem";
import { config } from "@/lib/config";
import type { BatchSummary, PayeeHistoryItem } from "./types";

/**
 * Reads from the Envio indexer (indexer/ in this repo): what the contracts can't cheaply answer,
 * like a platform's past payouts, their transactions, and a payee's activity.
 * It trails the chain by a few seconds, so callers merge in what they just did themselves.
 * Every function throws when the indexer is off or unreachable; callers fall back to the chain.
 */

const TIMEOUT_MS = 5_000;

export const indexerEnabled = () => !config.useMock && !!config.indexerUrl;

async function query<T>(gql: string, variables: Record<string, unknown>): Promise<T> {
  if (!indexerEnabled()) throw new Error("Indexer is off");
  const res = await fetch(config.indexerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: gql, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Indexer returned ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length || !body.data) throw new Error(`Indexer: ${body.errors?.[0]?.message ?? "no data"}`);
  return body.data;
}

type BatchRow = { id: string; total: string; rowCount: number; claimedCount: number; createdAt: number; txHash: Hex };

/** A platform's payouts, newest first, plus the highest batch id the indexer has seen from anyone. */
export async function indexedBatches(platform: Address): Promise<{ batches: BatchSummary[]; latestId: number }> {
  const data = await query<{ Batch: BatchRow[]; latest: { id: string }[] }>(
    `query ($platform: String!) {
      Batch(where: { platform_id: { _eq: $platform } }, order_by: { createdAt: desc }) {
        id total rowCount claimedCount createdAt txHash
      }
      latest: Batch(order_by: { createdAt: desc }, limit: 1) { id }
    }`,
    { platform: getAddress(platform) },
  );
  return {
    batches: data.Batch.map((b) => ({
      id: b.id,
      total: BigInt(b.total),
      rowCount: b.rowCount,
      claimedCount: b.claimedCount,
      createdAt: b.createdAt * 1000,
      txHash: b.txHash,
    })),
    latestId: Number(data.latest[0]?.id ?? 0),
  };
}

/** The transaction that created a payout, for "View transaction". */
export async function indexedBatchTx(batchId: string): Promise<Hex | undefined> {
  const data = await query<{ Batch_by_pk: { txHash: Hex } | null }>(
    `query ($id: String!) { Batch_by_pk(id: $id, chainId: 10143) { txHash } }`,
    { id: batchId },
  );
  return data.Batch_by_pk?.txHash;
}

type ActivityRow = {
  kind: "Received" | "Sent";
  amount: string;
  counterparty: Address;
  txHash: Hex;
  timestamp: number;
  claim_id?: string | null;
};

/** A payee's claims, and AUSD they sent or received after their first claim, newest first. */
export async function indexedPayeeHistory(address: Address): Promise<PayeeHistoryItem[]> {
  const data = await query<{ PayeeActivity: ActivityRow[] }>(
    `query ($payee: String!) {
      PayeeActivity(where: { payee_id: { _eq: $payee } }, order_by: { timestamp: desc }, limit: 200) {
        kind amount counterparty txHash timestamp claim_id
      }
    }`,
    { payee: getAddress(address) },
  );
  // AUSD sent to SettleToUsdc came back as USDC, so it shows as a change to USDC, not a payment.
  const settle = config.usdc.settle?.toLowerCase();
  return data.PayeeActivity.map((a) => ({
    kind: a.kind === "Sent" ? "sent" : "received",
    amount: BigInt(a.amount),
    counterparty: a.counterparty,
    txHash: a.txHash,
    timestamp: a.timestamp * 1000,
    ...(a.claim_id ? { payout: true } : {}),
    ...(settle && a.kind === "Sent" && a.counterparty.toLowerCase() === settle ? { toUsdc: true } : {}),
  }));
}

/** Indexed history plus local records the indexer hasn't caught up to yet (same tx and kind = same item). */
export function mergeHistory(indexed: PayeeHistoryItem[], local: PayeeHistoryItem[]): PayeeHistoryItem[] {
  const seen = new Set(indexed.map((i) => `${i.txHash.toLowerCase()}:${i.kind}`));
  const pending = local.filter((i) => !seen.has(`${i.txHash.toLowerCase()}:${i.kind}`));
  return [...indexed, ...pending].sort((a, b) => b.timestamp - a.timestamp);
}
