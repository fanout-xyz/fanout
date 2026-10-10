import { serveMcp } from "@/lib/agents/mcp";
import { agentDeps, agentsUnavailableReason } from "@/lib/agents/server";

/**
 * Fanout's MCP server over Streamable HTTP (lib/agents/mcp.ts). Stateless: every request carries
 * the agent key (Authorization: Bearer fo_agent_...) and gets a fresh server bound to that key.
 */

// create_payout can wait up to 50 seconds for an approval.
export const maxDuration = 60;

async function serve(request: Request): Promise<Response> {
  const deps = agentDeps(request.url);
  if (!deps) return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: agentsUnavailableReason() }, id: null }, { status: 503 });
  return serveMcp(deps, request);
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
