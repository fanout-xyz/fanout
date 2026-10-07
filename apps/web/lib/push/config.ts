/**
 * "You've been paid" notifications (Web Push) are on only when both halves are configured:
 *
 * - VAPID keys, which sign every push: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
 *   VAPID_SUBJECT (a mailto: address push services can reach). `pnpm --filter web vapid-keys`
 *   prints a fresh pair.
 * - Somewhere to keep subscriptions: Upstash Redis. Reads UPSTASH_REDIS_REST_URL and
 *   UPSTASH_REDIS_REST_TOKEN, or KV_REST_API_URL and KV_REST_API_TOKEN (the names Vercel's
 *   Upstash for Redis integration sets). The local demo
 *   (NEXT_PUBLIC_USE_MOCK) keeps them in memory instead.
 *
 * With either half missing the feature is off: no prompt, no toggle, no sends.
 */

export type PushConfig = {
  vapid: { publicKey: string; privateKey: string; subject: string };
  storage: { kind: "upstash"; url: string; token: string } | { kind: "memory" };
};

type Env = Record<string, string | undefined>;

export function pushConfig(env: Env = process.env, useMock = env.NEXT_PUBLIC_USE_MOCK !== "false"): PushConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !/^(mailto:|https:\/\/)/.test(subject)) return null;

  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)?.trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)?.trim();
  if (url && token) return { vapid: { publicKey, privateKey, subject }, storage: { kind: "upstash", url, token } };
  if (useMock) return { vapid: { publicKey, privateKey, subject }, storage: { kind: "memory" } };
  return null;
}
