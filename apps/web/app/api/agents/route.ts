import { agentDeps, agentErrorResponse, agentsUnavailableReason, platformSession } from "@/lib/agents/server";
import { agentOverview } from "@/lib/agents/service";

/** GET -> { available, keys, requests, activity } for the signed-in platform (Agents page). */
export async function GET(request: Request) {
  const deps = agentDeps();
  if (!deps) return Response.json({ available: false, reason: agentsUnavailableReason(), keys: [], requests: [], activity: [] });
  try {
    const { platform } = await platformSession(request);
    return Response.json({ available: true, ...(await agentOverview(deps, platform)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
