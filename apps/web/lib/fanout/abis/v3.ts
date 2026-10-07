/**
 * What the v3 payout contracts add (smart-contract/README.md, "v3"): per-payout claim windows,
 * gasless deposits and payouts signed by the platform, and refunding many claims at once.
 *
 * Hand-written so the app can call these before contracts.generated.ts is regenerated from the
 * monad-v3 deployment. smart-contract/test/AbiFragments.ts checks every entry against the compiled
 * contracts. Only used when config.payoutsV3 is on; the older deployment doesn't have them.
 * No imports: the contract tests read this file too.
 */

const rowInputs = [
  { name: "claimSigners", type: "address[]" },
  { name: "amounts", type: "uint256[]" },
  { name: "emailHashes", type: "bytes32[]" },
] as const;

const batchAuthorization = {
  name: "auth",
  type: "tuple",
  components: [
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint256" },
    { name: "signature", type: "bytes" },
  ],
} as const;

const depositAuthorization = {
  name: "deposit",
  type: "tuple",
  components: [
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "signature", type: "bytes" },
  ],
} as const;

export const batchPayoutV3Abi = [
  {
    type: "function",
    name: "createBatch",
    stateMutability: "nonpayable",
    inputs: [...rowInputs, { name: "claimWindow", type: "uint64" }],
    outputs: [{ name: "batchId", type: "uint256" }],
  },
  {
    type: "function",
    name: "createBatchFor",
    stateMutability: "nonpayable",
    inputs: [{ name: "platform", type: "address" }, ...rowInputs, { name: "claimWindow", type: "uint64" }, batchAuthorization],
    outputs: [{ name: "batchId", type: "uint256" }],
  },
  {
    type: "function",
    name: "depositAndCreateBatchFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "platform", type: "address" },
      ...rowInputs,
      { name: "claimWindow", type: "uint64" },
      batchAuthorization,
      depositAuthorization,
    ],
    outputs: [{ name: "batchId", type: "uint256" }],
  },
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [{ name: "platform", type: "address" }, { name: "nonce", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  { type: "function", name: "MIN_CLAIM_WINDOW", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "MAX_CLAIM_WINDOW", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "DEFAULT_CLAIM_WINDOW", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  {
    type: "event",
    name: "BatchCreated",
    inputs: [
      { name: "batchId", type: "uint256", indexed: true },
      { name: "platform", type: "address", indexed: true },
      { name: "total", type: "uint256", indexed: false },
      { name: "count", type: "uint256", indexed: false },
    ],
  },
  {
    type: "error",
    name: "ClaimWindowOutOfRange",
    inputs: [
      { name: "claimWindow", type: "uint64" },
      { name: "min", type: "uint64" },
      { name: "max", type: "uint64" },
    ],
  },
  { type: "error", name: "AuthorizationExpired", inputs: [{ name: "deadline", type: "uint256" }] },
  {
    type: "error",
    name: "AuthorizationAlreadyUsed",
    inputs: [
      { name: "platform", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  { type: "error", name: "BadAuthorization", inputs: [] },
] as const;

export const treasuryV3Abi = [
  {
    type: "function",
    name: "depositWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const claimEscrowV3Abi = [
  {
    type: "function",
    name: "refundMany",
    stateMutability: "nonpayable",
    inputs: [{ name: "claimSigners", type: "address[]" }],
    outputs: [{ name: "refunded", type: "uint256" }],
  },
] as const;
