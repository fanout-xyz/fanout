import "server-only";
import type { Address } from "viem";
import { config } from "@/lib/config";
import { indexedPayeeHistory, indexerEnabled } from "@/lib/fanout/indexer";
import { engine } from "@/lib/fanout/mock-engine";
import { getMockState } from "@/lib/fanout/mock-store";
import type { PayeeHistoryItem } from "@/lib/fanout/types";

/**
 * A payee's payout history, read on the server to check a passport: the shared demo backend in
 * mock mode, the indexer otherwise. Null when there's nothing to check against.
 */
export async function serverPayeeHistory(account: Address): Promise<PayeeHistoryItem[] | null> {
  if (config.useMock) return engine.getPayeeHistory(getMockState(), account);
  if (!indexerEnabled()) return null;
  return indexedPayeeHistory(account);
}
