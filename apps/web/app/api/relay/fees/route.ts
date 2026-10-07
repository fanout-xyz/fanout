import { NextResponse } from "next/server";
import { SessionExpired } from "@/lib/auth/privy-server";
import { ClaimRefused, topUpForEmailPayment } from "@/lib/fanout/relayer";

// Best-effort per-instance rate limit; the relayer also allows one top-up per account per 5 minutes.
const hits = new Map<string, number[]>();
function limited(ip: string, max = 5, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

/** POST { address, amount } (amount in AUSD units) -> { toppedUp }. Fees for paying someone by email. */
export async function POST(request: Request) {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ error: "Too many tries. Wait a minute and try again." }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const result = await topUpForEmailPayment({
      address: body.address,
      amount: body.amount,
      accessToken: request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ClaimRefused || err instanceof SessionExpired) {
      return NextResponse.json({ error: err.message }, { status: err instanceof SessionExpired ? 401 : 400 });
    }
    console.error("[relay-fees]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't prepare the payment. Try again in a moment." }, { status: 500 });
  }
}
