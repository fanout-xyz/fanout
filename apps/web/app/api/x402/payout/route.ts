import { feeCents } from "@/lib/x402/config";
import { handleX402Payout } from "@/lib/x402/payout";
import { x402Deps } from "@/lib/x402/server";
import { toAmountString } from "@/lib/agents/rows";

// Settling the payment and creating the payout each wait for a transaction.
export const maxDuration = 60;

// Best-effort per-instance rate limit.
const hits = new Map<string, number[]>();
function limited(ip: string, max = 30, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

/**
 * POST { rows: [{ email, amount: "25.00", note? }], claim_window_days? } with an Idempotency-Key.
 * Without PAYMENT-SIGNATURE: 402 and the price (x402 v2). With it: 200 { payout_id, status_url, ... }.
 * See lib/x402/payout.ts.
 */
export async function POST(request: Request) {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return Response.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
  const wired = x402Deps(request.url);
  if ("unavailable" in wired) return Response.json({ error: wired.unavailable }, { status: 503 });
  try {
    return await handleX402Payout(wired.deps, request);
  } catch (err) {
    console.error("[x402]", err instanceof Error ? err.message : err);
    return Response.json({ error: "Something went wrong before any payment was taken. Try again." }, { status: 500 });
  }
}

/** GET -> what this endpoint takes and charges, for agents discovering it. */
export function GET(request: Request) {
  const wired = x402Deps(request.url);
  if ("unavailable" in wired) return Response.json({ available: false, reason: wired.unavailable });
  const { cfg, account } = wired.deps;
  return Response.json({
    available: true,
    x402Version: 2,
    description: "Pay people by email. POST rows (email, amount as \"25.00\", optional note); the first answer is a 402 with the price.",
    scheme: "exact",
    network: cfg.network,
    asset: { symbol: cfg.asset.symbol, address: cfg.asset.address },
    payTo: account.address,
    fee: { percent: Number(cfg.feeBps) / 100, minimum: toAmountString(feeCents(cfg, 0n), 2), currency: "USD" },
    limits: { max_people: cfg.maxRows, max_payout_total: toAmountString(cfg.maxTotalCents, 2) },
    idempotency: "Required: Idempotency-Key header, the same one on the paid retry.",
  });
}
