import "server-only";
import webpush from "web-push";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { privyClient, SessionExpired, verifiedUser } from "@/lib/auth/privy-server";
import { config } from "@/lib/config";
import { hashEmail } from "@/lib/email-hash";
import { deliverClaimEmails, emailConfigured } from "@/lib/fanout/claim-emailer";
import { formatUsd } from "@/lib/money";
import { pushConfig } from "@/lib/push/config";
import { pushStore } from "@/lib/push/store";
import { siteOrigin } from "@/lib/site-url";
import { agentKv } from "./kv";
import { mockLedger } from "./ledger";
import { onchainLedger } from "./onchain-ledger";
import { agentSecret } from "./seal";
import { AgentError, type AgentDeps } from "./service";
import { agentStore, type AgentKeyRecord, type PayoutRequestRecord } from "./store";

/**
 * Wires the agent service to this deployment: storage (Redis, or memory in the demo), the chain
 * (mock or the relayer), claim emails (Resend) and approval notifications (Web Push).
 * Null when something it can't work without is missing; agentsUnavailableReason() says what.
 */
export function agentDeps(): AgentDeps | null {
  const kv = agentKv();
  const secret = agentSecret();
  if (!kv || !secret) return null;
  return {
    store: agentStore(kv),
    ledger: config.useMock ? mockLedger() : onchainLedger(),
    secret,
    origin: siteOrigin(),
    decimals: config.stablecoin.decimals,
    emailer: emailConfigured() ? { send: (platform, requests, reminder) => deliverClaimEmails(new Set([platform]), requests, { reminder }) } : undefined,
    notify: notifyPlatform,
  };
}

export function agentsUnavailableReason(): string {
  if (!agentKv()) return "Agent keys need somewhere to live: set KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*).";
  if (!agentSecret()) return "Set AGENT_SECRET (32+ random characters) to turn on agent payouts.";
  return "";
}

/** "An agent wants to pay $120.00 to 3 people" on the platform's devices that turned notifications on. */
async function notifyPlatform(key: AgentKeyRecord, r: PayoutRequestRecord): Promise<void> {
  const cfg = pushConfig();
  if (!cfg || !key.notifyEmailHash) return;
  const store = pushStore(cfg);
  const devices = await store.list(key.notifyEmailHash).catch(() => []);
  const people = r.rows.length === 1 ? "1 person" : `${r.rows.length} people`;
  const payload = JSON.stringify({
    title: `${r.agentLabel} wants to pay ${formatUsd(BigInt(r.total))}`,
    body: `${people}${r.withinPolicy ? "" : ", over its limits"}. Tap to review.`,
    url: `/dashboard/agents/approvals/${r.id}`,
    tag: `fanout-agent-${r.id}`,
  });
  await Promise.all(
    devices.map((sub) =>
      webpush.sendNotification(sub, payload, { vapidDetails: cfg.vapid, TTL: 24 * 60 * 60, urgency: "high", timeout: 10_000 }).catch(() => {}),
    ),
  );
}

/**
 * Who's calling a dashboard agent route. The browser names its account in x-fanout-account; onchain
 * that must be one of the wallets of the Privy session in Authorization. The local demo has no real
 * sign-in, so it takes the header as is (and x-fanout-email for notifications).
 */
export async function platformSession(request: Request): Promise<{ platform: Address; emailHash?: Hex }> {
  const account = request.headers.get("x-fanout-account");
  if (!account || !isAddress(account)) throw new AgentError("unauthorized", "Sign in first.");
  const platform = getAddress(account);
  if (config.useMock) {
    const email = request.headers.get("x-fanout-email");
    return { platform, emailHash: email ? hashEmail(email) : undefined };
  }
  const privy = privyClient();
  if (!privy) throw new AgentError("unavailable", "Sign-in isn't set up on this server.");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new AgentError("unauthorized", "Sign in first.");
  let user;
  try {
    user = await verifiedUser(privy, token);
  } catch (err) {
    if (err instanceof SessionExpired) throw new AgentError("unauthorized", err.message);
    throw err;
  }
  if (!user.wallets.has(platform)) throw new AgentError("forbidden", "That account isn't yours.");
  return { platform, emailHash: [...user.emailHashes][0] };
}

const STATUS: Record<AgentError["code"], number> = {
  unauthorized: 401,
  forbidden: 403,
  key_blocked: 403,
  invalid_input: 400,
  not_found: 404,
  not_ready: 409,
  conflict: 409,
  unavailable: 503,
};

/** Turns a refusal into a JSON response; anything unexpected is logged and answered vaguely. */
export function agentErrorResponse(err: unknown): Response {
  if (err instanceof AgentError) return Response.json({ error: err.message, code: err.code, ...err.details }, { status: STATUS[err.code] });
  console.error("[agents]", err instanceof Error ? err.message : err);
  return Response.json({ error: err instanceof Error ? err.message : "Something went wrong. Try again." }, { status: 500 });
}
