"use client";

import type { Address, Hex } from "viem";
import type { Lang } from "@/lib/i18n/languages";
import type { ClaimEmailProof } from "./claim-email-proof";
import { markEmailed } from "./claim-link-store";

export type EmailLinksResult = { sent: Address[]; failed: { claimSigner: Address; reason: string }[] };

/**
 * Asks the server to email each payee their claim link (see lib/fanout/claim-emailer.ts for the
 * checks it runs). Never throws: a failed email must not look like a failed payout.
 */
export async function emailClaimLinks(
  links: { key: Hex; email: string; note?: string; language?: Lang; claimSigner: Address }[],
  auth: { accessToken?: string | null; account?: Address; proof?: ClaimEmailProof },
  opts: { reminder?: boolean } = {},
): Promise<EmailLinksResult | { error: string }> {
  try {
    const res = await fetch("/api/claims/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth.accessToken ? { authorization: `Bearer ${auth.accessToken}` } : {}) },
      body: JSON.stringify({ links: links.map(({ key, email, note, language }) => ({ key, email, note, language })), reminder: opts.reminder, account: auth.account, proof: auth.proof }),
    });
    const body = (await res.json().catch(() => ({}))) as Partial<EmailLinksResult> & { error?: string };
    if (!res.ok || !body.sent) return { error: body.error ?? "Couldn't email the links." };
    markEmailed(body.sent);
    return { sent: body.sent, failed: body.failed ?? [] };
  } catch {
    return { error: "Couldn't reach the server to email the links." };
  }
}
