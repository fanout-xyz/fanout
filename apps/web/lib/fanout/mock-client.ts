import type { FanoutClient, FanoutClientContext } from "./client";
import type { EngineMethod } from "./mock-engine";
import { TestDollarsCooldown } from "./test-dollars";
import { NotFoundError } from "./types";
import { fromWire, toWire } from "./wire";

/**
 * Mock client: talks to the shared mock backend at /api/mock (see mock-engine.ts).
 * Every device that reaches the same dev server sees the same payouts, so a claim
 * link opened on a phone works against a batch created on a laptop.
 */

async function rpc<T>(method: EngineMethod, account: string | undefined, args: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/mock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: toWire({ method, account, args }),
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  let body: { result?: T; error?: string; notFound?: boolean; retryAt?: number };
  try {
    body = fromWire(text);
  } catch {
    throw new Error("The server sent an unexpected response. Try again.");
  }
  if (!res.ok || body.error) {
    const message = body.error ?? "Something went wrong. Try again.";
    if (typeof body.retryAt === "number") throw new TestDollarsCooldown(message, body.retryAt);
    throw body.notFound ? new NotFoundError(message) : new Error(message);
  }
  return body.result as T;
}

export function createMockClient(ctx: FanoutClientContext): FanoutClient {
  const a = ctx.account;
  return {
    getTreasuryBalance: (platform) => rpc("getTreasuryBalance", a, [platform]),
    deposit: (amount) => rpc("deposit", a, [amount]),
    createBatchPayout: (rows) => rpc("createBatchPayout", a, [rows]),
    getBatch: (batchId) => rpc("getBatch", a, [batchId]),
    getClaim: (claimSigner) => rpc("getClaim", a, [claimSigner]),
    claim: (claimSigner, recipient, signature) => rpc("claim", a, [claimSigner, recipient, signature]),
    getPayeeBalance: (address) => rpc("getPayeeBalance", a, [address]),
    send: (to, amount) => rpc("send", a, [to, amount]),
    sendGasless: (to, amount) => rpc("sendGasless", a, [to, amount]),
    receiveAsUsdc: (amount) => rpc("receiveAsUsdc", a, [amount]),
    getPayeeUsdcBalance: (address) => rpc("getPayeeUsdcBalance", a, [address]),
    getTestDollars: () => rpc("getTestDollars", a, []),
    listBatches: (platform) => rpc("listBatches", a, [platform]),
    getPayeeHistory: (address) => rpc("getPayeeHistory", a, [address]),
  };
}

/** Demo helper (not part of FanoutClient): simulates claim expiry for a batch the account sent. */
export function mockRefundUnclaimed(account: string | undefined, batchId: string): Promise<null> {
  return rpc("refundUnclaimed", account, [batchId]);
}

/** Demo helper: marks up to `count` waiting payments in a batch the account sent as claimed. Resolves with how many were. */
export function mockSimulateClaims(account: string | undefined, batchId: string, count: number): Promise<number> {
  return rpc("simulateClaims", account, [batchId, count]);
}
