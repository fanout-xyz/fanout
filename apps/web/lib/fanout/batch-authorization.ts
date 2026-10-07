import type { Address, Hex, LocalAccount, WalletClient } from "viem";

/**
 * A platform's consent to a payout someone else submits (BatchPayout.createBatchFor and
 * depositAndCreateBatchFor). The platform signs one EIP-712 CreateBatch message that fixes every
 * row (claim signer, amount, email hash), the claim window, a one-time random nonce and a deadline.
 * Our relayer submits it and pays the gas; it can't change a row, reuse the signature, or submit it late.
 *
 * Domain: name "Fanout BatchPayout", version "1", the chain id and the BatchPayout address.
 * No imports from "@/": the contract tests sign with this file too.
 */

export type CreateBatchAuthorization = {
  platform: Address;
  claimSigners: readonly Address[];
  amounts: readonly bigint[];
  emailHashes: readonly Hex[];
  /** Seconds; 0 = the contract's default (30 days). */
  claimWindow: bigint;
  nonce: Hex;
  /** Unix seconds; the authorization can't be used after this. */
  deadline: bigint;
};

export const BATCH_PAYOUT_DOMAIN_NAME = "Fanout BatchPayout";
export const BATCH_PAYOUT_DOMAIN_VERSION = "1";

/** How long a signed CreateBatch stays usable: long enough for the relayer, short enough not to linger. */
export const BATCH_AUTHORIZATION_WINDOW_SECONDS = 10n * 60n;

const createBatchTypes = {
  CreateBatch: [
    { name: "platform", type: "address" },
    { name: "claimSigners", type: "address[]" },
    { name: "amounts", type: "uint256[]" },
    { name: "emailHashes", type: "bytes32[]" },
    { name: "claimWindow", type: "uint64" },
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function createBatchTypedData(batchPayout: Address, chainId: number, auth: CreateBatchAuthorization) {
  return {
    domain: { name: BATCH_PAYOUT_DOMAIN_NAME, version: BATCH_PAYOUT_DOMAIN_VERSION, chainId, verifyingContract: batchPayout },
    types: createBatchTypes,
    primaryType: "CreateBatch" as const,
    message: {
      platform: auth.platform,
      claimSigners: auth.claimSigners,
      amounts: auth.amounts,
      emailHashes: auth.emailHashes,
      claimWindow: auth.claimWindow,
      nonce: auth.nonce,
      deadline: auth.deadline,
    },
  };
}

/** Signs with a local account (passkey account, tests) or a wallet client (sign-in account). */
export function signCreateBatch(
  signer: LocalAccount | WalletClient,
  batchPayout: Address,
  chainId: number,
  auth: CreateBatchAuthorization,
): Promise<Hex> {
  const typedData = createBatchTypedData(batchPayout, chainId, auth);
  if ("type" in signer && signer.type === "local") return (signer as LocalAccount).signTypedData(typedData);
  const wc = signer as WalletClient;
  return wc.signTypedData({ ...typedData, account: wc.account ?? auth.platform });
}
