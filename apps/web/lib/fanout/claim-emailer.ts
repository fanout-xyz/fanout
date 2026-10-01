import "server-only";
import { createPublicClient, getAddress, http, isAddress, isHex, type Address, type Hex } from "viem";
import { privyClient, verifiedUser } from "@/lib/auth/privy-server";
import { activeChain } from "@/lib/chains";
import { config } from "@/lib/config";
import { MAX_ROWS } from "@/lib/csv";
import { claimEmail } from "@/lib/email/claim-email";
import { hashEmail } from "@/lib/email-hash";
import { claimEscrowAbi } from "./abis";
import { buildClaimLink, claimSignerFromKey } from "./claim-keys";
import { engine } from "./mock-engine";
import { getMockState } from "./mock-store";
import { need } from "./onchain-client";
import { siteOrigin } from "@/lib/site-url";

/**
 * Emails payees their claim links through Resend.
 *
 * The platform's browser holds the claim keys; it posts them here once, right after the payout,
 * and we pass each link straight to Resend. Nothing is stored or logged.
 *
 * So this can't be used to send phishing mail from our domain, every link is checked against the
 * chain before anything is sent: the claim must exist, still be unclaimed, belong to the signed-in
 * platform, and go to the exact email address the payout was made to (its onchain emailHash).
 * The link always points at our own origin, and the amount comes from the chain, not the request.
 *
 * Env (server only): RESEND_API_KEY; optional CLAIM_EMAIL_FROM (default "Fanout <pay@fanout.tech>",
 * the domain verified in Resend) and CLAIM_EMAIL_REPLY_TO. Links use siteOrigin() (lib/site-url.ts):
 * the live domain on Vercel; locally localhost, which a phone can't open, so use a tunnel.
 */

export type ClaimEmailRequest = { key: Hex; email: string; note?: string };
export type ClaimEmailResult = { sent: Address[]; failed: { claimSigner: Address; reason: string }[] };

/** Refusals whose message is safe to show the platform. */
export class EmailRefused extends Error {}

type ClaimRecord = { amount: bigint; platform: Address; status: "sent" | "claimed" | "refunded"; emailHash?: Hex; expiresAt?: number };

const DEFAULT_FROM = "Fanout <pay@fanout.tech>";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export function parseRequests(body: unknown): ClaimEmailRequest[] {
  const links = (body as { links?: unknown })?.links;
  if (!Array.isArray(links) || links.length === 0 || links.length > MAX_ROWS) throw new EmailRefused("Nothing to email.");
  return links.map((l) => {
    const { key, email, note } = (l ?? {}) as Record<string, unknown>;
    if (typeof key !== "string" || !isHex(key) || key.length !== 66) throw new EmailRefused("A claim link isn't valid.");
    if (typeof email !== "string" || email.length > 254) throw new EmailRefused("An email address isn't valid.");
    return { key, email, note: typeof note === "string" ? note : undefined };
  });
}

/** The platform accounts the caller has proven they control. */
async function callerAccounts(accessToken: string | null, mockAccount: unknown): Promise<Set<Address>> {
  if (config.useMock) {
    // Mock mode has no real sign-in to check; it's for local demos only.
    if (typeof mockAccount !== "string" || !isAddress(mockAccount)) throw new EmailRefused("Sign in to email links.");
    return new Set([getAddress(mockAccount)]);
  }
  const privy = privyClient();
  if (!privy) {
    console.error("[claim-email] PRIVY_APP_SECRET is not set");
    throw new EmailRefused("Emailing links isn't available right now.");
  }
  if (!accessToken) throw new EmailRefused("Sign in to email links.");
  return (await verifiedUser(privy, accessToken)).wallets;
}

async function readClaims(signers: Address[]): Promise<(ClaimRecord | null)[]> {
  if (config.useMock) {
    const state = getMockState();
    return signers.map((s) => {
      try {
        const info = engine.getClaim(state, s);
        const ref = state.claims[s.toLowerCase() as Address];
        const row = state.batches[ref.batchId].rows[ref.index];
        return { ...info, platform: getAddress(info.platform), emailHash: row.emailHash };
      } catch {
        return null;
      }
    });
  }
  const escrow = need(config.contracts.claimEscrow, "NEXT_PUBLIC_CLAIM_ESCROW_ADDRESS");
  const client = createPublicClient({ chain: activeChain, transport: http() });
  const results = await client.multicall({
    contracts: signers.map((s) => ({ address: escrow, abi: claimEscrowAbi, functionName: "claims", args: [s] }) as const),
  });
  const STATUS = ["sent", "claimed", "refunded"] as const;
  return results.map((r) => {
    if (r.status !== "success") return null;
    const [amount, platform, status, expiresAt, emailHash] = r.result as readonly [bigint, Address, number, bigint, Hex];
    if (amount === 0n) return null;
    return { amount, platform: getAddress(platform), status: STATUS[status] ?? "refunded", emailHash, expiresAt: Number(expiresAt) };
  });
}

type Outgoing = { claimSigner: Address; to: string; subject: string; text: string; html: string };

async function sendViaResend(emails: Outgoing[]): Promise<ClaimEmailResult> {
  const from = process.env.CLAIM_EMAIL_FROM || DEFAULT_FROM;
  const replyTo = process.env.CLAIM_EMAIL_REPLY_TO;
  const result: ClaimEmailResult = { sent: [], failed: [] };
  // Resend's batch endpoint takes up to 100 emails per call.
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(
        chunk.map((e) => ({ from, to: [e.to], subject: e.subject, text: e.text, html: e.html, ...(replyTo ? { reply_to: replyTo } : {}) })),
      ),
    }).catch(() => null);
    if (res?.ok) {
      result.sent.push(...chunk.map((e) => e.claimSigner));
    } else {
      // Log the status only: the request body holds claim links.
      console.error("[claim-email] Resend batch failed", res ? res.status : "network");
      result.failed.push(...chunk.map((e) => ({ claimSigner: e.claimSigner, reason: "The email service didn't accept it. Try again." })));
    }
  }
  return result;
}

export async function sendClaimEmails(input: {
  requests: ClaimEmailRequest[];
  accessToken: string | null;
  mockAccount?: unknown;
  reminder?: boolean;
}): Promise<ClaimEmailResult> {
  if (!emailConfigured()) {
    console.error("[claim-email] RESEND_API_KEY is not set");
    throw new EmailRefused("Emailing links isn't set up yet. Use Copy link instead.");
  }
  const mine = await callerAccounts(input.accessToken, input.mockAccount);
  const signers = input.requests.map((r) => claimSignerFromKey(r.key));
  const claims = await readClaims(signers);
  const origin = siteOrigin();

  const failed: ClaimEmailResult["failed"] = [];
  const outgoing: Outgoing[] = [];
  input.requests.forEach((req, i) => {
    const claimSigner = signers[i];
    const claim = claims[i];
    const refuse = (reason: string) => failed.push({ claimSigner, reason });
    if (!claim) return refuse("This payout doesn't exist.");
    if (!mine.has(claim.platform)) return refuse("This payout wasn't sent from your account.");
    if (claim.status !== "sent") return refuse(claim.status === "claimed" ? "Already claimed." : "Already returned to you.");
    if (!claim.emailHash || claim.emailHash !== hashEmail(req.email)) return refuse("The email doesn't match the one this payout was made to.");
    const link = buildClaimLink(origin, req.key);
    const { subject, text, html } = claimEmail({
      platformName: config.platformName,
      amount: claim.amount,
      link,
      note: req.note,
      expiresAt: claim.expiresAt,
      reminder: input.reminder,
    });
    outgoing.push({ claimSigner, to: req.email.trim(), subject, text, html });
  });

  const sent = outgoing.length ? await sendViaResend(outgoing) : { sent: [], failed: [] };
  return { sent: sent.sent, failed: [...failed, ...sent.failed] };
}
