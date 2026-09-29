import { NextResponse } from "next/server";
import { ClaimRefused, relayClaim } from "@/lib/fanout/relayer";
import { NotFoundError } from "@/lib/fanout/types";

// Best-effort per-instance rate limit: claims are cheap to verify but cost the relayer gas.
const hits = new Map<string, number[]>();
function limited(ip: string, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

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
    const { txHash, amount, toppedUp } = await relayClaim({
      claimSigner: body.claimSigner,
      recipient: body.recipient,
      signature: body.signature,
      // The claimer's Privy session: the relayer checks their verified email before co-signing.
      accessToken: request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
    });
    return NextResponse.json({ txHash, amount: amount.toString(), toppedUp });
  } catch (err) {
    const notFound = err instanceof NotFoundError;
    const message = err instanceof Error ? err.message : "Something went wrong and nothing was claimed.";
    return NextResponse.json({ error: message, notFound }, { status: notFound ? 404 : err instanceof ClaimRefused ? 403 : 400 });
  }
}
