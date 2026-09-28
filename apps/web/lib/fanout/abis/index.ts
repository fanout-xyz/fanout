/**
 * PLACEHOLDER ABIs. Replace with the real ones from contracts/ once they exist.
 *
 * These are the shapes onchain-client.ts is written against, so they double as a
 * concrete proposal for the contract API. Any name or argument that changes here
 * needs a matching change in onchain-client.ts; the FanoutClient interface stays put.
 */

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

// TODO(contracts): placeholder
export const treasuryAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "platform", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

// TODO(contracts): placeholder
export const batchPayoutAbi = [
  {
    type: "function",
    name: "createBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimSigners", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "emailHashes", type: "bytes32[]" }, // bytes32(0) when absent
    ],
    outputs: [{ name: "batchId", type: "uint256" }],
  },
  {
    type: "function",
    name: "getBatch",
    stateMutability: "view",
    inputs: [{ name: "batchId", type: "uint256" }],
    outputs: [
      { name: "platform", type: "address" },
      { name: "createdAt", type: "uint64" },
      { name: "total", type: "uint256" },
      { name: "claimSigners", type: "address[]" },
    ],
  },
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
] as const;

// TODO(contracts): placeholder. status: 0 = sent, 1 = claimed, 2 = refunded
export const claimEscrowAbi = [
  {
    type: "function",
    name: "getClaim",
    stateMutability: "view",
    inputs: [{ name: "claimSigner", type: "address" }],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "platform", type: "address" },
      { name: "status", type: "uint8" },
      { name: "emailHash", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimSigner", type: "address" },
      { name: "recipient", type: "address" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
