import "server-only";
import { defineChain, type Chain } from "viem";
import { activeChain } from "@/lib/chains";

/** The chain an x402 payment settles on: Monad testnet (the app's chain) or Monad mainnet. RPC override: X402_RPC_URL. */
export function x402Chain(chainId: number): Chain {
  if (chainId === activeChain.id) {
    return process.env.X402_RPC_URL ? { ...activeChain, rpcUrls: { default: { http: [process.env.X402_RPC_URL] } } } : activeChain;
  }
  return defineChain({
    id: chainId,
    name: "Monad",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [process.env.X402_RPC_URL || "https://rpc.monad.xyz"] } },
  });
}
