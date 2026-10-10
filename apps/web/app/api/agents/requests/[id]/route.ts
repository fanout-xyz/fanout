import { agentDeps, agentErrorResponse, agentsUnavailableReason, platformSession } from "@/lib/agents/server";
import { approvalDetails } from "@/lib/agents/service";

/** GET -> an agent's payout request with its rows and today's policy checks, for the approval page. */
export async function GET(request: Request, ctx: RouteContext<"/api/agents/requests/[id]">) {
  const deps = agentDeps();
  if (!deps) return Response.json({ error: agentsUnavailableReason() }, { status: 503 });
  try {
    const { platform } = await platformSession(request);
    const { id } = await ctx.params;
    return Response.json(await approvalDetails(deps, platform, id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
