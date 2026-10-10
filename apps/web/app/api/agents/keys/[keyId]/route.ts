import { agentDeps, agentErrorResponse, agentsUnavailableReason, platformSession } from "@/lib/agents/server";
import { revokeAgentKey, setAgentPaused, updateAgentPolicy } from "@/lib/agents/service";

/** PATCH { paused: boolean } (the kill switch) or { policy, signature } (a re-signed policy) -> { key }. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/agents/keys/[keyId]">) {
  const deps = agentDeps();
  if (!deps) return Response.json({ error: agentsUnavailableReason() }, { status: 503 });
  try {
    const { platform } = await platformSession(request);
    const { keyId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { paused?: unknown; policy?: unknown; signature?: unknown };
    if (typeof body.paused === "boolean") return Response.json({ key: await setAgentPaused(deps, platform, keyId, body.paused) });
    return Response.json({ key: await updateAgentPolicy(deps, platform, keyId, body) });
  } catch (err) {
    return agentErrorResponse(err);
  }
}

/** DELETE -> { key }, revoked: its token stops working at once and requests waiting for approval are cancelled. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/agents/keys/[keyId]">) {
  const deps = agentDeps();
  if (!deps) return Response.json({ error: agentsUnavailableReason() }, { status: 503 });
  try {
    const { platform } = await platformSession(request);
    const { keyId } = await ctx.params;
    return Response.json({ key: await revokeAgentKey(deps, platform, keyId) });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
