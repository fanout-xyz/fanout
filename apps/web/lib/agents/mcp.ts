import "server-only";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { MAX_NOTE_LENGTH, MAX_ROWS } from "@/lib/csv";
import type { AgentPolicy } from "./policy";
import {
  AgentError,
  authenticateAgent,
  createPayoutRequest,
  describeRequest,
  getBalance,
  getPayoutStatus,
  getPolicy,
  listPayouts,
  returnUnclaimed,
  sendReminders,
  waitForDecision,
  type AgentDeps,
} from "./service";
import type { AgentKeyRecord } from "./store";
import { bearerToken } from "./tokens";

/**
 * Fanout's MCP server: the tools an AI agent uses to pay people by email, under the platform's
 * signed policy. Served over Streamable HTTP at /api/mcp (app/api/mcp/route.ts), one fresh server
 * per request, authenticated by the agent key in the Authorization header.
 */

export const MCP_SERVER_NAME = "fanout";

const INSTRUCTIONS = `Fanout pays people in US dollars by email. Each person gets an email with a link to claim their money; they don't need a crypto wallet or an account first.
You act for one platform, under limits it signed (see get_policy). You can ask for payouts, but the platform approves every payout before money moves: create_payout returns an approval_url the platform opens. Within the limits it's a one-tap approval; over them the platform reviews it in full.
Amounts are always strings in US dollars with two decimals ("25.00"), never numbers.
Typical flow: get_policy and get_balance -> create_payout -> tell the user the approval_url -> get_payout_status until it's "sent" -> later send_reminders to people who haven't claimed, and after the claim window return_unclaimed.`;

type Result = Record<string, unknown>;

function ok(result: Result) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], structuredContent: result };
}

function fail(err: unknown) {
  const body: Result =
    err instanceof AgentError
      ? { error: err.message, code: err.code, ...err.details }
      : { error: err instanceof Error ? err.message : "Something went wrong. Try again.", code: "internal" };
  if (!(err instanceof AgentError)) console.error("[mcp]", err instanceof Error ? err.message : err);
  return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }], structuredContent: body, isError: true };
}

const run = (fn: () => Promise<Result>) => fn().then(ok, fail);

const payoutId = z
  .string()
  .min(1)
  .max(64)
  .describe('The payout_request_id from create_payout ("req_...") or the payout_id once it\'s sent ("42").');

export function createFanoutMcpServer(deps: AgentDeps, key: AgentKeyRecord, policy: AgentPolicy): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "create_payout",
    {
      title: "Pay people by email",
      description: `Asks to pay up to ${MAX_ROWS} people in one payout. Each person gets an email with a claim link once the platform approves.
Nothing is paid until the platform approves: the result has status "approval_needed" and an approval_url to give the user (the platform opens it and approves with one tap if the payout is within your limits, or reviews it if it's over). If you pass wait_for_approval_seconds and they approve in time, the result is the sent payout (status "sent", payout_id).
Rows are checked like a CSV upload: valid unique emails, amounts above 0.00, notes up to ${MAX_NOTE_LENGTH} characters. If any row is wrong nothing is created and the error lists each problem by row number.
Pass an idempotency_key when retrying so the same payout isn't requested twice.`,
      inputSchema: z.object({
        rows: z
          .array(
            z.object({
              email: z.string().describe("The person's email address. Their claim link goes there."),
              amount: z.string().describe('US dollars as a string with exactly two decimals, e.g. "25.00". Never a number.'),
              note: z.string().optional().describe(`Optional message shown in their email, up to ${MAX_NOTE_LENGTH} characters.`),
            }),
          )
          .min(1)
          .max(MAX_ROWS)
          .describe("One row per person. Each email at most once."),
        claim_window_days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("How many days the claim links work before unclaimed money can return to the balance. Default 30."),
        memo: z.string().max(280).optional().describe("Why you're paying, shown to the platform when it approves. Be specific."),
        idempotency_key: z.string().optional().describe("Any unique string (8-100 characters) for this payout. Reusing it returns the first request instead of a new one."),
        wait_for_approval_seconds: z
          .number()
          .int()
          .min(0)
          .max(50)
          .optional()
          .describe("Wait up to this many seconds for the platform to approve before answering. Default 0 (answer at once)."),
      }),
      annotations: { title: "Pay people by email", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) =>
      run(async () => {
        const created = await createPayoutRequest(deps, key, policy, args);
        if (!args.wait_for_approval_seconds || created.status !== "approval_needed") return created;
        const later = await waitForDecision(deps, created.payout_request_id, args.wait_for_approval_seconds);
        return later ? describeRequest(deps, later) : created;
      }),
  );

  server.registerTool(
    "get_payout_status",
    {
      title: "Check a payout",
      description:
        'Shows where a payout stands: "approval_needed" (with approval_url), "sent", "declined", "expired" or "cancelled". Once sent, it lists each person and whether they "claimed", are still "waiting", or their money was "returned".',
      inputSchema: z.object({ id: payoutId }),
      annotations: { title: "Check a payout", readOnlyHint: true, openWorldHint: false },
    },
    ({ id }) => run(() => getPayoutStatus(deps, key, id)),
  );

  server.registerTool(
    "list_payouts",
    {
      title: "List payouts",
      description: "Lists the payouts this agent asked for, newest first, with status, total and how many people claimed.",
      inputSchema: z.object({
        status: z.enum(["approval_needed", "sent", "declined", "expired", "cancelled"]).optional().describe("Only payouts with this status."),
        limit: z.number().int().min(1).max(50).optional().describe("How many to return. Default 20."),
      }),
      annotations: { title: "List payouts", readOnlyHint: true, openWorldHint: false },
    },
    (args) => run(() => listPayouts(deps, key, args)),
  );

  server.registerTool(
    "send_reminders",
    {
      title: "Remind people to claim",
      description:
        "Emails a reminder, with their claim link, to everyone in a sent payout who hasn't claimed yet. At most once a day per payout. People who already claimed aren't emailed.",
      inputSchema: z.object({ id: payoutId }),
      annotations: { title: "Remind people to claim", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ id }) => run(() => sendReminders(deps, key, policy, id)),
  );

  server.registerTool(
    "return_unclaimed",
    {
      title: "Return unclaimed money",
      description:
        "After a payout's claim window ends, puts the money nobody claimed back into the platform's payout balance. Before that it explains when it can. The money only ever goes back to the platform.",
      inputSchema: z.object({ id: payoutId }),
      annotations: { title: "Return unclaimed money", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ id }) => run(() => returnUnclaimed(deps, key, policy, id)),
  );

  server.registerTool(
    "get_balance",
    {
      title: "Payout balance",
      description: "How much is in the platform's payout balance (what approved payouts are paid from), and how much of your daily limit is left.",
      inputSchema: z.object({}),
      annotations: { title: "Payout balance", readOnlyHint: true, openWorldHint: false },
    },
    () => run(() => getBalance(deps, key, policy)),
  );

  server.registerTool(
    "get_policy",
    {
      title: "Your limits",
      description:
        "The limits the platform signed for you: per payout, per day, people per payout, who you may pay (allowlist), when your key expires, and whether it's paused. Payouts within them are one-tap approvals; payouts over them need a full review.",
      inputSchema: z.object({}),
      annotations: { title: "Your limits", readOnlyHint: true, openWorldHint: false },
    },
    () => run(() => getPolicy(deps, key, policy)),
  );

  return server;
}

type Bound = { deps: AgentDeps; key: AgentKeyRecord; policy: AgentPolicy };

// One handler for the process; each request's server is built from what serveMcp authenticated.
const handler = createMcpHandler((ctx) => {
  const bound = ctx.authInfo?.extra?.bound as Bound | undefined;
  if (!bound) throw new Error("Unauthenticated MCP request.");
  return createFanoutMcpServer(bound.deps, bound.key, bound.policy);
});

// Best-effort per-instance rate limit per key.
const hits = new Map<string, number[]>();
function limited(id: string, max = 60, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(id) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(id, recent);
  return recent.length > max;
}

function rpcError(status: number, code: number, message: string) {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status, headers: status === 401 ? { "WWW-Authenticate": 'Bearer realm="fanout", error="invalid_token"' } : {} },
  );
}

/** Authenticates the agent key in Authorization, then serves the MCP request (Streamable HTTP, stateless). */
export async function serveMcp(deps: AgentDeps, request: Request): Promise<Response> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return rpcError(401, -32001, "Send your Fanout agent key as Authorization: Bearer fo_agent_... (create one in Fanout > Agents).");
  try {
    const { key, policy } = await authenticateAgent(deps, token);
    if (limited(key.keyId)) return rpcError(429, -32001, "Too many requests. Wait a minute and try again.");
    return await handler.fetch(request, {
      authInfo: { token, clientId: key.keyId, scopes: ["payouts"], expiresAt: Number(policy.expiresAt), extra: { bound: { deps, key, policy } satisfies Bound } },
    });
  } catch (err) {
    if (err instanceof AgentError) return rpcError(err.code === "unauthorized" ? 401 : 403, -32001, err.message);
    console.error("[mcp]", err instanceof Error ? err.message : err);
    return rpcError(500, -32603, "Something went wrong. Try again.");
  }
}
