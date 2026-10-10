import { getAddress, isAddress, isHex, verifyTypedData, type Address, type Hex, type LocalAccount, type WalletClient } from "viem";
import { normalizeEmail } from "@/lib/email-hash";
import { MAX_ROWS } from "@/lib/csv";

/**
 * An agent's spending policy: what an AI agent holding one agent key may ask Fanout to pay out.
 *
 * The platform signs it once with its own account (EIP-712, struct AgentPolicy below). It never
 * goes onchain: the server checks the signature whenever it loads the key, so a policy changed in
 * storage without a fresh signature is refused. The agent can never sign a payout itself. Every
 * payout it asks for still needs the platform's own CreateBatch signature (see lib/agents/service.ts),
 * and the policy decides how that request is presented: within policy (a one-tap approval) or
 * over policy (flagged, with the reasons, for a full review).
 *
 * Amounts are base units of the payout token (6 decimals for AUSD), never floats.
 */

export type AgentPolicy = {
  platform: Address;
  /** Random bytes32 chosen when the key is created; ties the signature to one key. */
  keyId: Hex;
  /** The name the platform gave the agent ("Support bot"). */
  label: string;
  /** Largest single payout, in base units. */
  perPayoutCap: bigint;
  /** Most the agent can pay out in any rolling 24 hours, in base units. */
  dailyCap: bigint;
  /** Most people in one payout. */
  maxPeople: number;
  /** Lowercased emails ("ana@example.com") or domains ("@example.com"). Empty = anyone. */
  allowlist: string[];
  /** Unix seconds. After this the key stops working. */
  expiresAt: bigint;
  /** Goes up by one each time the platform edits and re-signs the policy. */
  version: number;
};

/** JSON form (API bodies, storage): amounts and times as decimal strings. */
export type AgentPolicyJson = {
  platform: Address;
  keyId: Hex;
  label: string;
  perPayoutCap: string;
  dailyCap: string;
  maxPeople: number;
  allowlist: string[];
  expiresAt: string;
  version: number;
};

export const AGENT_POLICY_DOMAIN_NAME = "Fanout Agent Policy";
export const AGENT_POLICY_DOMAIN_VERSION = "1";
export const MAX_ALLOWLIST_ENTRIES = 200;
export const MAX_LABEL_LENGTH = 60;
/** A key can be valid for a year at most; the platform re-signs to extend it. */
export const MAX_POLICY_SECONDS = 366 * 24 * 60 * 60;

const agentPolicyTypes = {
  AgentPolicy: [
    { name: "platform", type: "address" },
    { name: "keyId", type: "bytes32" },
    { name: "label", type: "string" },
    { name: "perPayoutCap", type: "uint256" },
    { name: "dailyCap", type: "uint256" },
    { name: "maxPeople", type: "uint16" },
    { name: "allowlist", type: "string[]" },
    { name: "expiresAt", type: "uint64" },
    { name: "version", type: "uint32" },
  ],
} as const;

/** No verifyingContract: the policy is checked by Fanout's server, not by a contract. */
export function agentPolicyTypedData(chainId: number, policy: AgentPolicy) {
  return {
    domain: { name: AGENT_POLICY_DOMAIN_NAME, version: AGENT_POLICY_DOMAIN_VERSION, chainId },
    types: agentPolicyTypes,
    primaryType: "AgentPolicy" as const,
    message: {
      platform: policy.platform,
      keyId: policy.keyId,
      label: policy.label,
      perPayoutCap: policy.perPayoutCap,
      dailyCap: policy.dailyCap,
      maxPeople: policy.maxPeople,
      allowlist: policy.allowlist,
      expiresAt: policy.expiresAt,
      version: policy.version,
    },
  };
}

export function signAgentPolicy(signer: LocalAccount | WalletClient, chainId: number, policy: AgentPolicy): Promise<Hex> {
  const typedData = agentPolicyTypedData(chainId, policy);
  if ("type" in signer && signer.type === "local") return (signer as LocalAccount).signTypedData(typedData);
  const wc = signer as WalletClient;
  return wc.signTypedData({ ...typedData, account: wc.account ?? policy.platform });
}

/** Checks the platform's signature (EOA). Smart accounts are checked by the caller with a public client. */
export function verifyAgentPolicy(chainId: number, policy: AgentPolicy, signature: Hex): Promise<boolean> {
  return verifyTypedData({ address: policy.platform, signature, ...agentPolicyTypedData(chainId, policy) }).catch(() => false);
}

export function policyToJson(p: AgentPolicy): AgentPolicyJson {
  return { ...p, perPayoutCap: p.perPayoutCap.toString(), dailyCap: p.dailyCap.toString(), expiresAt: p.expiresAt.toString() };
}

const DOMAIN_RE = /^@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** "Ana@Example.com" -> "ana@example.com"; "example.com" or "@Example.com" -> "@example.com". Null if neither. */
export function normalizeAllowlistEntry(entry: string): string | null {
  const e = normalizeEmail(entry);
  if (!e) return null;
  if (EMAIL_RE.test(e) && !e.startsWith("@")) return e;
  const domain = e.startsWith("@") ? e : `@${e}`;
  return DOMAIN_RE.test(domain) ? domain : null;
}

export class PolicyInvalid extends Error {}

const uintString = (v: unknown): bigint | null => (typeof v === "string" && /^\d{1,30}$/.test(v) ? BigInt(v) : null);

/**
 * Parses and validates a policy from JSON. Throws PolicyInvalid with a sentence a person can act on.
 * `now` (unix seconds) checks the expiry; pass null to skip that (loading a stored policy).
 */
export function parsePolicy(input: unknown, now: bigint | null): AgentPolicy {
  const o = (input ?? {}) as Record<string, unknown>;
  if (typeof o.platform !== "string" || !isAddress(o.platform)) throw new PolicyInvalid("The policy's account isn't valid.");
  if (typeof o.keyId !== "string" || !isHex(o.keyId) || o.keyId.length !== 66) throw new PolicyInvalid("The policy's key id isn't valid.");
  const label = typeof o.label === "string" ? o.label.trim() : "";
  if (!label) throw new PolicyInvalid("Give the agent a name.");
  if (label.length > MAX_LABEL_LENGTH) throw new PolicyInvalid(`Keep the name under ${MAX_LABEL_LENGTH} characters.`);
  const perPayoutCap = uintString(o.perPayoutCap);
  const dailyCap = uintString(o.dailyCap);
  if (perPayoutCap === null || perPayoutCap === 0n) throw new PolicyInvalid("Set a limit per payout above $0.00.");
  if (dailyCap === null || dailyCap === 0n) throw new PolicyInvalid("Set a daily limit above $0.00.");
  if (dailyCap < perPayoutCap) throw new PolicyInvalid("The daily limit can't be lower than the limit per payout.");
  const maxPeople = o.maxPeople;
  if (typeof maxPeople !== "number" || !Number.isInteger(maxPeople) || maxPeople < 1 || maxPeople > MAX_ROWS) {
    throw new PolicyInvalid(`People per payout must be between 1 and ${MAX_ROWS}.`);
  }
  if (!Array.isArray(o.allowlist) || o.allowlist.length > MAX_ALLOWLIST_ENTRIES) {
    throw new PolicyInvalid(`The allowlist can have up to ${MAX_ALLOWLIST_ENTRIES} entries.`);
  }
  const allowlist: string[] = [];
  for (const raw of o.allowlist) {
    const entry = typeof raw === "string" ? normalizeAllowlistEntry(raw) : null;
    if (!entry || entry !== raw) throw new PolicyInvalid(`"${String(raw)}" isn't an email or a domain like @example.com.`);
    if (!allowlist.includes(entry)) allowlist.push(entry);
  }
  if (allowlist.length !== o.allowlist.length) throw new PolicyInvalid("The allowlist has a duplicate entry.");
  const expiresAt = uintString(o.expiresAt);
  if (expiresAt === null) throw new PolicyInvalid("Set when the key expires.");
  if (now !== null && (expiresAt <= now || expiresAt > now + BigInt(MAX_POLICY_SECONDS))) {
    throw new PolicyInvalid("The key must expire in the future, within a year.");
  }
  const version = o.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 2 ** 32 - 1) {
    throw new PolicyInvalid("The policy version isn't valid.");
  }
  return { platform: getAddress(o.platform), keyId: o.keyId as Hex, label, perPayoutCap, dailyCap, maxPeople, allowlist, expiresAt, version };
}

/** Whether an email is allowed by the allowlist (an empty list allows anyone). */
export function allowedByList(allowlist: readonly string[], email: string): boolean {
  if (allowlist.length === 0) return true;
  const e = normalizeEmail(email);
  const domain = e.slice(e.lastIndexOf("@"));
  return allowlist.includes(e) || allowlist.includes(domain);
}

export type PolicyBreachCode = "per_payout_cap" | "daily_cap" | "max_people" | "allowlist";
export type PolicyBreach = { code: PolicyBreachCode; message: string; emails?: string[] };

/**
 * What a payout would exceed. Empty = within policy. `spentLast24h` counts this key's payouts sent
 * or waiting for approval in the last 24 hours (not this one).
 */
export function policyBreaches(
  policy: Pick<AgentPolicy, "perPayoutCap" | "dailyCap" | "maxPeople" | "allowlist">,
  payout: { total: bigint; emails: readonly string[]; spentLast24h: bigint },
  format: (amount: bigint) => string,
): PolicyBreach[] {
  const breaches: PolicyBreach[] = [];
  if (payout.total > policy.perPayoutCap) {
    breaches.push({ code: "per_payout_cap", message: `${format(payout.total)} is over the ${format(policy.perPayoutCap)} limit per payout.` });
  }
  if (payout.spentLast24h + payout.total > policy.dailyCap) {
    const left = policy.dailyCap > payout.spentLast24h ? policy.dailyCap - payout.spentLast24h : 0n;
    breaches.push({ code: "daily_cap", message: `Only ${format(left)} of the ${format(policy.dailyCap)} daily limit is left.` });
  }
  if (payout.emails.length > policy.maxPeople) {
    breaches.push({ code: "max_people", message: `${payout.emails.length} people is over the limit of ${policy.maxPeople} per payout.` });
  }
  const outside = payout.emails.filter((e) => !allowedByList(policy.allowlist, e));
  if (outside.length) {
    breaches.push({
      code: "allowlist",
      message: `${outside.length === 1 ? "1 person isn't" : `${outside.length} people aren't`} on the allowlist.`,
      emails: outside,
    });
  }
  return breaches;
}

/** Why a key can't be used at all (no request is even created), or null when it can. */
export function keyBlocked(key: { paused: boolean; revokedAt?: number }, policy: Pick<AgentPolicy, "expiresAt">, nowSeconds: bigint): string | null {
  if (key.revokedAt) return "This agent key was revoked. Ask the platform for a new one.";
  if (key.paused) return "The platform paused this agent key. Nothing can be paid with it until they turn it back on.";
  if (policy.expiresAt <= nowSeconds) return "This agent key has expired. Ask the platform to extend it.";
  return null;
}
