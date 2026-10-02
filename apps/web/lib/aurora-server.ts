import "server-only";
import { AURORA_API, sourceOptions, type AuroraToken } from "./aurora";

// Aurora's app key isn't secret (their docs say it can ship in a website), but keeping it on the
// server lets us validate requests and swap keys without a redeploy of the client.
export const auroraKey = () => process.env.AURORA_APP_KEY ?? "";
export const auroraEnabled = () => auroraKey().length > 0;

export async function auroraFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${AURORA_API}/${path}/${encodeURIComponent(auroraKey())}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
}

let cached: { at: number; tokens: AuroraToken[] } | null = null;

/** Aurora's token list, cached for 10 minutes. */
export async function auroraTokens(): Promise<AuroraToken[]> {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.tokens;
  const res = await auroraFetch("tokens");
  if (!res.ok) throw new Error(`tokens ${res.status}`);
  const body = (await res.json()) as AuroraToken[] | { tokens: AuroraToken[] };
  const tokens = Array.isArray(body) ? body : body.tokens;
  cached = { at: Date.now(), tokens };
  return tokens;
}

export async function allowedSources() {
  return sourceOptions(await auroraTokens());
}
