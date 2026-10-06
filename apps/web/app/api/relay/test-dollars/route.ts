import { SeverityNumber } from "@opentelemetry/api-logs";
import { after, NextResponse } from "next/server";
import { emitPosthogLog, flushPosthogLogs } from "@/instrumentation";
import { SessionExpired } from "@/lib/auth/privy-server";
import { ClaimRefused, RelayUnavailable } from "@/lib/fanout/relayer";
import { relayTestDollars, TestDollarsLimited } from "@/lib/fanout/test-dollars-relay";

/**
 * POST { address } -> { txHash, amount } (amount in AUSD units, as a decimal string). Gets test dollars
 * from Agora's faucet for the signed-in user's own account, on Monad testnet only; the relayer pays
 * the fee. Limits and guards: lib/fanout/test-dollars-relay.ts. A 429 carries { retryAt } (unix ms).
 */
export async function POST(request: Request) {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const { txHash, amount, toppedUp } = await relayTestDollars({
      address: body.address,
      accessToken: request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
      ip,
    });
    emitPosthogLog("Test dollars sent", SeverityNumber.INFO, { route: "/api/relay/test-dollars", topped_up: toppedUp });
    after(flushPosthogLogs);
    return NextResponse.json({ txHash, amount: amount.toString() });
  } catch (err) {
    const limited = err instanceof TestDollarsLimited;
    const refused = err instanceof ClaimRefused;
    const expired = err instanceof SessionExpired;
    const unavailable = err instanceof RelayUnavailable;
    emitPosthogLog("Test dollars rejected", SeverityNumber.WARN, {
      route: "/api/relay/test-dollars",
      error_kind: limited ? "limited" : expired ? "session_expired" : unavailable ? "unavailable" : refused ? "refused" : "request_failed",
    });
    after(flushPosthogLogs);
    const message = err instanceof Error ? err.message : "Something went wrong. Nothing changed.";
    if (limited) return NextResponse.json({ error: message, retryAt: err.retryAt }, { status: 429 });
    return NextResponse.json({ error: message }, { status: expired ? 401 : unavailable ? 503 : refused ? 403 : 400 });
  }
}
