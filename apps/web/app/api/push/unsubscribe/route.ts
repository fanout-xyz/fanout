import { NextResponse } from "next/server";
import { SessionExpired } from "@/lib/auth/privy-server";
import { pushConfig } from "@/lib/push/config";
import { PushRefused, sessionEmailHashes } from "@/lib/push/session";
import { pushStore } from "@/lib/push/store";

/**
 * POST { endpoint, mockEmail? } with the payee's session -> { ok: true }. Forgets this device for
 * the signed-in payee. (A device that unsubscribes in the browser without reaching here is
 * dropped on the next payout, when its push service answers 410.)
 */
export async function POST(request: Request) {
  const config = pushConfig();
  if (!config) return NextResponse.json({ ok: true });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const endpoint = body.endpoint;
  if (typeof endpoint !== "string" || endpoint.length > 1024) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  try {
    const hashes = await sessionEmailHashes(request, body);
    const store = pushStore(config);
    await Promise.all(hashes.map((h) => store.remove(h, endpoint)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PushRefused) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof SessionExpired) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error("[push] unsubscribe failed", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Couldn't turn off notifications. Try again." }, { status: 500 });
  }
}
