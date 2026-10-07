import "server-only";
import type { Hex } from "viem";
import { privyClient, verifiedUser } from "@/lib/auth/privy-server";
import { config } from "@/lib/config";
import { hashEmail } from "@/lib/email-hash";

export class PushRefused extends Error {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The email hashes a push subscription is filed under: every email Privy has verified for the
 * signed-in user. The email always comes from the session, never from the request body.
 *
 * The local demo (mock sign-in, no Privy) has no session to check, so it takes the demo email the
 * browser signed in with, the same way the mock claim-email route takes the demo account.
 */
export async function sessionEmailHashes(request: Request, body: Record<string, unknown>): Promise<Hex[]> {
  const privy = privyClient();
  if (privy) {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) throw new PushRefused("Sign in to turn on notifications.");
    const hashes = [...(await verifiedUser(privy, token)).emailHashes];
    if (!hashes.length) throw new PushRefused("Sign in with your email to turn on notifications.");
    return hashes;
  }
  if (config.useMock && !config.privyAppId) {
    const email = body.mockEmail;
    if (typeof email !== "string" || email.length > 254 || !EMAIL_RE.test(email.trim())) throw new PushRefused("Sign in to turn on notifications.");
    return [hashEmail(email)];
  }
  throw new PushRefused("Notifications aren't available right now.");
}
