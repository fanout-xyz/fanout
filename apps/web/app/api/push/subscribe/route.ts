import { NextResponse } from "next/server";
import { SessionExpired } from "@/lib/auth/privy-server";
import { pushConfig } from "@/lib/push/config";
import { PushRefused, sessionEmailHashes } from "@/lib/push/session";
import { parseSubscription, pushStore } from "@/lib/push/store";

// Best-effort per-instance rate limit.
const hits = new Map<string, number[]>();
function limited(ip: string, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

/** GET -> { enabled }: whether "You've been paid" notifications are set up on this deployment. */
export function GET() {
  return NextResponse.json({ enabled: pushConfig() !== null });
}

/**
 * POST { subscription, mockEmail? } with the payee's session (Authorization: Bearer <Privy token>)
 * -> { ok: true }. Files this device under the signed-in payee's verified email(s).
 */
export async function POST(request: Request) {
  const config = pushConfig();
  if (!config) return NextResponse.json({ error: "Notifications aren't available right now." }, { status: 404 });
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ error: "Too many tries. Wait a minute and try again." }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const subscription = parseSubscription(body.subscription);
  if (!subscription) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  try {
    const hashes = await sessionEmailHashes(request, body);
    const store = pushStore(config);
    await Promise.all(hashes.map((h) => store.add(h, subscription)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PushRefused) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof SessionExpired) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error("[push] subscribe failed", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Couldn't turn on notifications. Try again." }, { status: 500 });
  }
}
