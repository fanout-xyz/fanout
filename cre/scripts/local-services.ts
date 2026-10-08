/**
 * Local stand-ins for the two HTTP sources the workflows read, for the fork simulation:
 *   POST /graphql        answers the refund workflow's ExpiredClaims query (shared/fanout.ts) the way
 *                        the Envio indexer would, from the fork's own state: claims fork-setup.ts
 *                        created, filtered by the query variables and their live onchain status.
 *   GET  /schedule.json  the scheduled payouts fork-setup.ts signed.
 * The real indexer can't see the fork, so this keeps the simulation self-contained.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";

import { ESCROW_ABI, LOCAL_DIR, SERVICES_PORT, V3, publicClient, type LocalState } from "./local-chain.ts";

const state = (): LocalState => JSON.parse(readFileSync(join(LOCAL_DIR, "state.json"), "utf8"));

async function expiredClaims(variables: { cutoff: number; batchPayout: string; limit: number }) {
  const rows = [];
  for (const c of state().claims) {
    if (getAddress(c.batchPayout) !== getAddress(variables.batchPayout) || c.expiresAt > variables.cutoff) continue;
    const [, , status] = await publicClient.readContract({ address: V3.claimEscrow, abi: ESCROW_ABI, functionName: "claims", args: [c.id] });
    if (status === 0) rows.push({ id: c.id.toLowerCase(), batch_id: c.batch_id, expiresAt: c.expiresAt });
  }
  rows.sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id));
  return rows.slice(0, variables.limit);
}

Bun.serve({
  hostname: "127.0.0.1",
  port: SERVICES_PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/graphql") {
      const { query, variables } = (await req.json()) as { query: string; variables: { cutoff: number; batchPayout: string; limit: number } };
      if (!query.includes("ExpiredClaims")) return Response.json({ errors: [{ message: "only the ExpiredClaims query is served here" }] });
      return Response.json({ data: { Claim: await expiredClaims(variables) } });
    }
    if (req.method === "GET" && url.pathname === "/schedule.json") {
      return new Response(readFileSync(join(LOCAL_DIR, "schedule.json")), { headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`Indexer and schedule stand-ins on http://127.0.0.1:${SERVICES_PORT}`);
