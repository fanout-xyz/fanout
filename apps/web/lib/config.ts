import { getAddress, isAddress, type Address } from "viem";
import { deployed } from "./fanout/abis/deployed";

// NEXT_PUBLIC_* values are inlined at build time only when read as literal
// `process.env.NEXT_PUBLIC_X` expressions, so each one is spelled out here.

function optionalAddress(value: string | undefined): Address | undefined {
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`Invalid address in env: ${value}`);
  return getAddress(value);
}

export const config = {
  /** true (default): shared mock backend with fake money. false: the deployed contracts on Monad testnet. */
  useMock: process.env.NEXT_PUBLIC_USE_MOCK !== "false",
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || undefined,

  stablecoin: {
    symbol: "AUSD",
    // Agora AUSD on Monad testnet: 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC
    // (docs.agora.finance/developer/contract-deployments; decimals()=6 confirmed onchain).
    address: optionalAddress(process.env.NEXT_PUBLIC_AUSD_ADDRESS) ?? getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC"),
    decimals: Number(process.env.NEXT_PUBLIC_AUSD_DECIMALS || 6),
  },

  // Monad testnet deployment (lib/fanout/abis/deployed.ts); env vars override, e.g. for a local chain.
  contracts: {
    treasury: optionalAddress(process.env.NEXT_PUBLIC_TREASURY_ADDRESS) ?? getAddress(deployed.treasury),
    batchPayout: optionalAddress(process.env.NEXT_PUBLIC_BATCH_PAYOUT_ADDRESS) ?? getAddress(deployed.batchPayout),
    claimEscrow: optionalAddress(process.env.NEXT_PUBLIC_CLAIM_ESCROW_ADDRESS) ?? getAddress(deployed.claimEscrow),
  },

  /** Must match BatchPayout.MAX_ROWS (gas cap per transaction). */
  maxRowsPerBatch: 150,
  /** Faucet for testnet MON (network fees). */
  monFaucetUrl: "https://faucet.monad.xyz",

  // Display name shown to payees ("You've been paid $X by <Platform>").
  platformName: process.env.NEXT_PUBLIC_PLATFORM_NAME || "Demo Creator Platform",
} as const;

// The claim signature commits to this address, so it must be the contract that verifies claims.
export function claimVerifyingContract(): Address {
  return config.contracts.claimEscrow;
}
