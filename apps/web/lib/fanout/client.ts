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
 * listBatches and getPayeeHistory aren't contract functions. Onchain they're assembled from
 * contract reads (and, for history, what this device recorded) until an indexer exists.
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
  /** PROPOSED: payee activity for /balance. Onchain version likely comes from the indexer. */
  getPayeeHistory(address: Address): Promise<PayeeHistoryItem[]>;
}

export type FanoutClientContext = {
  /** The signed-in user's address; the implicit sender for deposit/createBatchPayout/send. */
  account?: Address;
  /** Required by the onchain client for writes. The mock ignores it. */
  walletClient?: WalletClient;
  /** Proves who is claiming, so the server can check their email. Onchain client only. */
  getAccessToken?: () => Promise<string | null>;
};

export function createFanoutClient(ctx: FanoutClientContext): FanoutClient {
  return config.useMock ? createMockClient(ctx) : createOnchainClient(ctx);
}

export type * from "./types";
export { NotFoundError } from "./types";
