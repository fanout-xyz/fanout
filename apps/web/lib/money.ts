import { formatUnits, parseUnits } from "viem";
import { config } from "./config";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Base units -> "$1,234.56". Truncates (never rounds up) below the cent. */
export function formatUsd(amount: bigint, decimals: number = config.stablecoin.decimals): string {
  const centsScale = decimals >= 2 ? 10n ** BigInt(decimals - 2) : 1n;
  const cents = decimals >= 2 ? amount / centsScale : amount * 10n ** BigInt(2 - decimals);
  return usd.format(Number(formatUnits(cents, 2)));
}

/**
 * "1,234.56" / "$1234.5" / "20" -> base units. Returns null for anything that
 * isn't a plain non-negative decimal with at most 2 fractional digits.
 */
export function parseUsd(input: string, decimals: number = config.stablecoin.decimals): bigint | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return parseUnits(cleaned, decimals);
}

const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Integer cents -> "$1,234.56". For display-only numbers (landing, demos), not chain amounts. */
export function formatCents(cents: number): string {
  return usdCents.format(Math.round(cents) / 100);
}
