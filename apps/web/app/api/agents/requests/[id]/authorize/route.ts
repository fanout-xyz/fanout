import { agentDeps, agentErrorResponse, agentsUnavailableReason, platformSession } from "@/lib/agents/server";
import { prepareApproval } from "@/lib/agents/service";

/**
 * POST -> the CreateBatch for the platform to check and sign (fresh nonce, 10-minute deadline), with
 * the claim keys so its browser can check every claim signer and keep the links.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/agents/requests/[id]/authorize">) {
  const deps = agentDeps();
  if (!deps) return Response.json({ error: agentsUnavailableReason() }, { status: 503 });
  try {
    const { platform } = await platformSession(request);
    const { id } = await ctx.params;
    return Response.json(await prepareApproval(deps, platform, id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
