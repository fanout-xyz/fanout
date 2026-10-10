import "server-only";
import { Redis } from "@upstash/redis";
import { config } from "@/lib/config";

/**
 * The small key-value store behind agent keys, payout requests and x402 idempotency.
 *
 * Upstash Redis, the same database push notifications use: UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN, or KV_REST_API_URL and KV_REST_API_TOKEN (Vercel's names). The local
 * demo (NEXT_PUBLIC_USE_MOCK) keeps everything in this server's memory instead. Values are plain
 * JSON (no bigints: amounts are stored as decimal strings).
 */

export interface Kv {
  get<T>(key: string): Promise<T | null>;
  /** Resolves false when `nx` is set and the key already exists. */
  set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Pushes to the front of a list and keeps its first `max` items. */
  pushCapped(key: string, value: unknown, max: number): Promise<void>;
  list<T>(key: string, limit: number): Promise<T[]>;
}

type Entry = { value: string; expiresAt?: number };

export function memoryKv(map: Map<string, Entry> = new Map()): Kv {
  const live = (key: string) => {
    const e = map.get(key);
    if (e?.expiresAt && e.expiresAt <= Date.now()) {
      map.delete(key);
      return undefined;
    }
    return e;
  };
  return {
    async get<T>(key: string) {
      const e = live(key);
      return e ? (JSON.parse(e.value) as T) : null;
    },
    async set(key, value, opts = {}) {
      if (opts.nx && live(key)) return false;
      map.set(key, { value: JSON.stringify(value), expiresAt: opts.ex ? Date.now() + opts.ex * 1000 : undefined });
      return true;
    },
    async del(key) {
      map.delete(key);
    },
    async pushCapped(key, value, max) {
      const items = live(key) ? (JSON.parse(map.get(key)!.value) as unknown[]) : [];
      map.set(key, { value: JSON.stringify([value, ...items].slice(0, max)) });
    },
    async list<T>(key: string, limit: number) {
      const e = live(key);
      return e ? (JSON.parse(e.value) as T[]).slice(0, limit) : [];
    },
  };
}

export function redisKv(redis: Pick<Redis, "get" | "set" | "del" | "lpush" | "ltrim" | "lrange">): Kv {
  return {
    async get<T>(key: string) {
      return (await redis.get<T>(key)) ?? null;
    },
    async set(key, value, opts = {}) {
      const base = opts.ex ? { ex: opts.ex } : {};
      const res = opts.nx ? await redis.set(key, value, { ...base, nx: true } as never) : await redis.set(key, value, base as never);
      return res !== null;
    },
    async del(key) {
      await redis.del(key);
    },
    async pushCapped(key, value, max) {
      await redis.lpush(key, value);
      await redis.ltrim(key, 0, max - 1);
    },
    async list<T>(key: string, limit: number) {
      return (await redis.lrange<T>(key, 0, limit - 1)) ?? [];
    },
  };
}

type Env = Record<string, string | undefined>;

/** Where agent data lives on this deployment, or null when it has nowhere to live (feature off). */
export function kvConfig(env: Env = process.env, useMock = config.useMock): { kind: "upstash"; url: string; token: string } | { kind: "memory" } | null {
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)?.trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)?.trim();
  if (url && token) return { kind: "upstash", url, token };
  return useMock ? { kind: "memory" } : null;
}

const g = globalThis as typeof globalThis & { __fanoutAgentKv?: { id: string; kv: Kv }; __fanoutAgentMemory?: Map<string, Entry> };

export function agentKv(): Kv | null {
  const cfg = kvConfig();
  if (!cfg) return null;
  const id = cfg.kind === "upstash" ? cfg.url : "memory";
  if (g.__fanoutAgentKv?.id === id) return g.__fanoutAgentKv.kv;
  // Memory survives Next's dev reloads by hanging off globalThis, like the mock chain state.
  const kv = cfg.kind === "upstash" ? redisKv(new Redis({ url: cfg.url, token: cfg.token })) : memoryKv((g.__fanoutAgentMemory ??= new Map()));
  g.__fanoutAgentKv = { id, kv };
  return kv;
}
