import "server-only";
import { getAddress, isHex, verifyTypedData, type Address, type Hex } from "viem";
import { DEFAULT_CLAIM_WINDOW_SECONDS } from "@/lib/claim-window";
import { hashEmail } from "@/lib/email-hash";
import { createBatchTypedData } from "@/lib/fanout/batch-authorization";
import { claimSignerFromKey, generateClaimKey } from "@/lib/fanout/claim-keys";
import type { ClaimEmailRequest, ClaimEmailResult } from "@/lib/fanout/claim-emailer";
import { randomNonce } from "@/lib/fanout/erc3009";
import { formatUsd } from "@/lib/money";
import type { Ledger, LedgerBatch } from "./ledger";
import {
  agentPolicyTypedData,
  keyBlocked,
  parsePolicy,
  PolicyInvalid,
  policyBreaches,
  policyToJson,
  type AgentPolicy,
  type PolicyBreach,
} from "./policy";
import { checkAgentRows, toAmountString, type RowProblem } from "./rows";
import { seal, unseal } from "./seal";
import type { AgentActivity, AgentKeyRecord, AgentStore, PayoutRequestRecord } from "./store";
import { generateAgentToken, hashAgentToken, randomId, tokenHint } from "./tokens";

/**
 * Payouts by AI agents, with the platform in control.
 *
 * An agent never signs anything that moves money. It asks (create_payout); Fanout validates the
 * rows, makes the claim keys, checks the request against the platform's signed policy and files an
 * approval request. The platform opens the approval link, reviews the rows and signs the payout's
 * EIP-712 CreateBatch with its own account; only then does the relayer submit
 * BatchPayout.createBatchFor, which checks that signature onchain. Requests within the policy are a
 * one-tap approval; requests over it are flagged with the reasons. A paused, revoked or expired key
 * can't ask at all.
 *
 * Why not let requests within the policy go through on their own? CreateBatch commits to each
 * row's claim signer and amount, and createBatchFor needs the platform's signature over exactly
 * those, so a pool of signatures made in advance (like a CRE schedule) only works for payouts known
 * in advance. Anything else would mean Fanout holding a key that can spend the platform's balance,
 * which this design avoids.
 */

export type AgentDeps = {
  store: AgentStore;
  ledger: Ledger;
  /** AGENT_SECRET: encrypts stored claim keys (lib/agents/seal.ts). */
  secret: string;
  /** Public origin for approval links ("https://fanout.tech"). */
  origin: string;
  decimals: number;
  now?: () => number;
  /** Emails claim links. Missing = email isn't set up on this server. */
  emailer?: { send(platform: Address, requests: ClaimEmailRequest[], reminder: boolean): Promise<ClaimEmailResult> };
  /** Tells the platform an approval is waiting (push). Best effort. */
  notify?: (key: AgentKeyRecord, request: PayoutRequestRecord) => Promise<void>;
};

export type AgentErrorCode = "unauthorized" | "key_blocked" | "invalid_input" | "not_found" | "not_ready" | "unavailable" | "conflict" | "forbidden";

/** A refusal whose message is written for whoever asked (agent or platform) and safe to show. */
export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly details?: { problems?: RowProblem[]; [k: string]: unknown },
  ) {
    super(message);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** An approval request the platform hasn't acted on lapses after this. */
export const APPROVAL_TTL_MS = 7 * DAY_MS;
/** How long the platform has to sign once it opens an approval (like the CreateBatch deadline elsewhere). */
const APPROVAL_SIGN_SECONDS = 10n * 60n;
const REMINDER_GAP_MS = DAY_MS;
const MAX_MEMO = 280;

const nowMs = (deps: AgentDeps) => (deps.now ?? Date.now)();
const nowSec = (deps: AgentDeps) => BigInt(Math.floor(nowMs(deps) / 1000));
const usd = (deps: AgentDeps) => (amount: bigint) => formatUsd(amount, deps.decimals);
const amountStr = (deps: AgentDeps, amount: bigint | string) => toAmountString(BigInt(amount), deps.decimals);
const iso = (ms: number) => new Date(ms).toISOString();

export function approvalUrl(deps: AgentDeps, id: string): string {
  return `${deps.origin}/dashboard/agents/approvals/${id}`;
}

function loadPolicy(key: AgentKeyRecord): AgentPolicy {
  return parsePolicy(key.policy, null);
}

// --- Agent side --------------------------------------------------------------------------------

/** Finds the key for a bearer token and re-checks the platform's signature on its policy. */
export async function authenticateAgent(deps: AgentDeps, token: string): Promise<{ key: AgentKeyRecord; policy: AgentPolicy }> {
  const key = await deps.store.keyByTokenHash(hashAgentToken(token));
  if (!key || key.revokedAt) throw new AgentError("unauthorized", "This agent key isn't valid. Ask the platform for a new one in Fanout > Agents.");
  let policy: AgentPolicy;
  try {
    policy = loadPolicy(key);
  } catch {
    throw new AgentError("unauthorized", "This agent key's policy can't be read. Ask the platform to sign it again.");
  }
  const typedData = agentPolicyTypedData(deps.ledger.chainId, policy);
  const valid =
    (await verifyTypedData({ address: policy.platform, signature: key.signature, ...typedData }).catch(() => false)) ||
    (await deps.ledger.verifySignature(policy.platform, typedData, key.signature));
  if (!valid || getAddress(policy.platform) !== getAddress(key.platform) || policy.keyId !== key.keyId) {
    throw new AgentError("unauthorized", "This agent key's policy isn't signed by the platform. Ask them to sign it again.");
  }
  const now = nowMs(deps);
  if (!key.lastUsedAt || now - key.lastUsedAt > 60_000) await deps.store.putKey({ ...key, lastUsedAt: now });
  return { key, policy };
}

function assertUsable(deps: AgentDeps, key: AgentKeyRecord, policy: AgentPolicy) {
  const blocked = keyBlocked(key, policy, nowSec(deps));
  if (blocked) throw new AgentError("key_blocked", blocked);
}

async function requestsOfKey(deps: AgentDeps, key: AgentKeyRecord): Promise<PayoutRequestRecord[]> {
  const all = await deps.store.listRequests(key.platform);
  return Promise.all(all.filter((r) => r.keyId === key.keyId).map((r) => lapse(deps, r)));
}

/** Money this key has sent or is waiting to send in the last 24 hours. */
async function spentLast24h(deps: AgentDeps, key: AgentKeyRecord, exceptId?: string): Promise<bigint> {
  const since = nowMs(deps) - DAY_MS;
  return (await requestsOfKey(deps, key))
    .filter((r) => r.id !== exceptId && (r.status === "sent" || r.status === "pending_approval") && (r.decidedAt ?? r.createdAt) > since)
    .reduce((sum, r) => sum + BigInt(r.total), 0n);
}

/** Marks a request that waited too long for approval as expired. */
async function lapse(deps: AgentDeps, r: PayoutRequestRecord): Promise<PayoutRequestRecord> {
  if (r.status !== "pending_approval" || nowMs(deps) < r.approveBy) return r;
  const expired = { ...r, status: "expired" as const, decidedAt: r.approveBy };
  await deps.store.putRequest(expired);
  return expired;
}

export type CreatePayoutInput = {
  rows: unknown;
  claim_window_days?: number;
  memo?: string;
  idempotency_key?: string;
};

export async function createPayoutRequest(deps: AgentDeps, key: AgentKeyRecord, policy: AgentPolicy, input: CreatePayoutInput) {
  assertUsable(deps, key, policy);

  const idem = input.idempotency_key?.trim();
  if (idem !== undefined && !/^[A-Za-z0-9._:-]{8,100}$/.test(idem)) {
    throw new AgentError("invalid_input", "idempotency_key must be 8 to 100 letters, digits or . _ : -");
  }
  if (idem) {
    const existing = await deps.store.idempotentRequest(key.keyId, idem);
    if (existing) {
      const r = await deps.store.getRequest(existing);
      if (r) return { ...(await describeRequest(deps, r)), replayed: true };
    }
  }

  const checked = checkAgentRows(input.rows, deps.decimals);
  if (!checked.ok) throw new AgentError("invalid_input", checked.message, { problems: checked.problems });

  const days = input.claim_window_days ?? DEFAULT_CLAIM_WINDOW_SECONDS / 86_400;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new AgentError("invalid_input", "claim_window_days must be a whole number from 1 to 90.");
  const memo = (input.memo ?? "").trim();
  if (memo.length > MAX_MEMO) throw new AgentError("invalid_input", `Keep memo under ${MAX_MEMO} characters.`);

  const breaches = policyBreaches(
    policy,
    { total: checked.total, emails: checked.rows.map((r) => r.email), spentLast24h: await spentLast24h(deps, key) },
    usd(deps),
  );
  const keys = checked.rows.map(() => generateClaimKey());
  const now = nowMs(deps);
  const record: PayoutRequestRecord = {
    id: randomId("req_"),
    keyId: key.keyId,
    platform: key.platform,
    agentLabel: policy.label,
    rows: checked.rows.map((r) => ({ email: r.email, amount: r.amount.toString(), note: r.note })),
    total: checked.total.toString(),
    claimWindowSeconds: days * 86_400,
    memo,
    status: "pending_approval",
    withinPolicy: breaches.length === 0,
    breaches,
    createdAt: now,
    approveBy: now + APPROVAL_TTL_MS,
    claimSigners: keys.map((k) => k.claimSigner),
    sealedKeys: await seal(deps.secret, JSON.stringify(keys.map((k) => k.privateKey))),
    idempotencyKey: idem,
  };
  if (idem && !(await deps.store.claimIdempotency(key.keyId, idem, record.id))) {
    // Someone else (a retry in flight) took this key a moment ago: answer with theirs.
    const other = await deps.store.idempotentRequest(key.keyId, idem);
    const r = other ? await deps.store.getRequest(other) : null;
    if (r) return { ...(await describeRequest(deps, r)), replayed: true };
  }
  await deps.store.putRequest(record, { isNew: true });
  await activity(deps, key.platform, { kind: "requested", keyId: key.keyId, agentLabel: policy.label, requestId: record.id, total: record.total });
  await deps.notify?.(key, record).catch(() => {});
  return describeRequest(deps, record);
}

/** Waits (polling the store) for the platform to act on a request, up to `seconds`. */
export async function waitForDecision(deps: AgentDeps, id: string, seconds: number, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  const until = Date.now() + Math.min(Math.max(seconds, 0), 50) * 1000;
  let r = await deps.store.getRequest(id);
  while (r && r.status === "pending_approval" && Date.now() < until) {
    await sleep(2000);
    r = await deps.store.getRequest(id);
  }
  return r;
}

type RowStatus = "waiting" | "claimed" | "returned";
const ROW_STATUS: Record<string, RowStatus> = { sent: "waiting", claimed: "claimed", refunded: "returned" };

/** The agent-facing view of a request (and, once sent, its payout). Amounts are "12.50" strings in US dollars. */
export async function describeRequest(deps: AgentDeps, record: PayoutRequestRecord, opts: { rows?: boolean } = {}) {
  const r = await lapse(deps, record);
  let batch: LedgerBatch | null = null;
  if (r.status === "sent" && r.batchId) batch = await deps.ledger.getBatch(r.batchId).catch(() => null);
  const statuses = batch ? batch.rows.map((row) => ROW_STATUS[row.status]) : null;
  const count = (s: RowStatus) => statuses?.filter((x) => x === s).length ?? 0;
  const pending = r.status === "pending_approval";
  const nextStep: Record<PayoutRequestRecord["status"], string> = {
    pending_approval: r.withinPolicy
      ? "Waiting for the platform to approve. It's within the agent's policy, so it's a one-tap approval for them. Check back with get_payout_status."
      : "Waiting for the platform to approve. It's over the agent's policy (see policy_notes), so they'll review it in full. Check back with get_payout_status.",
    sent: statuses && count("waiting") === 0
      ? "Done: nobody is left to claim."
      : (r.emailed && !r.emailed.configured
          ? "Sent. Email isn't set up on this Fanout server, so the platform shares each claim link from its dashboard."
          : "Sent. Each person got an email with a link to claim their money.") +
        " send_reminders nudges people who haven't claimed; after the claim window, return_unclaimed puts what's left back in the balance.",
    declined: "The platform declined this payout. Nothing was sent.",
    expired: "Nobody approved this payout in time. Nothing was sent. Ask again with create_payout if it's still needed.",
    cancelled: "The platform paused or revoked the agent key, which cancelled this request. Nothing was sent.",
  };
  return {
    payout_request_id: r.id,
    status: pending ? ("approval_needed" as const) : r.status,
    ...(pending ? { approval_url: approvalUrl(deps, r.id), approve_by: iso(r.approveBy) } : {}),
    within_policy: r.withinPolicy,
    policy_notes: r.breaches.map((b) => b.message),
    total: amountStr(deps, r.total),
    currency: "USD",
    people: r.rows.length,
    claim_window_days: Math.round(r.claimWindowSeconds / 86_400),
    memo: r.memo || undefined,
    created_at: iso(r.createdAt),
    ...(r.batchId ? { payout_id: r.batchId, transaction: r.txHash } : {}),
    ...(batch
      ? {
          claims: { claimed: count("claimed"), waiting: count("waiting"), returned: count("returned") },
          claim_links_expire_at: batch.expiresAt ? iso(batch.expiresAt) : undefined,
        }
      : {}),
    ...(opts.rows
      ? {
          rows: r.rows.map((row, i) => ({
            email: row.email,
            amount: amountStr(deps, row.amount),
            note: row.note || undefined,
            status: statuses ? statuses[i] : pending ? ("not_sent_yet" as const) : ("not_sent" as const),
          })),
        }
      : {}),
    next_step: nextStep[r.status],
  };
}

/** A request this key made, by request id ("req_...") or payout id ("42"). */
async function ownRequest(deps: AgentDeps, key: AgentKeyRecord, id: string): Promise<PayoutRequestRecord> {
  const trimmed = id.trim();
  const requestId = /^\d+$/.test(trimmed) ? await deps.store.requestIdForBatch(trimmed) : trimmed;
  const r = requestId ? await deps.store.getRequest(requestId) : null;
  if (!r || r.keyId !== key.keyId) {
    throw new AgentError("not_found", `No payout "${trimmed}" from this agent. Use list_payouts to see this agent's payouts.`);
  }
  return lapse(deps, r);
}

export async function getPayoutStatus(deps: AgentDeps, key: AgentKeyRecord, id: string) {
  return describeRequest(deps, await ownRequest(deps, key, id), { rows: true });
}

export async function listPayouts(deps: AgentDeps, key: AgentKeyRecord, opts: { limit?: number; status?: string } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  let mine = await requestsOfKey(deps, key);
  if (opts.status) mine = mine.filter((r) => (r.status === "pending_approval" ? "approval_needed" : r.status) === opts.status);
  const items = await Promise.all(mine.slice(0, limit).map((r) => describeRequest(deps, r)));
  return { payouts: items, count: items.length, more: mine.length > limit };
}

async function claimKeys(deps: AgentDeps, r: PayoutRequestRecord): Promise<Hex[]> {
  const keys = JSON.parse(await unseal(deps.secret, r.sealedKeys)) as Hex[];
  if (keys.length !== r.claimSigners.length || keys.some((k, i) => claimSignerFromKey(k) !== r.claimSigners[i])) {
    throw new Error("Stored claim keys don't match the payout.");
  }
  return keys;
}

export async function sendReminders(deps: AgentDeps, key: AgentKeyRecord, policy: AgentPolicy, id: string) {
  assertUsable(deps, key, policy);
  const r = await ownRequest(deps, key, id);
  if (r.status !== "sent" || !r.batchId) throw new AgentError("not_ready", "This payout hasn't been sent yet, so there's nobody to remind.");
  if (!deps.emailer) throw new AgentError("unavailable", "Email isn't set up on this Fanout server. The platform can copy each claim link from the payout page instead.");
  const now = nowMs(deps);
  if (r.lastReminderAt && now - r.lastReminderAt < REMINDER_GAP_MS) {
    throw new AgentError("conflict", `Reminders for this payout went out at ${iso(r.lastReminderAt)}. The next ones can go after ${iso(r.lastReminderAt + REMINDER_GAP_MS)}.`);
  }
  const batch = await deps.ledger.getBatch(r.batchId);
  if (batch.expiresAt && batch.expiresAt <= now) throw new AgentError("not_ready", "The claim links for this payout have expired. Use return_unclaimed to put the money back in the balance.");
  const keys = await claimKeys(deps, r);
  const waiting = batch.rows.map((row, i) => ({ row, i })).filter(({ row }) => row.status === "sent");
  if (waiting.length === 0) return { reminded: 0, failed: 0, message: "Everyone has already claimed. No reminders needed." };
  const result = await deps.emailer.send(
    getAddress(r.platform),
    waiting.map(({ i }) => ({ key: keys[i], email: r.rows[i].email, note: r.rows[i].note || undefined })),
    true,
  );
  await deps.store.putRequest({ ...r, lastReminderAt: now });
  await activity(deps, r.platform, { kind: "reminded", keyId: key.keyId, agentLabel: policy.label, requestId: r.id, batchId: r.batchId, detail: `${result.sent.length} reminded` });
  return {
    reminded: result.sent.length,
    failed: result.failed.length,
    message: `Reminded ${result.sent.length} ${result.sent.length === 1 ? "person" : "people"} who haven't claimed yet.`,
  };
}

export async function returnUnclaimed(deps: AgentDeps, key: AgentKeyRecord, policy: AgentPolicy, id: string) {
  assertUsable(deps, key, policy);
  const r = await ownRequest(deps, key, id);
  if (r.status !== "sent" || !r.batchId) throw new AgentError("not_ready", "This payout hasn't been sent, so there's nothing to return.");
  const before = await deps.ledger.getBatch(r.batchId);
  if (before.expiresAt && before.expiresAt > nowMs(deps)) {
    throw new AgentError("not_ready", `The claim links still work until ${iso(before.expiresAt)}. Unclaimed money can return after that.`);
  }
  const waitingBefore = before.rows.map((row) => row.status === "sent");
  let result: { txHash: Hex; refunded: number };
  try {
    result = await deps.ledger.refundExpired(r.batchId);
  } catch (err) {
    throw new AgentError("not_ready", err instanceof Error ? err.message : "Nothing could be returned.");
  }
  const after = await deps.ledger.getBatch(r.batchId);
  const returned = after.rows.reduce((sum, row, i) => (row.status === "refunded" && waitingBefore[i] ? sum + row.amount : sum), 0n);
  await activity(deps, r.platform, { kind: "returned", keyId: key.keyId, agentLabel: policy.label, requestId: r.id, batchId: r.batchId, total: returned.toString() });
  return {
    returned_people: result.refunded,
    returned_amount: amountStr(deps, returned),
    currency: "USD",
    transaction: result.txHash,
    balance: amountStr(deps, await deps.ledger.balanceOf(r.platform)),
    message: `${usd(deps)(returned)} went back to the platform's payout balance.`,
  };
}

export async function getBalance(deps: AgentDeps, key: AgentKeyRecord, policy: AgentPolicy) {
  const [balance, spent] = await Promise.all([deps.ledger.balanceOf(key.platform), spentLast24h(deps, key)]);
  const left = policy.dailyCap > spent ? policy.dailyCap - spent : 0n;
  return {
    available: amountStr(deps, balance),
    currency: "USD",
    agent_spent_last_24h: amountStr(deps, spent),
    agent_daily_limit_left: amountStr(deps, left),
    message: `${usd(deps)(balance)} is in the platform's payout balance. Payouts are paid from it once approved.`,
  };
}

export async function getPolicy(deps: AgentDeps, key: AgentKeyRecord, policy: AgentPolicy) {
  const spent = await spentLast24h(deps, key);
  const blocked = keyBlocked(key, policy, nowSec(deps));
  return {
    agent: policy.label,
    status: key.paused ? "paused" : blocked ? "expired" : "active",
    ...(blocked ? { blocked_reason: blocked } : {}),
    per_payout_limit: amountStr(deps, policy.perPayoutCap),
    daily_limit: amountStr(deps, policy.dailyCap),
    daily_limit_left: amountStr(deps, policy.dailyCap > spent ? policy.dailyCap - spent : 0n),
    max_people_per_payout: policy.maxPeople,
    allowlist: policy.allowlist.length ? policy.allowlist : "anyone",
    expires_at: iso(Number(policy.expiresAt) * 1000),
    currency: "USD",
    how_approval_works:
      "Every payout needs the platform's approval before money moves. Within these limits it's a one-tap approval; over them, the platform reviews it in full. You can't approve payouts yourself.",
  };
}

// --- Platform side -----------------------------------------------------------------------------

async function activity(deps: AgentDeps, platform: Address, event: Omit<AgentActivity, "at">) {
  await deps.store.addActivity(platform, { at: nowMs(deps), ...event });
}

export function keySummary(deps: AgentDeps, key: AgentKeyRecord) {
  let policy: AgentPolicy | null = null;
  try {
    policy = loadPolicy(key);
  } catch {
    // Shown as unreadable below.
  }
  return {
    keyId: key.keyId,
    label: policy?.label ?? "Unreadable policy",
    tokenHint: key.tokenHint,
    status: key.revokedAt ? "revoked" : key.paused ? "paused" : policy && policy.expiresAt <= nowSec(deps) ? "expired" : "active",
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    policy: key.policy,
  };
}

async function signedPolicy(deps: AgentDeps, platform: Address, body: { policy?: unknown; signature?: unknown }): Promise<{ policy: AgentPolicy; signature: Hex }> {
  let policy: AgentPolicy;
  try {
    policy = parsePolicy(body.policy, nowSec(deps));
  } catch (err) {
    throw new AgentError("invalid_input", err instanceof PolicyInvalid ? err.message : "The policy isn't valid.");
  }
  if (getAddress(policy.platform) !== getAddress(platform)) throw new AgentError("forbidden", "The policy is for a different account.");
  const signature = body.signature;
  if (typeof signature !== "string" || !isHex(signature)) throw new AgentError("invalid_input", "Sign the policy first.");
  const ok = await deps.ledger.verifySignature(platform, agentPolicyTypedData(deps.ledger.chainId, policy), signature);
  if (!ok) throw new AgentError("forbidden", "The signature doesn't match this policy.");
  return { policy, signature };
}

export async function createAgentKey(deps: AgentDeps, platform: Address, body: { policy?: unknown; signature?: unknown }, notifyEmailHash?: Hex) {
  const { policy, signature } = await signedPolicy(deps, platform, body);
  if (policy.version !== 1) throw new AgentError("invalid_input", "A new key's policy starts at version 1.");
  if (await deps.store.getKey(policy.keyId)) throw new AgentError("conflict", "That key already exists. Try again.");
  const token = generateAgentToken();
  const record: AgentKeyRecord = {
    keyId: policy.keyId,
    platform: getAddress(platform),
    tokenHash: hashAgentToken(token),
    tokenHint: tokenHint(token),
    policy: policyToJson(policy),
    signature,
    createdAt: nowMs(deps),
    paused: false,
    notifyEmailHash,
  };
  await deps.store.putKey(record, { isNew: true });
  await activity(deps, platform, { kind: "key_created", keyId: record.keyId, agentLabel: policy.label });
  return { token, key: keySummary(deps, record) };
}

async function ownKey(deps: AgentDeps, platform: Address, keyId: string): Promise<AgentKeyRecord> {
  const key = isHex(keyId) ? await deps.store.getKey(keyId) : null;
  if (!key || getAddress(key.platform) !== getAddress(platform)) throw new AgentError("not_found", "That agent key doesn't exist.");
  return key;
}

export async function updateAgentPolicy(deps: AgentDeps, platform: Address, keyId: string, body: { policy?: unknown; signature?: unknown }) {
  const key = await ownKey(deps, platform, keyId);
  if (key.revokedAt) throw new AgentError("conflict", "This key was revoked. Create a new one.");
  const { policy, signature } = await signedPolicy(deps, platform, body);
  const current = loadPolicy(key);
  if (policy.keyId !== key.keyId) throw new AgentError("invalid_input", "The policy is for a different key.");
  if (policy.version <= current.version) throw new AgentError("conflict", "This policy was changed elsewhere. Reload and try again.");
  const updated = { ...key, policy: policyToJson(policy), signature };
  await deps.store.putKey(updated);
  await activity(deps, platform, { kind: "policy_updated", keyId: key.keyId, agentLabel: policy.label });
  return keySummary(deps, updated);
}

async function cancelPending(deps: AgentDeps, key: AgentKeyRecord) {
  const pending = (await deps.store.listRequests(key.platform)).filter((r) => r.keyId === key.keyId && r.status === "pending_approval");
  await Promise.all(pending.map((r) => deps.store.putRequest({ ...r, status: "cancelled", decidedAt: nowMs(deps) })));
  return pending.length;
}

/** The kill switch. Pausing also cancels the key's requests waiting for approval. */
export async function setAgentPaused(deps: AgentDeps, platform: Address, keyId: string, paused: boolean) {
  const key = await ownKey(deps, platform, keyId);
  if (key.revokedAt) throw new AgentError("conflict", "This key was revoked.");
  const updated = { ...key, paused };
  await deps.store.putKey(updated);
  const cancelled = paused ? await cancelPending(deps, key) : 0;
  await activity(deps, platform, { kind: paused ? "key_paused" : "key_resumed", keyId: key.keyId, agentLabel: key.policy.label, detail: cancelled ? `${cancelled} waiting cancelled` : undefined });
  return keySummary(deps, updated);
}

export async function revokeAgentKey(deps: AgentDeps, platform: Address, keyId: string) {
  const key = await ownKey(deps, platform, keyId);
  if (key.revokedAt) return keySummary(deps, key);
  const updated = { ...key, revokedAt: nowMs(deps) };
  await deps.store.putKey(updated);
  await deps.store.dropToken(key.tokenHash);
  await cancelPending(deps, key);
  await activity(deps, platform, { kind: "key_revoked", keyId: key.keyId, agentLabel: key.policy.label });
  return keySummary(deps, updated);
}

export async function agentOverview(deps: AgentDeps, platform: Address) {
  const [keys, requests, events] = await Promise.all([deps.store.listKeys(platform), deps.store.listRequests(platform, 100), deps.store.listActivity(platform, 50)]);
  const fresh = await Promise.all(requests.map((r) => lapse(deps, r)));
  return {
    keys: keys.map((k) => keySummary(deps, k)),
    requests: fresh.map((r) => platformRequestSummary(r)),
    activity: events,
  };
}

function platformRequestSummary(r: PayoutRequestRecord) {
  return {
    id: r.id,
    keyId: r.keyId,
    agentLabel: r.agentLabel,
    status: r.status,
    withinPolicy: r.withinPolicy,
    total: r.total,
    people: r.rows.length,
    createdAt: r.createdAt,
    approveBy: r.approveBy,
    batchId: r.batchId,
  };
}

async function ownPlatformRequest(deps: AgentDeps, platform: Address, id: string): Promise<PayoutRequestRecord> {
  const r = await deps.store.getRequest(id);
  if (!r || getAddress(r.platform) !== getAddress(platform)) throw new AgentError("not_found", "That request doesn't exist.");
  return lapse(deps, r);
}

/** Everything the approval page shows. Policy checks are re-run now, so they reflect today's spending. */
export async function approvalDetails(deps: AgentDeps, platform: Address, id: string) {
  const r = await ownPlatformRequest(deps, platform, id);
  const key = await deps.store.getKey(r.keyId);
  let breaches: PolicyBreach[] = r.breaches;
  if (key && r.status === "pending_approval") {
    try {
      const policy = loadPolicy(key);
      breaches = policyBreaches(
        policy,
        { total: BigInt(r.total), emails: r.rows.map((x) => x.email), spentLast24h: await spentLast24h(deps, key, r.id) },
        usd(deps),
      );
    } catch {
      // Keep the breaches recorded when the request came in.
    }
  }
  return {
    ...platformRequestSummary(r),
    withinPolicy: breaches.length === 0,
    breaches,
    memo: r.memo,
    claimWindowSeconds: r.claimWindowSeconds,
    rows: r.rows,
    balance: (await deps.ledger.balanceOf(platform)).toString(),
    keyStatus: key ? keySummary(deps, key).status : "revoked",
    txHash: r.txHash,
  };
}

/**
 * The CreateBatch the platform is about to sign, with the claim keys so its browser can check each
 * claim signer and keep the links (like a payout it built itself). A fresh nonce and a short deadline
 * each time it's opened.
 */
export async function prepareApproval(deps: AgentDeps, platform: Address, id: string) {
  const r = await ownPlatformRequest(deps, platform, id);
  if (r.status !== "pending_approval") throw new AgentError("conflict", `This request is ${r.status.replace("_", " ")}.`);
  const key = await deps.store.getKey(r.keyId);
  if (!key || key.revokedAt || key.paused) throw new AgentError("conflict", "The agent key was paused or revoked, so this request can't be approved.");
  const authorization = { nonce: randomNonce(), deadline: (nowSec(deps) + APPROVAL_SIGN_SECONDS).toString() };
  await deps.store.putRequest({ ...r, authorization });
  const keys = await claimKeys(deps, r);
  return {
    chainId: deps.ledger.chainId,
    batchPayout: deps.ledger.batchPayout,
    platform: getAddress(r.platform),
    claimSigners: r.claimSigners,
    amounts: r.rows.map((x) => x.amount),
    emailHashes: r.rows.map((x) => hashEmail(x.email)),
    claimWindow: r.claimWindowSeconds.toString(),
    nonce: authorization.nonce,
    deadline: authorization.deadline,
    claims: r.rows.map((x, i) => ({ claimSigner: r.claimSigners[i], privateKey: keys[i], email: x.email, note: x.note })),
  };
}

export async function approveRequest(deps: AgentDeps, platform: Address, id: string, signature: unknown) {
  if (typeof signature !== "string" || !isHex(signature)) throw new AgentError("invalid_input", "Sign the payout first.");
  if (!(await deps.store.lock(`approve:${id}`))) throw new AgentError("conflict", "This payout is already being sent.");
  try {
    const r = await ownPlatformRequest(deps, platform, id);
    if (r.status !== "pending_approval") throw new AgentError("conflict", `This request is ${r.status.replace("_", " ")}.`);
    if (!r.authorization) throw new AgentError("conflict", "Open the approval again and sign.");
    const key = await deps.store.getKey(r.keyId);
    if (!key || key.revokedAt || key.paused) throw new AgentError("conflict", "The agent key was paused or revoked, so this request can't be approved.");
    const amounts = r.rows.map((x) => BigInt(x.amount));
    const emailHashes = r.rows.map((x) => hashEmail(x.email));
    const input = {
      platform: getAddress(r.platform),
      claimSigners: r.claimSigners,
      amounts,
      emailHashes,
      claimWindow: BigInt(r.claimWindowSeconds),
      nonce: r.authorization.nonce,
      deadline: BigInt(r.authorization.deadline),
      signature: signature as Hex,
    };
    if (input.deadline < nowSec(deps)) throw new AgentError("conflict", "The approval took too long. Open it again and approve.");
    const typedData = createBatchTypedData(deps.ledger.batchPayout, deps.ledger.chainId, input);
    if (!(await deps.ledger.verifySignature(input.platform, typedData, input.signature))) {
      throw new AgentError("forbidden", "The signature doesn't match this payout. Nothing was sent.");
    }
    const total = BigInt(r.total);
    const balance = await deps.ledger.balanceOf(input.platform);
    if (balance < total) {
      throw new AgentError("not_ready", `The payout balance has ${usd(deps)(balance)}; this payout needs ${usd(deps)(total)}. Add money, then approve.`);
    }
    const { batchId, txHash } = await deps.ledger.createBatchFor(input);
    const sent: PayoutRequestRecord = { ...r, status: "sent", decidedAt: nowMs(deps), batchId, txHash };
    await deps.store.putRequest(sent);
    await activity(deps, r.platform, { kind: "approved", keyId: r.keyId, agentLabel: r.agentLabel, requestId: r.id, batchId, total: r.total });

    const keys = await claimKeys(deps, r);
    let emailed = { sent: 0, failed: 0, configured: !!deps.emailer };
    if (!deps.emailer) await deps.store.putRequest({ ...sent, emailed });
    else {
      const result = await deps.emailer
        .send(input.platform, r.rows.map((x, i) => ({ key: keys[i], email: x.email, note: x.note || undefined })), false)
        .catch(() => ({ sent: [], failed: r.rows.map((_, i) => ({ claimSigner: r.claimSigners[i], reason: "failed" })) }));
      emailed = { sent: result.sent.length, failed: result.failed.length, configured: true };
      await deps.store.putRequest({ ...sent, emailed });
    }
    return { batchId, txHash, emailed };
  } finally {
    await deps.store.unlock(`approve:${id}`);
  }
}

export async function declineRequest(deps: AgentDeps, platform: Address, id: string) {
  const r = await ownPlatformRequest(deps, platform, id);
  if (r.status !== "pending_approval") throw new AgentError("conflict", `This request is ${r.status.replace("_", " ")}.`);
  await deps.store.putRequest({ ...r, status: "declined", decidedAt: nowMs(deps) });
  await activity(deps, r.platform, { kind: "declined", keyId: r.keyId, agentLabel: r.agentLabel, requestId: r.id, total: r.total });
  return { status: "declined" as const };
}
