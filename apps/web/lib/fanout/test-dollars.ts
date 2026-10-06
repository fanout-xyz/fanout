import { parseUnits } from "viem";
import { activeChain } from "@/lib/chains";
import { config } from "@/lib/config";

/**
 * Test dollars: free testnet AUSD so anyone trying Fanout can make a payout without asking for funds.
 * Onchain, our relayer asks Agora's AUSD faucet for them (lib/fanout/test-dollars-relay.ts); in the
 * mock, the engine credits them. Shared by the client, the mock engine and the server.
 */

/** Monad testnet. Test dollars are never offered anywhere else. */
export const TEST_DOLLARS_CHAIN_ID = 10_143;

/** One request per account per day. */
export const TEST_DOLLARS_COOLDOWN_MS = 24 * 60 * 60_000;

/** What the mock credits: the same as one request to Agora's faucet ($10,000). */
export const MOCK_TEST_DOLLARS = parseUnits("10000", config.stablecoin.decimals);

/** Whether to offer test dollars here: always in the mock; onchain only on Monad testnet, unless switched off. */
export function testDollarsEnabled(): boolean {
  if (config.useMock) return true;
  return config.testDollars && activeChain.id === TEST_DOLLARS_CHAIN_ID;
}

/** Refused because of a limit; `retryAt` (unix ms) is when asking again can work. */
export class TestDollarsCooldown extends Error {
  constructor(
    message: string,
    readonly retryAt: number,
  ) {
    super(message);
  }
}

const storageKey = (address: string) => `fanout:test-dollars:${activeChain.id}:${address.toLowerCase()}`;

/** When this browser last saw `address` get test dollars or hit the limit: unix ms it can ask again, or null. */
export function testDollarsRetryAt(address: string | undefined, now = Date.now()): number | null {
  if (!address) return null;
  try {
    const at = Number(localStorage.getItem(storageKey(address)));
    return Number.isFinite(at) && at > now ? at : null;
  } catch {
    return null;
  }
}

export function rememberTestDollarsRetryAt(address: string | undefined, retryAt: number): void {
  if (!address) return;
  try {
    localStorage.setItem(storageKey(address), String(retryAt));
  } catch {
    // Only a convenience: the server still enforces the limit.
  }
}
