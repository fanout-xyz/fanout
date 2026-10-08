/**
 * Shared by both workflows and the local scripts: the FanoutKeeper report format and the few
 * contract functions and indexer queries the workflows use. No package imports, so each workflow
 * bundles it with its own viem. Contract side: smart-contract/contracts/FanoutKeeper.sol.
 *
 * A report is abi.encode(uint8 kind, bytes body):
 *   REFUND_EXPIRED  body = abi.encode(address[] claimSigners)
 *   CREATE_BATCH    body = abi.encode(address platform, address[] claimSigners, uint256[] amounts,
 *                                    bytes32[] emailHashes, uint64 claimWindow,
 *                                    (bytes32 nonce, uint256 deadline, bytes signature) auth)
 */

export const REFUND_EXPIRED = 1;
export const CREATE_BATCH = 2;

export const REPORT_PARAMS = [
  { name: "kind", type: "uint8" },
  { name: "body", type: "bytes" },
] as const;

export const REFUND_BODY_PARAMS = [{ name: "claimSigners", type: "address[]" }] as const;

export const CREATE_BATCH_BODY_PARAMS = [
  { name: "platform", type: "address" },
  { name: "claimSigners", type: "address[]" },
  { name: "amounts", type: "uint256[]" },
  { name: "emailHashes", type: "bytes32[]" },
  { name: "claimWindow", type: "uint64" },
  {
    name: "auth",
    type: "tuple",
    components: [
      { name: "nonce", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
  },
] as const;

export const BATCH_PAYOUT_ABI = [
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "platform", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "createBatchFor",
    stateMutability: "nonpayable",
    inputs: CREATE_BATCH_BODY_PARAMS,
    outputs: [{ name: "batchId", type: "uint256" }],
  },
] as const;

export const TREASURY_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "platform", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Claims still unclaimed after their claim window, oldest first, from one BatchPayout deployment
 * (Envio indexer, indexer/schema.graphql). Claim ids are the claim signers.
 */
export const EXPIRED_CLAIMS_QUERY = `query ExpiredClaims($cutoff: Int!, $batchPayout: String!, $limit: Int!) {
  Claim(
    where: { status: { _eq: Sent }, expiresAt: { _lte: $cutoff }, batch: { batchPayout: { _eq: $batchPayout } } }
    order_by: [{ expiresAt: asc }, { id: asc }]
    limit: $limit
  ) { id batch_id expiresAt }
}`;

/** One expired, unclaimed row as the indexer returns it. */
export type ExpiredClaim = { id: string; batch_id: string; expiresAt: number };

/**
 * One scheduled payout: a CreateBatch authorization the platform signed ahead of time, plus when it
 * becomes due. Every field but `id` and `notBefore` is covered by the platform's signature.
 */
export type ScheduledPayout = {
  id: string;
  /** Unix seconds: submit at or after this time. */
  notBefore: number;
  platform: string;
  claimSigners: string[];
  /** Raw AUSD units (6 decimals), as decimal strings. */
  amounts: string[];
  emailHashes: string[];
  /** Seconds; "0" = BatchPayout's default (30 days). */
  claimWindow: string;
  nonce: string;
  /** Unix seconds, as a decimal string: BatchPayout refuses the authorization after this. */
  deadline: string;
  signature: string;
};

export type Schedule = { version: 1; payouts: ScheduledPayout[] };
