import { NextResponse } from "next/server";
import { SessionExpired } from "@/lib/auth/privy-server";
import { EmailRefused, parseRequests, sendClaimEmails } from "@/lib/fanout/claim-emailer";

// Best-effort per-instance rate limit: each call can send up to MAX_ROWS emails.
const hits = new Map<string, number[]>();
function limited(ip: string, max = 5, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

/** POST { links: [{ key, email, note? }], reminder?, account? } -> { sent: Address[], failed: [{ claimSigner, reason }] } */
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
    const result = await sendClaimEmails({
      requests: parseRequests(body),
      accessToken: request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
      mockAccount: body.account,
      reminder: body.reminder === true,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EmailRefused || err instanceof SessionExpired) {
      return NextResponse.json({ error: err.message }, { status: err instanceof SessionExpired ? 401 : 400 });
    }
    console.error("[claim-email]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't email the links. Try again, or copy them from the payout page." }, { status: 500 });
  }
}
