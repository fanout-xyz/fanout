import { formatUnits, parseUnits } from "viem";

/**
 * Aurora Intents Deposits (https://docs.intents.aurora.dev): a platform adds money from another
 * chain. Aurora quotes the route and gives a one-off deposit address on the source chain; the
 * platform sends USDC or USDT there, and USDC arrives in the platform's account on Monad.
 *
 * Aurora runs on mainnets only, and on Monad it delivers MON, USDC or USDT0, not AUSD. Turning
 * that USDC into AUSD for the payout balance is a separate step (Agora's AUSD/USDC pair).
 */

export const AURORA_API = "https://intents-api.aurora.dev/api";

/** Where the money lands: USDC on Monad mainnet (Aurora asset id). */
export const MONAD_USDC = "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx";
export const MONAD_USDC_DECIMALS = 6;

/** EVM source chains: the platform's address is the same there, so it is also the refund address. */
export const SOURCE_CHAINS: Record<string, string> = {
  base: "Base",
  arb: "Arbitrum",
  eth: "Ethereum",
  op: "Optimism",
  pol: "Polygon",
  bsc: "BNB Chain",
  avax: "Avalanche",
};

const STABLES = new Set(["USDC", "USDT"]);

export type AuroraToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  contractAddress?: string | null;
};

export type SourceOption = { assetId: string; chain: string; chainName: string; symbol: string; decimals: number; contract?: string | null };

/** Dollar stablecoins on the supported EVM chains, Base first. */
export function sourceOptions(tokens: AuroraToken[]): SourceOption[] {
  const order = Object.keys(SOURCE_CHAINS);
  return tokens
    .filter((t) => t.blockchain in SOURCE_CHAINS && STABLES.has(t.symbol))
    .map((t) => ({
      assetId: t.assetId,
      chain: t.blockchain,
      chainName: SOURCE_CHAINS[t.blockchain],
      symbol: t.symbol,
      decimals: t.decimals,
      contract: t.contractAddress,
    }))
    .sort((a, b) => order.indexOf(a.chain) - order.indexOf(b.chain) || a.symbol.localeCompare(b.symbol));
}

export type QuoteInput = { originAsset: string; amountUsd: string; recipient: `0x${string}`; dry: boolean };

/** Request body for "deliver exactly this many dollars of USDC to the platform on Monad". */
export function quoteBody({ originAsset, amountUsd, recipient, dry }: QuoteInput) {
  return {
    dry,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 50,
    depositType: "ORIGIN_CHAIN",
    depositMode: "SIMPLE",
    originAsset,
    destinationAsset: MONAD_USDC,
    amount: parseUnits(amountUsd, MONAD_USDC_DECIMALS).toString(),
    recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo: recipient,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
    quoteWaitingTimeMs: 3000,
  };
}

export type Quote = {
  depositAddress?: string;
  amountIn: string;
  amountInFormatted: string;
  maxAmountIn?: string;
  amountOut: string;
  amountOutFormatted: string;
  timeEstimate?: number;
  deadline?: string;
};

export type SwapStatus = "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

export type StatusReply = {
  status: SwapStatus;
  swapDetails?: { amountOutFormatted?: string; destinationChainTxHashes?: { hash: string; explorerUrl?: string }[]; refundReason?: string };
};

/** Plain-language step for each status. */
export function statusLabel(s: SwapStatus): { label: string; done: boolean; failed: boolean } {
  switch (s) {
    case "PENDING_DEPOSIT":
      return { label: "Waiting for your transfer", done: false, failed: false };
    case "KNOWN_DEPOSIT_TX":
    case "PROCESSING":
      return { label: "Transfer received, moving it to Monad", done: false, failed: false };
    case "INCOMPLETE_DEPOSIT":
      return { label: "Less than the quoted amount arrived. Send the rest, or wait for the refund", done: false, failed: true };
    case "SUCCESS":
      return { label: "Arrived on Monad", done: true, failed: false };
    case "REFUNDED":
      return { label: "Refunded to your address on the source chain", done: true, failed: true };
    case "FAILED":
      return { label: "Something went wrong. Contact Aurora support with your deposit address", done: true, failed: true };
  }
}

/** "50.12" from base units, trimmed to cents for display. */
export function formatToken(amount: string, decimals: number): string {
  const n = Number(formatUnits(BigInt(amount), decimals));
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
