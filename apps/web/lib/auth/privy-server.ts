import "server-only";
import { PrivyClient } from "@privy-io/node";
import { getAddress, type Address, type Hex } from "viem";
import { config } from "@/lib/config";
import { hashEmail } from "@/lib/email-hash";

let privy: PrivyClient | null = null;
export function privyClient(): PrivyClient | null {
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!config.privyAppId || !appSecret) return null;
  return (privy ??= new PrivyClient({ appId: config.privyAppId, appSecret }));
}

/** Thrown when the access token is missing, expired or forged. */
export class SessionExpired extends Error {}

export type VerifiedUser = {
  /** Hashes of the emails Privy has verified for this user. */
  emailHashes: Set<Hex>;
  /** The user's Ethereum wallet addresses (their embedded wallet is their platform account). */
  wallets: Set<Address>;
};

export async function verifiedUser(client: PrivyClient, accessToken: string): Promise<VerifiedUser> {
  let userId: string;
  try {
    ({ user_id: userId } = await client.utils().auth().verifyAccessToken(accessToken));
  } catch {
    throw new SessionExpired("Your session has expired. Sign in again.");
  }
  const user = await client.users()._get(userId);
  const emailHashes = new Set<Hex>();
  const wallets = new Set<Address>();
  for (const a of user.linked_accounts) {
    if (a.type === "email" && a.verified_at) emailHashes.add(hashEmail(a.address));
    if (a.type === "wallet" && "chain_type" in a && a.chain_type === "ethereum") wallets.add(getAddress(a.address));
  }
  return { emailHashes, wallets };
}
