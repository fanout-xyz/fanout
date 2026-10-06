import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { deployedAddresses } from "./fanout/abis/contracts.generated";

// NEXT_PUBLIC_* values are inlined at build time only when read as literal
// `process.env.NEXT_PUBLIC_X` expressions, so each one is spelled out here.

function optionalAddress(value: string | undefined): Address | undefined {
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`Invalid address in env: ${value}`);
  return getAddress(value);
}

export const config = {
  useMock: process.env.NEXT_PUBLIC_USE_MOCK !== "false",
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || undefined,

  stablecoin: {
    symbol: "AUSD",
    // Defaults to the token the deployed contracts were built for (see contracts.generated.ts):
    // real Agora AUSD (0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) since the monad-ausd deployment.
    address: optionalAddress(process.env.NEXT_PUBLIC_AUSD_ADDRESS || deployedAddresses.ausd),
    decimals: Number(process.env.NEXT_PUBLIC_AUSD_DECIMALS || 6),
  },

  // Defaults to the Monad testnet deployment (smart-contract/README.md); env vars override. Unused while useMock is true.
  contracts: {
    treasury: optionalAddress(process.env.NEXT_PUBLIC_TREASURY_ADDRESS || deployedAddresses.treasury),
    batchPayout: optionalAddress(process.env.NEXT_PUBLIC_BATCH_PAYOUT_ADDRESS || deployedAddresses.batchPayout),
    claimEscrow: optionalAddress(process.env.NEXT_PUBLIC_CLAIM_ESCROW_ADDRESS || deployedAddresses.claimEscrow),
  },

  // Taking payouts as USDC via Agora's AUSD/USDC stable-swap pair (smart-contract/contracts/SettleToUsdc.sol).
  // Defaults are Monad testnet, where the pair's USDC side is a stand-in token with 18 decimals.
  // Onchain, the option stays hidden until NEXT_PUBLIC_SETTLE_ADDRESS is set (the mock always offers it).
  usdc: {
    address: optionalAddress(process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D"),
    decimals: Number(process.env.NEXT_PUBLIC_USDC_DECIMALS || 18),
    settle: optionalAddress(process.env.NEXT_PUBLIC_SETTLE_ADDRESS),
    pair: optionalAddress(process.env.NEXT_PUBLIC_AGORA_PAIR_ADDRESS || "0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae"),
  },

  // Envio indexer (indexer/) GraphQL endpoint: payout history, tx links, payee activity. Onchain mode only.
  // The free Envio plan gives each deployment its own URL, so update this after an indexer redeploy.
  // "off" = don't use it (fall back to chain reads and this browser's records).
  indexerUrl:
    process.env.NEXT_PUBLIC_INDEXER_URL === "off"
      ? ""
      : process.env.NEXT_PUBLIC_INDEXER_URL || "https://indexer.dev.hyperindex.xyz/e70db85/v1/graphql",

  // Display name shown to payees ("You've been paid $X by <Platform>").
  platformName: process.env.NEXT_PUBLIC_PLATFORM_NAME || "Demo Creator Platform",
} as const;

/** Whether payees are offered USDC: always in the mock, onchain once SettleToUsdc is configured. */
export function usdcSettleEnabled(): boolean {
  return config.useMock || !!(config.usdc.settle && config.usdc.address && config.usdc.pair);
}

// The claim signature commits to this address, so it must be the contract that verifies claims.
export function claimVerifyingContract(): Address {
  return config.contracts.claimEscrow ?? zeroAddress;
}
