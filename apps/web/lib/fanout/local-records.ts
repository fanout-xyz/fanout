import type { Address, Hex } from "viem";
import type { PayeeHistoryItem } from "./types";

/**
 * Facts this browser remembers because the chain can't cheaply give them back.
 * Monad's public RPC serves event logs 100 blocks (~40s) at a time and the contracts
 * have no history views, so until an indexer (Envio) exists:
 * - the transaction that created each payout, for "View transaction"
 * - the payee's activity on this device (claims and sends), for the wallet page
 * Losing them only hides a link or an activity row; balances always come from the chain.
 */

const BATCH_TX = "fanout.batchTx.v1";
const ACTIVITY = "fanout.activity.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Non-fatal: only a link or an activity row is lost.
  }
}

const isBrowser = () => typeof window !== "undefined";
const scoped = (chainId: number, a: Address, b: string) => `${chainId}:${a.toLowerCase()}:${b}`;

export function rememberBatchTx(chainId: number, contract: Address, batchId: string, txHash: Hex) {
  if (!isBrowser()) return;
  write(BATCH_TX, { ...read<Record<string, Hex>>(BATCH_TX, {}), [scoped(chainId, contract, batchId)]: txHash });
}

export function recallBatchTx(chainId: number, contract: Address, batchId: string): Hex | undefined {
  if (!isBrowser()) return undefined;
  return read<Record<string, Hex>>(BATCH_TX, {})[scoped(chainId, contract, batchId)];
}

type StoredItem = Omit<PayeeHistoryItem, "amount"> & { amount: string };

export function rememberActivity(chainId: number, owner: Address, item: PayeeHistoryItem) {
  if (!isBrowser()) return;
  const k = scoped(chainId, owner, "activity");
  const all = read<Record<string, StoredItem[]>>(ACTIVITY, {});
  const list = (all[k] ?? []).filter((i) => !(i.txHash === item.txHash && i.kind === item.kind));
  all[k] = [{ ...item, amount: item.amount.toString() }, ...list].slice(0, 200);
  write(ACTIVITY, all);
}

export function recallActivity(chainId: number, owner: Address): PayeeHistoryItem[] {
  if (!isBrowser()) return [];
  return (read<Record<string, StoredItem[]>>(ACTIVITY, {})[scoped(chainId, owner, "activity")] ?? [])
    .map((i) => ({ ...i, amount: BigInt(i.amount) }))
    .sort((a, b) => b.timestamp - a.timestamp);
}
