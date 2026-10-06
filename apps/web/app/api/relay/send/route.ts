import { SeverityNumber } from "@opentelemetry/api-logs";
import { after, NextResponse } from "next/server";
import { emitPosthogLog, flushPosthogLogs } from "@/instrumentation";
import { SessionExpired } from "@/lib/auth/privy-server";
import { ClaimRefused, relaySend, relaySendConfigured, RelayUnavailable } from "@/lib/fanout/relayer";

// Best-effort per-instance rate limit: each send costs the relayer gas.
const hits = new Map<string, number[]>();
function limited(ip: string, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

/** GET -> { available }: whether this server can send for payees. Asked before the payee signs anything. */
export function GET() {
  return NextResponse.json({ available: relaySendConfigured() });
}

/**
 * POST { from, to, value, validAfter, validBefore, nonce, signature } (integers as decimal strings)
 * -> { txHash }. Sends the payee's dollars with their signed authorization; the relayer pays the
 * fee (lib/fanout/erc3009.ts). 503 { unavailable: true } when the relayer isn't set up.
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
    const { txHash } = await relaySend({
      from: body.from,
      to: body.to,
      value: body.value,
      validAfter: body.validAfter,
      validBefore: body.validBefore,
      nonce: body.nonce,
      signature: body.signature,
      accessToken: request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
    });
    emitPosthogLog("Relayed send completed", SeverityNumber.INFO, { route: "/api/relay/send" });
    after(flushPosthogLogs);
    return NextResponse.json({ txHash });
  } catch (err) {
    if (err instanceof RelayUnavailable) return NextResponse.json({ error: err.message, unavailable: true }, { status: 503 });
    const refused = err instanceof ClaimRefused;
    const expired = err instanceof SessionExpired;
    emitPosthogLog("Relayed send rejected", SeverityNumber.WARN, {
      route: "/api/relay/send",
      error_kind: expired ? "session_expired" : refused ? "refused" : "send_failed",
    });
    after(flushPosthogLogs);
    const message = err instanceof Error ? err.message : "Something went wrong and nothing was sent.";
    return NextResponse.json({ error: message }, { status: expired ? 401 : refused ? 403 : 400 });
  }
}
