import { SeverityNumber } from "@opentelemetry/api-logs";
import { after, NextResponse } from "next/server";
import type { Address } from "viem";
import { emitPosthogLog, flushPosthogLogs } from "@/instrumentation";
import { config } from "@/lib/config";
import { engine, MUTATING, type EngineMethod } from "@/lib/fanout/mock-engine";
import { getMockState, saveMockState } from "@/lib/fanout/mock-store";
import { TestDollarsCooldown } from "@/lib/fanout/test-dollars";
import { NotFoundError } from "@/lib/fanout/types";
import { fromWire, toWire } from "@/lib/fanout/wire";

/**
 * RPC endpoint for the shared mock backend: { method, account, args } -> engine.
 * Demo only. There's no auth: `account` is whatever the client says, which is
 * fine for fake testnet money and wrong for anything real. Disabled unless
 * NEXT_PUBLIC_USE_MOCK is on.
 */

// Accounts come first for these methods; the rest take args only.
const WITH_ACCOUNT = new Set<EngineMethod>(["deposit", "createBatchPayout", "payFromAccount", "refundExpired", "send", "sendGasless", "receiveAsUsdc", "refundUnclaimed", "simulateClaims", "getTestDollars"]);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: Request) {
  if (!config.useMock) return new NextResponse(null, { status: 404 });

  let body: { method: EngineMethod; account?: Address; args: unknown[] };
  try {
    body = fromWire(await request.text());
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const fn = engine[body.method] as ((...a: unknown[]) => unknown) | undefined;
  if (!Object.hasOwn(engine, body.method) || typeof fn !== "function" || !Array.isArray(body.args)) {
    return NextResponse.json({ error: "Unknown method." }, { status: 400 });
  }

  // Feel like a network + chain: reads are quick, writes take about a block or two.
  await delay(MUTATING.has(body.method) ? 600 + Math.random() * 600 : 120 + Math.random() * 200);

  const state = getMockState();
  try {
    const args = WITH_ACCOUNT.has(body.method) ? [state, body.account, ...body.args] : [state, ...body.args];
    const result = await fn(...args);
    if (MUTATING.has(body.method)) {
      saveMockState();
      emitPosthogLog("Mock payout operation completed", SeverityNumber.INFO, {
        route: "/api/mock",
        operation_type: "mutation",
      });
      after(flushPosthogLogs);
    }
    return new NextResponse(toWire({ result }), { headers: { "content-type": "application/json" } });
  } catch (err) {
    const notFound = err instanceof NotFoundError;
    emitPosthogLog("Mock payout operation rejected", SeverityNumber.WARN, {
      route: "/api/mock",
      error_kind: notFound ? "not_found" : "operation_failed",
    });
    after(flushPosthogLogs);
    const message = err instanceof Error ? err.message : "Something went wrong.";
    const retryAt = err instanceof TestDollarsCooldown ? err.retryAt : undefined;
    return new NextResponse(toWire({ error: message, notFound, retryAt }), {
      status: err instanceof NotFoundError ? 404 : 400,
      headers: { "content-type": "application/json" },
    });
  }
}
