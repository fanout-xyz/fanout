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
