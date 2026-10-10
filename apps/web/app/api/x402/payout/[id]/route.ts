import { config } from "@/lib/config";
import { mockLedger } from "@/lib/agents/ledger";
import { onchainLedger } from "@/lib/agents/onchain-ledger";
import { toAmountString } from "@/lib/agents/rows";
import { x402BatchKey } from "@/lib/x402/payout";
import { x402Deps } from "@/lib/x402/server";

/**
 * GET -> where a payout made over x402 stands: how many people claimed, are waiting, or had their
 * money returned. No emails: only the payer's agent should know who was paid.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/x402/payout/[id]">) {
  const wired = x402Deps();
  if ("unavailable" in wired) return Response.json({ error: wired.unavailable }, { status: 503 });
  const { id } = await ctx.params;
  const known = /^\d+$/.test(id) ? await wired.deps.kv.get(x402BatchKey(id)) : null;
  if (!known) return Response.json({ error: "No payout with that id was made here." }, { status: 404 });
  try {
    const batch = await (config.useMock ? mockLedger() : onchainLedger()).getBatch(id);
    const count = (s: string) => batch.rows.filter((r) => r.status === s).length;
    return Response.json({
      payout_id: id,
      total: toAmountString(batch.total, wired.deps.decimals),
      currency: "USD",
      people: batch.rows.length,
      claims: { claimed: count("claimed"), waiting: count("sent"), returned: count("refunded") },
      claim_links_expire_at: batch.expiresAt ? new Date(batch.expiresAt).toISOString() : undefined,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't read the payout." }, { status: 502 });
  }
}
