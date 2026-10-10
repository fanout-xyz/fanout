import { agentDeps, agentErrorResponse, agentsUnavailableReason, platformSession } from "@/lib/agents/server";
import { createAgentKey } from "@/lib/agents/service";

/**
 * POST { policy, signature } -> { token, key }. The policy is signed by the platform's account
 * (lib/agents/policy.ts). The token is in this response only; Fanout keeps its hash.
 */
export async function POST(request: Request) {
  const deps = agentDeps();
  if (!deps) return Response.json({ error: agentsUnavailableReason() }, { status: 503 });
  try {
    const { platform, emailHash } = await platformSession(request);
    const body = (await request.json().catch(() => ({}))) as { policy?: unknown; signature?: unknown };
    return Response.json(await createAgentKey(deps, platform, body, emailHash), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
