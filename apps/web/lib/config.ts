import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { generatedPayoutsV3 } from "./fanout/abis";
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

  // Whether the payout contracts are v3 (smart-contract/README.md): per-payout claim windows and
  // paying by email with no MON. On when contracts.generated.ts comes from a v3 deployment;
  // NEXT_PUBLIC_PAYOUT_CONTRACTS=v3 turns it on for v3 addresses set through the env vars above,
  // and any other value (e.g. "v2") forces it off.
  payoutsV3: process.env.NEXT_PUBLIC_PAYOUT_CONTRACTS ? process.env.NEXT_PUBLIC_PAYOUT_CONTRACTS === "v3" : generatedPayoutsV3,

  // Taking payouts as USDC via Agora's AUSD/USDC stable-swap pair (smart-contract/contracts/SettleToUsdc.sol).
  // Defaults are Monad testnet, where the pair's USDC side is a stand-in token with 18 decimals.
  // The settle contract defaults to the monad-settle-usdc deployment; set NEXT_PUBLIC_SETTLE_ADDRESS=off to hide the option.
  usdc: {
    address: optionalAddress(process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D"),
    decimals: Number(process.env.NEXT_PUBLIC_USDC_DECIMALS || 18),
    settle:
      process.env.NEXT_PUBLIC_SETTLE_ADDRESS === "off"
        ? undefined
        : optionalAddress(process.env.NEXT_PUBLIC_SETTLE_ADDRESS || "0xA1ac3cBe75697e4Ad7C5fF393EbC3AE9fa67DeC2"),
    pair: optionalAddress(process.env.NEXT_PUBLIC_AGORA_PAIR_ADDRESS || "0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae"),
  },

  // Envio indexer (indexer/) GraphQL endpoint: payout history, tx links, payee activity. Onchain mode only.
  // The free Envio plan gives each deployment its own URL, so update this after an indexer redeploy.
  // "off" = don't use it (fall back to chain reads and this browser's records).
  indexerUrl:
    process.env.NEXT_PUBLIC_INDEXER_URL === "off"
      ? ""
      : process.env.NEXT_PUBLIC_INDEXER_URL || "https://indexer.dev.hyperindex.xyz/1b4e07c/v1/graphql",

  // "Get test dollars" on the dashboard (lib/fanout/test-dollars.ts). Onchain it only shows on Monad testnet; "off" hides it.
  testDollars: process.env.NEXT_PUBLIC_TEST_DOLLARS !== "off",

  // Display name shown to payees ("You've been paid $X by <Platform>").
  platformName: process.env.NEXT_PUBLIC_PLATFORM_NAME || "Demo Creator Platform",
} as const;

/** Whether payees are offered USDC: always in the mock, onchain once SettleToUsdc is configured. */
export function usdcSettleEnabled(): boolean {
  return config.useMock || !!(config.usdc.settle && config.usdc.address && config.usdc.pair);
}

/** Whether a payout can choose when unclaimed money returns: always in the mock, onchain with the v3 contracts. */
export function claimWindowEnabled(): boolean {
  return config.useMock || config.payoutsV3;
}

// The claim signature commits to this address, so it must be the contract that verifies claims.
export function claimVerifyingContract(): Address {
  return config.contracts.claimEscrow ?? zeroAddress;
}
