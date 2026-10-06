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
  GaslessSendResult,
  Hex,
  PayeeHistoryItem,
  TestDollarsResult,
  TxResult,
  UsdcSettleResult,
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
  /**
   * Sends like `send`, but the payee only signs an authorization (ERC-3009, lib/fanout/erc3009.ts)
   * and our relayer submits it and pays the fee, so the account needs no MON. Falls back to `send`
   * when the relayer isn't set up or there's no signed-in session (`gasless: false`).
   */
  sendGasless(to: Address, amount: bigint): Promise<GaslessSendResult>;
  /**
   * Changes `amount` of the signed-in payee's dollars (AUSD) to USDC through Agora's stable-swap pair.
   * The payee signs one authorization; our relayer submits it (see lib/fanout/usdc-settle.ts).
   */
  receiveAsUsdc(amount: bigint): Promise<UsdcSettleResult>;
  /** USDC held, in USDC base units (config.usdc.decimals). */
  getPayeeUsdcBalance(address: Address): Promise<bigint>;
  /**
   * Free test dollars for the signed-in account, for trying Fanout (lib/fanout/test-dollars.ts). Onchain,
   * Monad testnet only: our relayer asks Agora's AUSD faucet to send them to the account, and they're
   * ready to deposit. The mock credits the payout balance. Once per account per day; a refusal because
   * of a limit throws TestDollarsCooldown.
   */
  getTestDollars(): Promise<TestDollarsResult>;

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
  /**
   * The signed-in session: proves who is claiming, so the server can check their email, and gates the
   * relayer's fee-free sends and changes to USDC. Onchain client only.
   */
  getAccessToken?: () => Promise<string | null>;
};

export function createFanoutClient(ctx: FanoutClientContext): FanoutClient {
  return config.useMock ? createMockClient(ctx) : createOnchainClient(ctx);
}

export type * from "./types";
export { NotFoundError } from "./types";
