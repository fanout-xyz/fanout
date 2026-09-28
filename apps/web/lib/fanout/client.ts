import type { WalletClient } from "viem";
import { config } from "@/lib/config";
import { createMockClient } from "./mock-client";
import { createOnchainClient } from "./onchain-client";
import type {
  Address,
  Batch,
  BatchRowInput,
  BatchSummary,
  ClaimInfo,
  Hex,
  PayeeHistoryItem,
  TxResult,
} from "./types";

/**
 * The only boundary between the UI and the chain. Pages never call viem or the
 * contracts directly; they go through this.
 *
 * Agreed with contracts. Don't change a signature without telling both sides.
 * Methods marked PROPOSED are not agreed yet; the mock implements them so the
 * pages work, and contracts can accept, rename or reject them.
 */
export interface FanoutClient {
  getTreasuryBalance(platform: Address): Promise<bigint>;
  deposit(amount: bigint): Promise<TxResult>;
  createBatchPayout(rows: BatchRowInput[]): Promise<{ batchId: string; txHash: Hex }>;
  getBatch(batchId: string): Promise<Batch>;
  getClaim(claimSigner: Address): Promise<ClaimInfo>;
  /** signature: see lib/fanout/claim-keys.ts for exactly what is signed. */
  claim(claimSigner: Address, recipient: Address, signature: Hex): Promise<TxResult>;
  getPayeeBalance(address: Address): Promise<bigint>;
  send(to: Address, amount: bigint): Promise<TxResult>;

  /** PROPOSED: past batches for the dashboard. Onchain version likely comes from the indexer. */
  listBatches(platform: Address): Promise<BatchSummary[]>;
  /** PROPOSED: payee activity for /wallet. Onchain version likely comes from the indexer. */
  getPayeeHistory(address: Address): Promise<PayeeHistoryItem[]>;
}

export type FanoutClientContext = {
  /** The signed-in user's address; the implicit sender for deposit/createBatchPayout/send. */
  account?: Address;
  /** Required by the onchain client for writes. The mock ignores it. */
  walletClient?: WalletClient;
};

export function createFanoutClient(ctx: FanoutClientContext): FanoutClient {
  return config.useMock ? createMockClient(ctx) : createOnchainClient(ctx);
}

export type * from "./types";
export { NotFoundError } from "./types";
