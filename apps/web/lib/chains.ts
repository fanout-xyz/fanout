import { defineChain } from "viem";

// Values from https://docs.monad.xyz/developer-essentials/testnet (checked 2026-09-28).
// Chain ID was also confirmed live via eth_chainId on the RPC (0x279f = 10143).
// We define this ourselves instead of using viem's `monadTestnet`, whose explorer URL
// (testnet.monadexplorer.com) doesn't match what Monad's docs list today.
export const monadTestnet = defineChain({
  id: 10_143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: { name: "Monadscan", url: "https://testnet.monadscan.com" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

export const activeChain = monadTestnet;

/** Testnet MON for network fees. */
export const monFaucetUrl = "https://faucet.monad.xyz";

export function explorerTxUrl(txHash: string): string {
  return `${activeChain.blockExplorers.default.url}/tx/${txHash}`;
}
