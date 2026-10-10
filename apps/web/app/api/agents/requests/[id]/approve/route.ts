import { agentDeps, agentErrorResponse, agentsUnavailableReason, platformSession } from "@/lib/agents/server";
import { approveRequest } from "@/lib/agents/service";

// Submitting the payout waits for the transaction.
export const maxDuration = 60;

/** POST { signature } -> { batchId, txHash, emailed }. Submits createBatchFor with the platform's signature, then emails the links. */
export async function POST(request: Request, ctx: RouteContext<"/api/agents/requests/[id]/approve">) {
  const deps = agentDeps();
  if (!deps) return Response.json({ error: agentsUnavailableReason() }, { status: 503 });
  try {
    const { platform } = await platformSession(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { signature?: unknown };
    return Response.json(await approveRequest(deps, platform, id, body.signature));
  } catch (err) {
    return agentErrorResponse(err);
  }
}
