import "server-only";
import { createPublicClient, getAddress, http, isAddress, isHex, verifyMessage, type Address, type Hex } from "viem";
import { privyClient, verifiedUser } from "@/lib/auth/privy-server";
import { activeChain } from "@/lib/chains";
import { config } from "@/lib/config";
import { MAX_ROWS } from "@/lib/csv";
import { claimEmail } from "@/lib/email/claim-email";
import { hashEmail } from "@/lib/email-hash";
import { DEFAULT_LANG, normalizeLanguage, type Lang } from "@/lib/i18n/languages";
import { notifyPaid, type PaidPayee } from "@/lib/push/sender";
import { claimEscrowAbi } from "./abis";
import { claimEmailProofMessage, type ClaimEmailProof } from "./claim-email-proof";
import { buildClaimLink, claimSignerFromKey } from "./claim-keys";
import { engine } from "./mock-engine";
import { getMockState } from "./mock-store";
import { need } from "./onchain-client";
import { walletOrigin } from "@/lib/site-url";

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
 * the domain verified in Resend) and CLAIM_EMAIL_REPLY_TO. Links use walletOrigin() (lib/site-url.ts):
 * wallet.fanout.tech when live; locally localhost, which a phone can't open, so use a tunnel.
 *
 * Payees who turned on notifications also get a "You've been paid" push once their email is out
 * (lib/push/sender.ts). It runs after the response and can't change or fail the emails.
 */

export type ClaimEmailRequest = { key: Hex; email: string; note?: string; language?: Lang };
export type ClaimEmailResult = { sent: Address[]; failed: { claimSigner: Address; reason: string }[] };

/** Refusals whose message is safe to show the platform. */
export class EmailRefused extends Error {}

/** Opens the claim page in the payee's language: /claim?lang=es#k=... (the key stays in the fragment). */
export function withLanguage(link: string, language: Lang | undefined): string {
  if (!language || language === DEFAULT_LANG) return link;
  const hash = link.indexOf("#");
  const [base, fragment] = hash === -1 ? [link, ""] : [link.slice(0, hash), link.slice(hash)];
  return `${base}${base.includes("?") ? "&" : "?"}lang=${language}${fragment}`;
}

type ClaimRecord = { amount: bigint; platform: Address; status: "sent" | "claimed" | "refunded"; emailHash?: Hex; expiresAt?: number };

const DEFAULT_FROM = "Fanout <pay@fanout.tech>";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export function parseRequests(body: unknown): ClaimEmailRequest[] {
  const links = (body as { links?: unknown })?.links;
  if (!Array.isArray(links) || links.length === 0 || links.length > MAX_ROWS) throw new EmailRefused("Nothing to email.");
  return links.map((l) => {
    const { key, email, note, language } = (l ?? {}) as Record<string, unknown>;
    if (typeof key !== "string" || !isHex(key) || key.length !== 66) throw new EmailRefused("A claim link isn't valid.");
    if (typeof email !== "string" || email.length > 254) throw new EmailRefused("An email address isn't valid.");
    const lang = typeof language === "string" ? normalizeLanguage(language) : null;
    return { key, email, note: typeof note === "string" ? note : undefined, ...(lang ? { language: lang } : {}) };
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

type Outgoing = { claimSigner: Address; to: string; subject: string; text: string; html: string; paid: PaidPayee };

/** Resend's batch endpoint takes up to 100 emails per call. */
const RESEND_BATCH_SIZE = 100;
/** Retries after a 429 rate limit (not a quota), waiting what Resend's retry-after asks, capped. */
const RATE_LIMIT_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postBatch(body: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body,
    }).catch(() => null);
    if (res?.ok) return { ok: true };
    // Log the status and error name only: the request body holds claim links.
    const name = res ? (((await res.json().catch(() => ({}))) as { name?: unknown }).name ?? "") : "network";
    console.error("[claim-email] Resend batch failed", res ? res.status : "network", name);
    if (res?.status === 429 && typeof name === "string" && name.includes("quota")) {
      return { ok: false, reason: "The daily email limit is reached. Copy the link instead, or email it again tomorrow." };
    }
    if (res?.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000, MAX_RETRY_WAIT_MS));
      continue;
    }
    return { ok: false, reason: "The email service didn't accept it. Try again." };
  }
}

async function sendViaResend(emails: Outgoing[]): Promise<ClaimEmailResult> {
  const from = process.env.CLAIM_EMAIL_FROM || DEFAULT_FROM;
  const replyTo = process.env.CLAIM_EMAIL_REPLY_TO;
  const result: ClaimEmailResult = { sent: [], failed: [] };
  // A full payout (MAX_ROWS = 150) is two calls, well under Resend's default 10 requests a second.
  for (let i = 0; i < emails.length; i += RESEND_BATCH_SIZE) {
    const chunk = emails.slice(i, i + RESEND_BATCH_SIZE);
    const sent = await postBatch(
      JSON.stringify(
        chunk.map((e) => ({ from, to: [e.to], subject: e.subject, text: e.text, html: e.html, ...(replyTo ? { reply_to: replyTo } : {}) })),
      ),
    );
    if (sent.ok) result.sent.push(...chunk.map((e) => e.claimSigner));
    else result.failed.push(...chunk.map((e) => ({ claimSigner: e.claimSigner, reason: sent.reason })));
  }
  return result;
}

export async function sendClaimEmails(input: {
  requests: ClaimEmailRequest[];
  accessToken: string | null;
  mockAccount?: unknown;
  reminder?: boolean;
  /** A payee's passkey account paying by email signs for its own payouts (claim-email-proof.ts). */
  proof?: ClaimEmailProof;
  /**
   * Runs the "You've been paid" pushes once the emails are out, without holding up the response
   * (the route passes Next's `after`). They never change what this returns.
   */
  schedule?: (task: () => Promise<void>) => void;
}): Promise<ClaimEmailResult> {
  if (!emailConfigured()) {
    console.error("[claim-email] RESEND_API_KEY is not set");
    throw new EmailRefused("Emailing links isn't set up yet. Use Copy link instead.");
  }
  const mine = await callerAccounts(input.accessToken, input.mockAccount);
  const signers = input.requests.map((r) => claimSignerFromKey(r.key));
  if (input.proof) {
    const valid = await verifyMessage({
      address: input.proof.address,
      message: claimEmailProofMessage(input.proof.address, signers),
      signature: input.proof.signature,
    }).catch(() => false);
    if (!valid) throw new EmailRefused("Couldn't confirm these payments are yours.");
    mine.add(input.proof.address);
  }
  const claims = await readClaims(signers);
  const origin = walletOrigin();

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
    const link = withLanguage(buildClaimLink(origin, req.key), req.language);
    const { subject, text, html } = claimEmail({
      platformName: config.platformName,
      amount: claim.amount,
      link,
      balanceUrl: origin,
      note: req.note,
      expiresAt: claim.expiresAt,
      reminder: input.reminder,
      language: req.language,
    });
    outgoing.push({ claimSigner, to: req.email.trim(), subject, text, html, paid: { emailHash: claim.emailHash, amount: claim.amount } });
  });

  const sent = outgoing.length ? await sendViaResend(outgoing) : { sent: [], failed: [] };

  // Payees whose email went out also get a push on any device they turned notifications on for.
  // Reminders don't: the payment isn't new.
  if (!input.reminder && sent.sent.length) {
    const emailed = new Set(sent.sent);
    const paid = outgoing.filter((o) => emailed.has(o.claimSigner)).map((o) => o.paid);
    const task = () => notifyPaid(paid, config.platformName).catch(() => {});
    if (input.schedule) input.schedule(task);
    else void task();
  }
  return { sent: sent.sent, failed: [...failed, ...sent.failed] };
}
