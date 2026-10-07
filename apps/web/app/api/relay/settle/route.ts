import { SeverityNumber } from "@opentelemetry/api-logs";
import { after, NextResponse } from "next/server";
import { emitPosthogLog, flushPosthogLogs } from "@/instrumentation";
import { SessionExpired } from "@/lib/auth/privy-server";
import { ClaimRefused, relaySettle } from "@/lib/fanout/relayer";

// Best-effort per-instance rate limit: each settle costs the relayer gas.
const hits = new Map<string, number[]>();
function limited(ip: string, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

/**
 * POST { from, value, validAfter, validBefore, salt, minOut, signature } (integers as decimal strings)
 * -> { txHash, amountOut }. Changes the payee's AUSD to USDC (lib/fanout/usdc-settle.ts).
 */
export async function POST(request: Request) {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ error: "Too many tries. Wait a minute and try again." }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const { txHash, amountOut } = await relaySettle({
      from: body.from,
      value: body.value,
      validAfter: body.validAfter,
      validBefore: body.validBefore,
      salt: body.salt,
      minOut: body.minOut,
      signature: body.signature,
      accessToken: request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
    });
    emitPosthogLog("Relayed USDC settle completed", SeverityNumber.INFO, { route: "/api/relay/settle" });
    after(flushPosthogLogs);
    return NextResponse.json({ txHash, amountOut: amountOut.toString() });
  } catch (err) {
    const refused = err instanceof ClaimRefused;
    const expired = err instanceof SessionExpired;
    emitPosthogLog("Relayed USDC settle rejected", SeverityNumber.WARN, {
      route: "/api/relay/settle",
      error_kind: expired ? "session_expired" : refused ? "refused" : "settle_failed",
    });
    after(flushPosthogLogs);
    const message = err instanceof Error ? err.message : "Something went wrong and nothing changed.";
    return NextResponse.json({ error: message }, { status: expired ? 401 : refused ? 403 : 400 });
  }
}
