/**
 * Contract ABIs for onchain-client.ts.
 *
 * The Fanout contracts' ABIs are generated from smart-contract/ignition/deployments by
 * `pnpm --filter smart-contract export-abis`; don't edit contracts.generated.ts by hand.
 */

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

// Treasury, BatchPayout and ClaimEscrow ABIs come from the Monad testnet deployment.
export { batchPayoutAbi, claimEscrowAbi, treasuryAbi } from "./contracts.generated";

/**
 * SettleToUsdc (smart-contract/contracts/SettleToUsdc.sol). Hand-written because it is deployed on
 * its own, apart from the payout contracts export-abis reads; keep it in step with the contract.
 */
export const settleToUsdcAbi = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "salt", type: "bytes32" },
      { name: "minOut", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  { type: "function", name: "ausd", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "usdc", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pair", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "event",
    name: "SettledToUsdc",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
    ],
  },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
] as const;

/** The parts of Agora's stable-swap pair we read, plus its swap errors so a failed settle decodes by name. */
export const agoraPairAbi = [
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [{ name: "role", type: "string" }, { name: "account", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  { type: "error", name: "Expired", inputs: [] },
  { type: "error", name: "InsufficientOutputAmount", inputs: [] },
  { type: "error", name: "InsufficientLiquidity", inputs: [] },
  { type: "error", name: "PairIsPaused", inputs: [] },
  { type: "error", name: "PriceExpired", inputs: [] },
] as const;

/** ERC-5267 EIP-712 domain, e.g. Agora AUSD's ("Agora Dollar", version "1"). */
export const eip712DomainAbi = [
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
] as const;
