import { getAddress, isAddress, type Address } from "viem";

/**
 * x402 pay-to-payout settings (POST /api/x402/payout). All server env, all optional.
 *
 * X402_NETWORK      "monad-testnet" (default, eip155:10143) or "monad" (mainnet, eip155:143).
 * X402_ASSET        "usdc" (default): Circle USDC on that network, the asset Monad's x402 docs and
 *                   facilitator list. "ausd": Agora AUSD, which also supports ERC-3009, but which no
 *                   public facilitator documents; use it with X402_FACILITATOR=self.
 * X402_FACILITATOR  A facilitator URL (default https://x402-facilitator.molandak.org, the one Monad's
 *                   docs list for testnet and mainnet), or "self": verify the signature and submit the
 *                   transfer with our own relayer (RELAYER_PRIVATE_KEY pays the gas).
 * X402_OPERATOR_PRIVATE_KEY  The account paid (payTo) and the one the payout is sent from: it keeps a
 *                   payout balance (AUSD in the Treasury) as float, and receives the asset. Rebalancing
 *                   the received USDC into AUSD is an operations task, outside this endpoint.
 * X402_FEE_BPS (default 50 = 0.5%), X402_FEE_MIN_USD (default "0.10"), X402_MAX_ROWS (default 50),
 * X402_MAX_TOTAL_USD (default "1000.00").
 *
 * The local demo (NEXT_PUBLIC_USE_MOCK) checks real signatures but settles nothing onchain.
 */

export type X402Asset = { symbol: "USDC" | "AUSD"; address: Address; decimals: number; eip712: { name: string; version: string } };

export type X402Config = {
  network: string;
  chainId: number;
  asset: X402Asset;
  facilitator: { kind: "http"; url: string } | { kind: "self" } | { kind: "mock" };
  feeBps: bigint;
  /** In cents. */
  feeMinCents: bigint;
  maxRows: number;
  /** Payout total cap, in cents (fee not included). */
  maxTotalCents: bigint;
};

/** Circle USDC, from Monad's x402 guide (https://docs.monad.xyz/guides/x402). */
const USDC: Record<number, Address> = {
  10143: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  143: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
};
/** Agora AUSD (same address on Monad testnet and mainnet). */
const AUSD: Address = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";

export const DEFAULT_FACILITATOR_URL = "https://x402-facilitator.molandak.org";

type Env = Record<string, string | undefined>;

const cents = (v: string | undefined, fallback: string) => {
  const s = (v || fallback).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid dollar amount in x402 config: ${s}`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
};

export function x402Config(env: Env = process.env, useMock = env.NEXT_PUBLIC_USE_MOCK !== "false"): X402Config {
  const mainnet = env.X402_NETWORK === "monad";
  const chainId = mainnet ? 143 : 10143;
  const asset: X402Asset =
    env.X402_ASSET === "ausd"
      ? { symbol: "AUSD", address: AUSD, decimals: 6, eip712: { name: "Agora Dollar", version: "1" } }
      : { symbol: "USDC", address: USDC[chainId], decimals: 6, eip712: { name: "USDC", version: "2" } };
  const f = env.X402_FACILITATOR?.trim();
  const facilitator: X402Config["facilitator"] =
    f === "self" ? { kind: "self" } : f && /^https:\/\//.test(f) ? { kind: "http", url: f.replace(/\/$/, "") } : useMock ? { kind: "mock" } : { kind: "http", url: DEFAULT_FACILITATOR_URL };
  return {
    network: `eip155:${chainId}`,
    chainId,
    asset,
    facilitator,
    feeBps: BigInt(env.X402_FEE_BPS || 50),
    feeMinCents: cents(env.X402_FEE_MIN_USD, "0.10"),
    maxRows: Math.min(Number(env.X402_MAX_ROWS || 50), 150),
    maxTotalCents: cents(env.X402_MAX_TOTAL_USD, "1000.00"),
  };
}

/** The fee in cents: X402_FEE_BPS of the payout, at least X402_FEE_MIN_USD, rounded up to the cent. */
export function feeCents(cfg: Pick<X402Config, "feeBps" | "feeMinCents">, totalCents: bigint): bigint {
  const pct = (totalCents * cfg.feeBps + 9_999n) / 10_000n;
  return pct > cfg.feeMinCents ? pct : cfg.feeMinCents;
}

export function operatorKey(env: Env = process.env): `0x${string}` | null {
  const k = env.X402_OPERATOR_PRIVATE_KEY;
  return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as `0x${string}`) : null;
}

export function checksum(a: string): Address {
  if (!isAddress(a)) throw new Error(`Invalid address: ${a}`);
  return getAddress(a);
}
