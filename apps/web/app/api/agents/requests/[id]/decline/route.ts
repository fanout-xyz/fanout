import { agentDeps, agentErrorResponse, agentsUnavailableReason, platformSession } from "@/lib/agents/server";
import { declineRequest } from "@/lib/agents/service";

/** POST -> { status: "declined" }. Nothing is sent; the agent sees "declined". */
export async function POST(request: Request, ctx: RouteContext<"/api/agents/requests/[id]/decline">) {
  const deps = agentDeps();
  if (!deps) return Response.json({ error: agentsUnavailableReason() }, { status: 503 });
  try {
    const { platform } = await platformSession(request);
    const { id } = await ctx.params;
    return Response.json(await declineRequest(deps, platform, id));
  } catch (err) {
    return agentErrorResponse(err);
  }
}
