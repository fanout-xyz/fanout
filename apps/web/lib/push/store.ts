import "server-only";
import { Redis } from "@upstash/redis";
import { keccak256, toBytes, type Hex } from "viem";
import type { PushConfig } from "./config";

/**
 * Where device subscriptions live, keyed by the payee's email hash (hashEmail, the same one the
 * payout records onchain). Raw emails are never stored. Each payee's devices are one Redis hash:
 * field = hash of the push endpoint, value = the subscription.
 */

export type DeviceSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

export interface PushStore {
  add(emailHash: Hex, sub: DeviceSubscription): Promise<void>;
  list(emailHash: Hex): Promise<DeviceSubscription[]>;
  remove(emailHash: Hex, endpoint: string): Promise<void>;
}

/** A payee keeps at most this many devices; subscribing another drops the oldest. */
export const MAX_DEVICES = 10;
/** Devices that haven't re-subscribed in this long are forgotten. */
const TTL_SECONDS = 180 * 24 * 60 * 60;

export function subscriptionKey(emailHash: Hex): string {
  return `push:subs:${emailHash.toLowerCase()}`;
}

export function deviceField(endpoint: string): Hex {
  return keccak256(toBytes(endpoint));
}

/** Validates a browser PushSubscription (its toJSON()) before it's stored. */
export function parseSubscription(input: unknown): DeviceSubscription | null {
  const { endpoint, keys } = (input ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== "string" || endpoint.length > 1024) return null;
  try {
    if (new URL(endpoint).protocol !== "https:") return null;
  } catch {
    return null;
  }
  const b64url = /^[A-Za-z0-9_-]+={0,2}$/;
  const { p256dh, auth } = keys ?? {};
  if (typeof p256dh !== "string" || p256dh.length > 200 || !b64url.test(p256dh)) return null;
  if (typeof auth !== "string" || auth.length > 100 || !b64url.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

type Stored = DeviceSubscription & { at: number };

/** Local demo only: one dev server's memory. */
export function memoryStore(): PushStore {
  const g = globalThis as typeof globalThis & { __fanoutPush?: Map<string, Map<string, Stored>> };
  const all = (g.__fanoutPush ??= new Map());
  const devices = (h: Hex) => {
    const key = subscriptionKey(h);
    if (!all.has(key)) all.set(key, new Map());
    return all.get(key)!;
  };
  return {
    async add(h, sub) {
      const d = devices(h);
      d.set(deviceField(sub.endpoint), { ...sub, at: Date.now() });
      trimOldest(d);
    },
    async list(h) {
      return [...devices(h).values()].map(({ endpoint, keys }) => ({ endpoint, keys }));
    },
    async remove(h, endpoint) {
      devices(h).delete(deviceField(endpoint));
    },
  };
}

function trimOldest(devices: Map<string, Stored>) {
  const sorted = [...devices.entries()].sort((a, b) => b[1].at - a[1].at);
  for (const [field] of sorted.slice(MAX_DEVICES)) devices.delete(field);
}

export function upstashStore(redis: Pick<Redis, "hset" | "hgetall" | "hdel" | "expire">): PushStore {
  return {
    async add(h, sub) {
      const key = subscriptionKey(h);
      await redis.hset(key, { [deviceField(sub.endpoint)]: { ...sub, at: Date.now() } satisfies Stored });
      const all = (await redis.hgetall<Record<string, Stored>>(key)) ?? {};
      const extra = Object.entries(all)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(MAX_DEVICES)
        .map(([field]) => field);
      if (extra.length) await redis.hdel(key, ...extra);
      await redis.expire(key, TTL_SECONDS);
    },
    async list(h) {
      const all = (await redis.hgetall<Record<string, Stored>>(subscriptionKey(h))) ?? {};
      return Object.values(all).map(({ endpoint, keys }) => ({ endpoint, keys }));
    },
    async remove(h, endpoint) {
      await redis.hdel(subscriptionKey(h), deviceField(endpoint));
    },
  };
}

let cached: { id: string; store: PushStore } | null = null;
export function pushStore({ storage }: PushConfig): PushStore {
  const id = storage.kind === "upstash" ? storage.url : "memory";
  if (cached?.id === id) return cached.store;
  const store = storage.kind === "upstash" ? upstashStore(new Redis({ url: storage.url, token: storage.token })) : memoryStore();
  cached = { id, store };
  return store;
}
