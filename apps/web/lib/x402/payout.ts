import { sha256, toBytes, type Address, type Hex } from "viem";
import { DEFAULT_CLAIM_WINDOW_SECONDS } from "@/lib/claim-window";
import { hashEmail } from "@/lib/email-hash";
import { buildClaimLink, generateClaimKey } from "@/lib/fanout/claim-keys";
import type { ClaimEmailRequest, ClaimEmailResult } from "@/lib/fanout/claim-emailer";
import type { Kv } from "@/lib/agents/kv";
import { checkAgentRows, toAmountString } from "@/lib/agents/rows";
import { feeCents, type X402Config } from "./config";
import type { Facilitator } from "./facilitator";
import {
  encodeHeader,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  parsePayment,
  PaymentInvalid,
  X402_VERSION,
  type PaymentRequired,
  type PaymentRequirements,
  type SettlementResponse,
} from "./protocol";

/**
 * POST /api/x402/payout: an agent with no Fanout account pays people by email, paying for it with
 * x402. The first request (no PAYMENT-SIGNATURE) gets a 402 with the price: the payout plus a small
 * fee, in USDC on Monad. The agent signs an ERC-3009 authorization for exactly that and retries; we
 * verify it, check we can pay the payout, settle it through the facilitator, then pay the rows from
 * the operator account's payout balance and email the claim links.
 *
 * Every request needs an Idempotency-Key. The same key with the same body returns the first result
 * and never charges twice; with a different body it's refused. If the payout fails after the payment
 * settled, the payment is sent back to the payer automatically; if even that fails, the key's record
 * says so (state "refund_due", with the payer and transaction) for a manual refund.
 */

export interface PayoutAccount {
  address: Address;
  /** Whether the operator's payout balance can cover `amount` (payout token base units). */
  canCover(amount: bigint): Promise<boolean>;
  /** Pays the rows from the operator's payout balance. `paid` is what the payer sent (the demo credits it first). */
  pay(rows: { claimSigner: Address; amount: bigint; emailHash: Hex }[], claimWindowSeconds: number, paid: bigint): Promise<{ batchId: string; txHash: Hex }>;
  /** Sends `amount` of the x402 asset back to `payer`. */
  refund(payer: Address, amount: bigint): Promise<Hex>;
}

export type X402Deps = {
  kv: Kv;
  cfg: X402Config;
  facilitator: Facilitator;
  account: PayoutAccount;
  /** Decimals of the payout token (AUSD). */
  decimals: number;
  /** Absolute URL of this endpoint (the x402 resource). */
  resourceUrl: string;
  origin: string;
  /** Emails claim links. Missing = email isn't set up (the demo then returns the links instead). */
  emailer?: (platform: Address, requests: ClaimEmailRequest[]) => Promise<ClaimEmailResult>;
  /** The local demo: no email needed, links come back in the response. */
  demo: boolean;
  now?: () => number;
};

type IdemRecord = {
  bodyHash: Hex;
  state: "processing" | "paid" | "done" | "refunded" | "refund_due";
  updatedAt: number;
  status?: number;
  result?: Record<string, unknown>;
  payment?: { payer: Address; transaction: Hex; amount: string };
};

const IDEM_TTL_SECONDS = 7 * 24 * 60 * 60;
/** A "processing" record older than this (no payment settled yet) is abandoned and can be retried. */
const STALE_PROCESSING_MS = 2 * 60 * 1000;
const IDEM_RE = /^[A-Za-z0-9._:-]{8,100}$/;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const idemKey = (k: string) => `x402:idem:${k}`;
export const x402BatchKey = (batchId: string) => `x402:batch:${batchId}`;

function centsOf(amount: bigint, decimals: number): bigint {
  return decimals >= 2 ? amount / 10n ** BigInt(decimals - 2) : amount * 10n ** BigInt(2 - decimals);
}
function unitsOf(cents: bigint, decimals: number): bigint {
  return decimals >= 2 ? cents * 10n ** BigInt(decimals - 2) : cents / 10n ** BigInt(2 - decimals);
}
const dollars = (cents: bigint) => toAmountString(cents, 2);

export function requirementsFor(deps: Pick<X402Deps, "cfg" | "account">, totalCents: bigint): PaymentRequirements {
  return {
    scheme: "exact",
    network: deps.cfg.network,
    amount: unitsOf(totalCents, deps.cfg.asset.decimals).toString(),
    asset: deps.cfg.asset.address,
    payTo: deps.account.address,
    maxTimeoutSeconds: 300,
    extra: { name: deps.cfg.asset.eip712.name, version: deps.cfg.asset.eip712.version },
  };
}

export async function handleX402Payout(deps: X402Deps, request: Request): Promise<Response> {
  const now = deps.now ?? Date.now;
  const idem = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!IDEM_RE.test(idem)) {
    return json(400, { error: "Send an Idempotency-Key header (8 to 100 letters, digits or . _ : -), the same one on the paid retry." });
  }

  let body: { rows?: unknown; claim_window_days?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: 'Send JSON: { "rows": [{ "email": "...", "amount": "25.00", "note": "..." }], "claim_window_days": 30 }.' });
  }
  const checked = checkAgentRows(body?.rows, deps.decimals, deps.cfg.maxRows);
  if (!checked.ok) return json(400, { error: checked.message, problems: checked.problems });
  const days = body.claim_window_days ?? DEFAULT_CLAIM_WINDOW_SECONDS / 86_400;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 90) {
    return json(400, { error: "claim_window_days must be a whole number from 1 to 90." });
  }

  const payoutCents = centsOf(checked.total, deps.decimals);
  if (payoutCents > deps.cfg.maxTotalCents) {
    return json(400, { error: `This endpoint pays up to $${dollars(deps.cfg.maxTotalCents)} per payout. Split it into smaller payouts.` });
  }
  const fee = feeCents(deps.cfg, payoutCents);
  const totalCents = payoutCents + fee;
  const requirements = requirementsFor(deps, totalCents);
  const quote = {
    payout_total: dollars(payoutCents),
    fee: dollars(fee),
    total: dollars(totalCents),
    currency: "USD",
    people: checked.rows.length,
    pay_with: `${deps.cfg.asset.symbol} on ${deps.cfg.network}`,
  };
  const bodyHash = sha256(
    toBytes(JSON.stringify({ rows: checked.rows.map((r) => [r.email, r.amount.toString(), r.note]), days })),
  );

  // A key we've seen: same body -> the same answer; different body -> refuse.
  const seen = await deps.kv.get<IdemRecord>(idemKey(idem));
  if (seen) {
    if (seen.bodyHash !== bodyHash) return json(409, { error: "This Idempotency-Key was used for a different payout. Use a new key for a new payout." });
    if (seen.result && seen.state !== "processing" && seen.state !== "paid") return json(seen.status ?? 200, { ...seen.result, replayed: true });
    if (seen.state === "paid") {
      return json(409, { error: "The payment for this key was received and the payout is being created. Ask again in a minute.", payment: seen.payment });
    }
  }

  const paymentHeader = request.headers.get(HEADER_PAYMENT_SIGNATURE);
  if (!paymentHeader) return paymentRequired(deps, requirements, quote);

  let payment;
  try {
    payment = parsePayment(paymentHeader, requirements, BigInt(Math.floor(now() / 1000)));
  } catch (err) {
    if (err instanceof PaymentInvalid) return paymentRequired(deps, requirements, quote, err.message);
    throw err;
  }

  // Can we deliver? Checked before taking any money.
  if (!deps.emailer && !deps.demo) return json(503, { error: "Email isn't set up on this server, so claim links can't be delivered. Nothing was charged." });
  if (!(await deps.account.canCover(checked.total))) {
    return json(503, { error: "Fanout can't take payouts this size right now. Nothing was charged; try a smaller payout or later." });
  }

  const fresh: IdemRecord = { bodyHash, state: "processing", updatedAt: now() };
  const locked = await deps.kv.set(idemKey(idem), fresh, { ex: IDEM_TTL_SECONDS, nx: true });
  if (!locked) {
    const current = await deps.kv.get<IdemRecord>(idemKey(idem));
    const stale = current?.state === "processing" && now() - current.updatedAt > STALE_PROCESSING_MS;
    if (!stale) return json(409, { error: "A request with this Idempotency-Key is in progress. Ask again in a minute." });
    await deps.kv.set(idemKey(idem), fresh, { ex: IDEM_TTL_SECONDS });
  }

  const verified = await deps.facilitator.verify(payment, requirements).catch(() => null);
  if (!verified?.isValid) {
    await deps.kv.del(idemKey(idem));
    return paymentRequired(deps, requirements, quote, `The payment didn't verify (${verified ? verified.invalidReason : "payment service unreachable"}). Nothing was charged.`);
  }
  const settled = await deps.facilitator.settle(payment, requirements).catch(() => null);
  if (!settled?.success) {
    await deps.kv.del(idemKey(idem));
    return paymentRequired(deps, requirements, quote, `The payment didn't go through (${settled ? settled.errorReason : "payment service unreachable"}). Nothing was charged.`);
  }
  const paid = { payer: settled.payer, transaction: settled.transaction, amount: requirements.amount };
  await deps.kv.set(idemKey(idem), { ...fresh, state: "paid", updatedAt: now(), payment: paid } satisfies IdemRecord, { ex: IDEM_TTL_SECONDS });
  const settlement: SettlementResponse = { success: true, payer: settled.payer, transaction: settled.transaction, network: settled.network, amount: requirements.amount };

  try {
    const keys = checked.rows.map(() => generateClaimKey());
    const claimWindowSeconds = days * 86_400;
    const { batchId, txHash } = await deps.account.pay(
      checked.rows.map((r, i) => ({ claimSigner: keys[i].claimSigner, amount: r.amount, emailHash: hashEmail(r.email) })),
      claimWindowSeconds,
      checked.total,
    );
    await deps.kv.set(x402BatchKey(batchId), { createdAt: now(), people: checked.rows.length }, { ex: IDEM_TTL_SECONDS + claimWindowSeconds });

    let emailed: { sent: number; failed: number } | undefined;
    if (deps.emailer) {
      const r = await deps.emailer(deps.account.address, checked.rows.map((row, i) => ({ key: keys[i].privateKey, email: row.email, note: row.note || undefined }))).catch(() => null);
      emailed = r ? { sent: r.sent.length, failed: r.failed.length } : { sent: 0, failed: checked.rows.length };
    }
    const result = {
      payout_id: batchId,
      status: "sent",
      ...quote,
      paid: dollars(totalCents),
      claim_window_days: days,
      claim_links_expire_at: new Date(now() + claimWindowSeconds * 1000).toISOString(),
      status_url: `${deps.origin}/api/x402/payout/${batchId}`,
      transaction: txHash,
      payment: { payer: settled.payer, transaction: settled.transaction, network: settled.network },
      ...(emailed ? { emailed } : {}),
      // The demo has no email: hand back the links so the flow can be tried end to end.
      ...(deps.demo && !deps.emailer ? { demo_claim_links: keys.map((k, i) => ({ email: checked.rows[i].email, link: buildClaimLink(deps.origin, k.privateKey) })) } : {}),
      message: emailed
        ? `Paid. ${emailed.sent} ${emailed.sent === 1 ? "person was" : "people were"} emailed a link to claim their money.`
        : "Paid. In this demo nothing is emailed; the claim links are in demo_claim_links.",
    };
    await deps.kv.set(idemKey(idem), { ...fresh, state: "done", updatedAt: now(), status: 200, result: stripLinks(result), payment: paid } satisfies IdemRecord, { ex: IDEM_TTL_SECONDS });
    return json(200, result, { [HEADER_PAYMENT_RESPONSE]: encodeHeader(settlement) });
  } catch (err) {
    console.error("[x402] payout failed after payment", err instanceof Error ? err.message : err);
    const refundTx = await deps.account.refund(settled.payer, BigInt(requirements.amount)).catch(() => null);
    const refund = refundTx ? { status: "refunded", transaction: refundTx } : { status: "pending", note: "We'll send it back; quote your Idempotency-Key if you contact us." };
    const result = {
      error: "Your payment went through but the payout couldn't be created. " + (refundTx ? "We sent the payment back." : "We'll send the payment back."),
      refund,
      payment: { payer: settled.payer, transaction: settled.transaction, network: settled.network },
    };
    await deps.kv.set(
      idemKey(idem),
      { ...fresh, state: refundTx ? "refunded" : "refund_due", updatedAt: now(), status: 502, result, payment: paid } satisfies IdemRecord,
      { ex: IDEM_TTL_SECONDS },
    );
    return json(502, result, { [HEADER_PAYMENT_RESPONSE]: encodeHeader(settlement) });
  }
}

/** Claim links are bearer credentials: a replayed answer never repeats them. */
function stripLinks(result: Record<string, unknown>) {
  const { demo_claim_links: _links, ...rest } = result;
  void _links;
  return rest;
}

function paymentRequired(deps: X402Deps, requirements: PaymentRequirements, quote: Record<string, unknown>, error = "Payment required") {
  const required: PaymentRequired = {
    x402Version: X402_VERSION,
    error,
    resource: {
      url: deps.resourceUrl,
      description: `Pay ${quote.people} ${quote.people === 1 ? "person" : "people"} by email: $${quote.payout_total} plus a $${quote.fee} fee.`,
      mimeType: "application/json",
    },
    accepts: [requirements],
  };
  return json(402, { ...required, quote }, { [HEADER_PAYMENT_REQUIRED]: encodeHeader(required) });
}
