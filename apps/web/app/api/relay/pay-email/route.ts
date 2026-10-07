import { SeverityNumber } from "@opentelemetry/api-logs";
import { after, NextResponse } from "next/server";
import { emitPosthogLog, flushPosthogLogs } from "@/instrumentation";
import { SessionExpired } from "@/lib/auth/privy-server";
import { ClaimRefused, relayEmailPayment, relayEmailPaymentConfigured, RelayUnavailable } from "@/lib/fanout/relayer";

// Best-effort per-instance rate limit: each payment costs the relayer gas.
const hits = new Map<string, number[]>();
function limited(ip: string, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

/** GET -> { available }: whether this server can pay by email for an account (v3 contracts and relayer set up). */
export function GET() {
  return NextResponse.json({ available: relayEmailPaymentConfigured() });
}

/**
 * POST { platform, claimSigners, amounts, emailHashes, claimWindow, nonce, deadline, signature,
 * deposit: { validAfter, validBefore, nonce, signature } } (integers as decimal strings)
 * -> { txHash, batchId }. Deposits the account's dollars and pays them out by email in one
 * transaction, with the account's two signatures; the relayer pays the fee (relayer.ts
 * relayEmailPayment). 503 { unavailable: true } when this server can't.
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
    const { txHash, batchId } = await relayEmailPayment({
      body,
      accessToken: request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
    });
    emitPosthogLog("Relayed email payment completed", SeverityNumber.INFO, { route: "/api/relay/pay-email" });
    after(flushPosthogLogs);
    return NextResponse.json({ txHash, batchId });
  } catch (err) {
    if (err instanceof RelayUnavailable) return NextResponse.json({ error: err.message, unavailable: true }, { status: 503 });
    const refused = err instanceof ClaimRefused;
    const expired = err instanceof SessionExpired;
    emitPosthogLog("Relayed email payment rejected", SeverityNumber.WARN, {
      route: "/api/relay/pay-email",
      error_kind: expired ? "session_expired" : refused ? "refused" : "payment_failed",
    });
    after(flushPosthogLogs);
    const message = err instanceof Error ? err.message : "Something went wrong and nothing was sent.";
    return NextResponse.json({ error: message }, { status: expired ? 401 : refused ? 403 : 400 });
  }
}
