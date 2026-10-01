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

// The claim signature commits to this address, so it must be the contract that verifies claims.
export function claimVerifyingContract(): Address {
  return config.contracts.claimEscrow ?? zeroAddress;
}
