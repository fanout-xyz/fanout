import "server-only";
import { getAddress, keccak256, toBytes, verifyTypedData, zeroAddress, type Address, type Hex, type TypedDataDefinition, type VerifyTypedDataParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain } from "@/lib/chains";
import { config } from "@/lib/config";
import { createBatchTypedData } from "@/lib/fanout/batch-authorization";
import { engine, type MockState } from "@/lib/fanout/mock-engine";
import { getMockState, saveMockState } from "@/lib/fanout/mock-store";
import type { BatchRow } from "@/lib/fanout/types";

/**
 * What the agent features need from the chain, server side. The mock ledger runs the same rules as
 * the contracts against the local demo state (lib/fanout/mock-engine.ts); the onchain one
 * (onchain-ledger.ts) reads the contracts and submits through the relayer.
 */

export type LedgerBatch = { id: string; platform: Address; createdAt: number; expiresAt?: number; total: bigint; rows: BatchRow[] };

export type CreateBatchForInput = {
  platform: Address;
  claimSigners: Address[];
  amounts: bigint[];
  emailHashes: Hex[];
  claimWindow: bigint;
  nonce: Hex;
  deadline: bigint;
  signature: Hex;
};

export interface Ledger {
  chainId: number;
  /** BatchPayout's address: the CreateBatch signature's verifyingContract. */
  batchPayout: Address;
  balanceOf(platform: Address): Promise<bigint>;
  getBatch(batchId: string): Promise<LedgerBatch>;
  /** BatchPayout.createBatchFor: the platform's signed CreateBatch, submitted by Fanout. */
  createBatchFor(input: CreateBatchForInput): Promise<{ batchId: string; txHash: Hex }>;
  /** ClaimEscrow.refundMany for the payout's expired rows; the money goes back to the platform's balance. */
  refundExpired(batchId: string): Promise<{ txHash: Hex; refunded: number }>;
  /** Whether `signature` is `signer`'s over the typed data (EOA, or a smart account onchain). */
  verifySignature(signer: Address, typedData: TypedDataDefinition, signature: Hex): Promise<boolean>;
}

/** Where agent payouts go in the demo (and in tests): the shared mock state, saved after each change. */
export function mockLedger(deps: { state?: () => MockState; save?: () => void; now?: () => number } = {}): Ledger {
  const state = deps.state ?? getMockState;
  const save = deps.save ?? saveMockState;
  const now = deps.now ?? Date.now;
  const batchPayout = config.contracts.batchPayout ?? zeroAddress;
  return {
    chainId: activeChain.id,
    batchPayout,
    async balanceOf(platform) {
      return engine.getTreasuryBalance(state(), platform);
    },
    async getBatch(batchId) {
      const s = state();
      const b = engine.getBatch(s, batchId);
      return { ...b, platform: getAddress(s.batches[batchId].platform) };
    },
    async createBatchFor(input) {
      // Same checks as BatchPayout._useAuthorization, in the same order.
      if (BigInt(Math.floor(now() / 1000)) > input.deadline) throw new Error("The approval took too long. Open it again and approve.");
      const s = state();
      const nonceKey = `${input.platform.toLowerCase()}:${input.nonce}`;
      if (s.batchNonces?.[nonceKey]) throw new Error("This approval was already used.");
      const typedData = createBatchTypedData(batchPayout, activeChain.id, {
        platform: input.platform,
        claimSigners: input.claimSigners,
        amounts: input.amounts,
        emailHashes: input.emailHashes,
        claimWindow: input.claimWindow,
        nonce: input.nonce,
        deadline: input.deadline,
      });
      const valid = await verifyTypedData({ address: input.platform, signature: input.signature, ...typedData }).catch(() => false);
      if (!valid) throw new Error("The signature doesn't match this payout. Nothing was sent.");
      const rows = input.claimSigners.map((claimSigner, i) => ({ claimSigner, amount: input.amounts[i], emailHash: input.emailHashes[i] }));
      const created = engine.createBatchPayout(s, input.platform, rows, { claimWindowSeconds: Number(input.claimWindow) });
      (s.batchNonces ??= {})[nonceKey] = true;
      save();
      return created;
    },
    async refundExpired(batchId) {
      const result = engine.refundExpired(state(), undefined, batchId);
      save();
      return result;
    },
    async verifySignature(signer, typedData, signature) {
      return verifyTypedData({ address: signer, signature, ...typedData } as VerifyTypedDataParameters).catch(() => false);
    },
  };
}

/** The demo's stand-in for the x402 payout account (it has no key anyone holds). */
export function mockOperatorAddress(): Address {
  return privateKeyToAccount(keccak256(toBytes("fanout-mock:x402-operator"))).address;
}
