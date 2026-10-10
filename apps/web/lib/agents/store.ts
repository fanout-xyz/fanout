import "server-only";
import type { Address, Hex } from "viem";
import type { Kv } from "./kv";
import type { AgentPolicyJson, PolicyBreach } from "./policy";

/**
 * Records behind agent keys, kept in the agent Kv (lib/agents/kv.ts). Payee emails are stored only
 * inside payout requests, which only the platform that owns the key (and the key itself) can read.
 */

export type AgentKeyRecord = {
  keyId: Hex;
  platform: Address;
  /** SHA-256 of the token (lib/agents/tokens.ts). The token itself is never stored. */
  tokenHash: Hex;
  tokenHint: string;
  policy: AgentPolicyJson;
  /** The platform's EIP-712 signature over `policy`. */
  signature: Hex;
  createdAt: number;
  /** The kill switch: while true, the key can only read (status, balance, policy); it can't ask, remind or return. */
  paused: boolean;
  revokedAt?: number;
  lastUsedAt?: number;
  /** Hash of the platform's sign-in email, for "an agent is asking" notifications. */
  notifyEmailHash?: Hex;
};

export type RequestStatus = "pending_approval" | "sent" | "declined" | "expired" | "cancelled";

export type PayoutRequestRecord = {
  id: string;
  keyId: Hex;
  platform: Address;
  agentLabel: string;
  rows: { email: string; amount: string; note: string }[];
  /** Base units, decimal string. */
  total: string;
  claimWindowSeconds: number;
  /** Why the agent is paying, in its own words. Shown to the platform when approving. */
  memo: string;
  status: RequestStatus;
  withinPolicy: boolean;
  breaches: PolicyBreach[];
  createdAt: number;
  /** After this, the request can't be approved any more (unix ms). */
  approveBy: number;
  decidedAt?: number;
  /** One claim signer per row; their keys are in sealedKeys (lib/agents/seal.ts). */
  claimSigners: Address[];
  sealedKeys: string;
  /** The CreateBatch the platform was asked to sign (set when it opens the approval). */
  authorization?: { nonce: Hex; deadline: string };
  batchId?: string;
  txHash?: Hex;
  emailed?: { sent: number; failed: number; configured: boolean };
  lastReminderAt?: number;
  idempotencyKey?: string;
};

export type AgentActivity = {
  at: number;
  keyId: Hex;
  agentLabel: string;
  kind: "requested" | "approved" | "declined" | "reminded" | "returned" | "refused" | "key_created" | "key_paused" | "key_resumed" | "key_revoked" | "policy_updated";
  requestId?: string;
  batchId?: string;
  total?: string;
  detail?: string;
};

const DAY = 24 * 60 * 60;
/** Requests stay readable for a while after their claim window (status checks, reminders). */
const REQUEST_TTL_SECONDS = 120 * DAY;
const LIST_MAX = 200;

const k = {
  key: (keyId: Hex) => `agent:key:${keyId.toLowerCase()}`,
  token: (hash: Hex) => `agent:token:${hash.toLowerCase()}`,
  platformKeys: (platform: Address) => `agent:keys:${platform.toLowerCase()}`,
  request: (id: string) => `agent:req:${id}`,
  platformRequests: (platform: Address) => `agent:reqs:${platform.toLowerCase()}`,
  activity: (platform: Address) => `agent:activity:${platform.toLowerCase()}`,
  batch: (batchId: string) => `agent:batch:${batchId}`,
  idem: (keyId: Hex, key: string) => `agent:idem:${keyId.toLowerCase()}:${key}`,
  lock: (name: string) => `agent:lock:${name}`,
};

export function agentStore(kv: Kv) {
  return {
    kv,
    async putKey(record: AgentKeyRecord, { isNew = false } = {}) {
      await kv.set(k.key(record.keyId), record);
      if (isNew) {
        await kv.set(k.token(record.tokenHash), record.keyId);
        await kv.pushCapped(k.platformKeys(record.platform), record.keyId, LIST_MAX);
      }
    },
    getKey: (keyId: Hex) => kv.get<AgentKeyRecord>(k.key(keyId)),
    async keyByTokenHash(hash: Hex) {
      const keyId = await kv.get<Hex>(k.token(hash));
      return keyId ? kv.get<AgentKeyRecord>(k.key(keyId)) : null;
    },
    /** Forgets the token so it stops working at once; the key record stays for the activity history. */
    dropToken: (hash: Hex) => kv.del(k.token(hash)),
    async listKeys(platform: Address) {
      const ids = [...new Set(await kv.list<Hex>(k.platformKeys(platform), LIST_MAX))];
      const keys = await Promise.all(ids.map((id) => kv.get<AgentKeyRecord>(k.key(id))));
      return keys.filter((x): x is AgentKeyRecord => !!x);
    },

    async putRequest(record: PayoutRequestRecord, { isNew = false } = {}) {
      await kv.set(k.request(record.id), record, { ex: REQUEST_TTL_SECONDS + Math.ceil(record.claimWindowSeconds) });
      if (isNew) await kv.pushCapped(k.platformRequests(record.platform), record.id, LIST_MAX);
      if (record.batchId) await kv.set(k.batch(record.batchId), record.id, { ex: REQUEST_TTL_SECONDS + Math.ceil(record.claimWindowSeconds) });
    },
    getRequest: (id: string) => kv.get<PayoutRequestRecord>(k.request(id)),
    requestIdForBatch: (batchId: string) => kv.get<string>(k.batch(batchId)),
    async listRequests(platform: Address, limit = LIST_MAX) {
      const ids = await kv.list<string>(k.platformRequests(platform), limit);
      const records = await Promise.all(ids.map((id) => kv.get<PayoutRequestRecord>(k.request(id))));
      return records.filter((x): x is PayoutRequestRecord => !!x);
    },

    addActivity: (platform: Address, event: AgentActivity) => kv.pushCapped(k.activity(platform), event, LIST_MAX),
    listActivity: (platform: Address, limit = 50) => kv.list<AgentActivity>(k.activity(platform), limit),

    /** Remembers which request an agent's idempotency key made (24 hours). False if it's taken. */
    claimIdempotency: (keyId: Hex, key: string, requestId: string) => kv.set(k.idem(keyId, key), requestId, { ex: DAY, nx: true }),
    idempotentRequest: (keyId: Hex, key: string) => kv.get<string>(k.idem(keyId, key)),

    /** A short lock so two approvals (two tabs, a double tap) can't both submit. */
    lock: (name: string, seconds = 120) => kv.set(k.lock(name), Date.now(), { ex: seconds, nx: true }),
    unlock: (name: string) => kv.del(k.lock(name)),
  };
}

export type AgentStore = ReturnType<typeof agentStore>;
