import "server-only";
import { config } from "./config";
import { AGORA_METRICS_URL, FANOUT_STATS_QUERY, parseAusdOnMonad, parseFanoutStats, type FanoutStats } from "./landing-stats";

// Fetched while rendering the landing page and cached for a minute. Any failure (timeout,
// bad status, odd shape) gives null, and the page leaves that number out.

const REVALIDATE_S = 60;
const TIMEOUT_MS = 4_000;

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), next: { revalidate: REVALIDATE_S } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Circulating AUSD on Monad, in dollars. */
export async function getAusdOnMonad(): Promise<number | null> {
  return parseAusdOnMonad(await getJson(AGORA_METRICS_URL, { headers: { accept: "application/json" } }));
}

/** Fanout's payouts so far, from the indexer. Null when the indexer is off or unreachable. */
export async function getFanoutStats(): Promise<FanoutStats | null> {
  if (!config.indexerUrl) return null;
  return parseFanoutStats(
    await getJson(config.indexerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: FANOUT_STATS_QUERY }),
    }),
  );
}
