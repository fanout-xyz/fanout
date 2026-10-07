// Live numbers for the landing page's proof strip: AUSD on Monad (Agora's public API) and
// Fanout's own payouts (the Envio indexer). Parsers return null for anything they can't trust,
// so the page hides that number instead of showing a zero or a guess.

/** Agora's public metrics endpoint: AUSD supply per chain, no key needed. */
export const AGORA_METRICS_URL = "https://api.agora.finance/v0/metrics";

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Circulating AUSD on Monad, in dollars, from a GET /v0/metrics body.
 * Reads the Monad row of `chains` (network "monad"), so it still works when other chains are
 * missing and Agora marks the response partial.
 */
export function parseAusdOnMonad(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const chains = (body as { chains?: unknown }).chains;
  if (!Array.isArray(chains)) return null;
  const monad = chains.find(
    (c): c is { circulatingSupply: unknown } => !!c && typeof c === "object" && (c as { network?: unknown }).network === "monad",
  );
  const supply = monad?.circulatingSupply;
  if (typeof supply !== "string" || !DECIMAL.test(supply)) return null;
  const dollars = Number(supply);
  return Number.isFinite(dollars) && dollars > 0 ? dollars : null;
}

export type FanoutStats = {
  /** Raw AUSD units (6 decimals) sent out in payouts, across every platform. */
  paidOut: bigint;
  /** Payouts created (one per CSV). */
  payouts: number;
  /** Payout rows: one per person paid. */
  peoplePaid: number;
  /** Rows the payee has claimed. */
  claimed: number;
};

/** Sums every platform's totals; the query lives in landing-stats-server.ts. */
export const FANOUT_STATS_QUERY = `query { Platform(limit: 1000) { totalPaidOut batchCount claimCount claimedCount } }`;

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** Totals from the indexer's GraphQL response, or null when it's an error or malformed. */
export function parseFanoutStats(body: unknown): FanoutStats | null {
  if (!body || typeof body !== "object") return null;
  const { data, errors } = body as { data?: { Platform?: unknown }; errors?: unknown[] };
  if (errors?.length || !Array.isArray(data?.Platform)) return null;
  const totals: FanoutStats = { paidOut: 0n, payouts: 0, peoplePaid: 0, claimed: 0 };
  for (const row of data.Platform as Record<string, unknown>[]) {
    const { totalPaidOut, batchCount, claimCount, claimedCount } = row ?? {};
    if (typeof totalPaidOut !== "string" || !/^\d+$/.test(totalPaidOut)) return null;
    if (!isCount(batchCount) || !isCount(claimCount) || !isCount(claimedCount)) return null;
    totals.paidOut += BigInt(totalPaidOut);
    totals.payouts += batchCount;
    totals.peoplePaid += claimCount;
    totals.claimed += claimedCount;
  }
  return totals;
}

const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const wholeUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const centsUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const countFmt = new Intl.NumberFormat("en-US");

/**
 * Dollars for a headline number: "$141.2M" from a million up, "$1,051" from $100, "$12.50" below.
 * Rounds down so the page never claims more than is there.
 */
export function formatDollars(dollars: number): string {
  if (dollars >= 1_000_000) {
    const step = dollars >= 1e9 ? 1e8 : 1e5; // one decimal of the compact unit
    return compactUsd.format(Math.floor(dollars / step) * step);
  }
  if (dollars >= 100) return wholeUsd.format(Math.floor(dollars));
  return centsUsd.format(Math.floor(dollars * 100) / 100);
}

/** Raw AUSD units (6 decimals) to dollars, for formatDollars. */
export function unitsToDollars(units: bigint, decimals = 6): number {
  const cents = decimals >= 2 ? units / 10n ** BigInt(decimals - 2) : units * 10n ** BigInt(2 - decimals);
  return Number(cents) / 100;
}

export function formatCount(n: number): string {
  return countFmt.format(n);
}
