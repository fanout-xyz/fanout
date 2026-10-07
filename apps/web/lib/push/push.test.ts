import { describe, expect, it, vi } from "vitest";
import { hashEmail } from "@/lib/email-hash";
import { pushConfig } from "./config";
import { pushSupport, vapidKeyBytes } from "./device";
import { buildPaidPayload, PAID_URL } from "./payload";
import { sendPaidNotifications } from "./sender";
import { deviceField, MAX_DEVICES, memoryStore, parseSubscription, subscriptionKey, upstashStore, type DeviceSubscription } from "./store";

const vapid = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:ops@fanout.test" };
const upstash = { UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "tok" };

const device = (n: number): DeviceSubscription => ({ endpoint: `https://push.test/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });

describe("pushConfig", () => {
  it("is off without VAPID keys", () => {
    expect(pushConfig({ ...upstash }, false)).toBeNull();
    expect(pushConfig({ ...upstash, ...vapid, VAPID_PRIVATE_KEY: "" }, false)).toBeNull();
    expect(pushConfig({ ...upstash, ...vapid, VAPID_SUBJECT: "ops@fanout.test" }, false)).toBeNull();
  });

  it("is off live without storage, and uses memory only in the local demo", () => {
    expect(pushConfig({ ...vapid }, false)).toBeNull();
    expect(pushConfig({ ...vapid, UPSTASH_REDIS_REST_URL: "https://redis.test" }, false)).toBeNull();
    expect(pushConfig({ ...vapid }, true)?.storage).toEqual({ kind: "memory" });
  });

  it("uses Upstash when its env is set", () => {
    expect(pushConfig({ ...vapid, ...upstash }, false)?.storage).toEqual({ kind: "upstash", url: "https://redis.test", token: "tok" });
  });
});

describe("buildPaidPayload", () => {
  it("says who paid how much, in dollars, and opens the balance", () => {
    const p = buildPaidPayload({ amount: 1_234_500_000n, platformName: "Acme Studio" });
    expect(p).toEqual({ title: "You've been paid", body: "$1,234.50 from Acme Studio. Tap to see it.", url: PAID_URL, tag: "fanout-paid" });
  });

  it("never carries a claim link", () => {
    const p = buildPaidPayload({ amount: 5_000_000n, platformName: "Acme" });
    expect(p.url).toBe("/balance?paid=1");
    expect(JSON.stringify(p)).not.toMatch(/claim#|k=|0x/);
  });

  it("falls back when the platform has no name", () => {
    expect(buildPaidPayload({ amount: 1_000_000n, platformName: " " }).body).toBe("$1.00 from a platform. Tap to see it.");
  });
});

describe("subscription keys", () => {
  it("files devices under the email hash, never the email", () => {
    const key = subscriptionKey(hashEmail(" Ana@Example.com"));
    expect(key).toBe(subscriptionKey(hashEmail("ana@example.com")));
    expect(key).toMatch(/^push:subs:0x[0-9a-f]{64}$/);
    expect(key).not.toContain("ana");
  });

  it("validates the browser's subscription", () => {
    expect(parseSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "BAbc-_", auth: "xy_Z" } })).toEqual({
      endpoint: "https://fcm.googleapis.com/x",
      keys: { p256dh: "BAbc-_", auth: "xy_Z" },
    });
    expect(parseSubscription({ endpoint: "http://insecure.test/x", keys: { p256dh: "a", auth: "b" } })).toBeNull();
    expect(parseSubscription({ endpoint: "https://ok.test/x", keys: { p256dh: "<script>", auth: "b" } })).toBeNull();
    expect(parseSubscription({ endpoint: "https://ok.test/x" })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });

  it("keeps at most MAX_DEVICES per payee in memory", async () => {
    const store = memoryStore();
    const h = hashEmail(`cap-${Math.random()}@fanout.test`);
    for (let i = 0; i < MAX_DEVICES + 3; i++) await store.add(h, device(i));
    expect(await store.list(h)).toHaveLength(MAX_DEVICES);
  });

  it("stores devices in Upstash as one hash per payee", async () => {
    const data = new Map<string, Record<string, unknown>>();
    const redis = {
      hset: vi.fn(async (key: string, v: Record<string, unknown>) => (data.set(key, { ...data.get(key), ...v }), 1)),
      hgetall: vi.fn(async (key: string) => data.get(key) ?? null),
      hdel: vi.fn(async (key: string, ...fields: string[]) => (fields.forEach((f) => delete data.get(key)?.[f]), fields.length)),
      expire: vi.fn(async () => 1),
    };
    const store = upstashStore(redis as never);
    const h = hashEmail("bo@fanout.test");
    await store.add(h, device(1));
    expect([...data.keys()]).toEqual([subscriptionKey(h)]);
    expect(Object.keys(data.get(subscriptionKey(h))!)).toEqual([deviceField(device(1).endpoint)]);
    expect(await store.list(h)).toEqual([device(1)]);
    await store.remove(h, device(1).endpoint);
    expect(await store.list(h)).toEqual([]);
  });
});

describe("sendPaidNotifications", () => {
  it("sends one push per device and forgets devices that are gone (404/410)", async () => {
    const store = memoryStore();
    const ana = hashEmail(`ana-${Math.random()}@fanout.test`);
    const bo = hashEmail(`bo-${Math.random()}@fanout.test`);
    await store.add(ana, device(1));
    await store.add(ana, device(2));
    await store.add(bo, device(3));
    await store.add(bo, device(4));

    const sent: { endpoint: string; payload: unknown }[] = [];
    const send = vi.fn(async (sub: DeviceSubscription, payload: string) => {
      if (sub.endpoint.endsWith("/2")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (sub.endpoint.endsWith("/3")) throw Object.assign(new Error("not found"), { statusCode: 404 });
      if (sub.endpoint.endsWith("/4")) throw Object.assign(new Error("busy"), { statusCode: 503 });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    });

    const counts = await sendPaidNotifications(
      [
        { emailHash: ana, amount: 10_000_000n },
        { emailHash: ana, amount: 2_500_000n },
        { emailHash: bo, amount: 1_000_000n },
      ],
      { store, send, platformName: "Acme" },
    );

    expect(counts).toEqual({ payees: 2, sent: 1, removed: 2, failed: 1 });
    // Two payments to Ana in one payout: one notification with the total.
    expect(sent).toEqual([{ endpoint: "https://push.test/1", payload: expect.objectContaining({ body: "$12.50 from Acme. Tap to see it." }) }]);
    expect(await store.list(ana)).toEqual([device(1)]);
    // A temporary failure (503) keeps the device.
    expect(await store.list(bo)).toEqual([device(4)]);
  });

  it("does nothing for payees without devices, and survives a storage error", async () => {
    const send = vi.fn();
    const broken = { add: vi.fn(), remove: vi.fn(), list: vi.fn(async () => Promise.reject(new Error("down"))) };
    expect(await sendPaidNotifications([{ emailHash: hashEmail("x@fanout.test"), amount: 1n }], { store: broken, send, platformName: "Acme" })).toEqual({
      payees: 0,
      sent: 0,
      removed: 0,
      failed: 0,
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("pushSupport", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const android = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";

  it("asks iPhone users to add Fanout to the Home Screen first", () => {
    expect(pushSupport({ userAgent: iphone, maxTouchPoints: 5, standalone: false, hasPushApis: false })).toBe("ios-install");
    expect(pushSupport({ userAgent: iphone, maxTouchPoints: 5, standalone: true, hasPushApis: true })).toBe("ready");
    // Installed on iOS older than 16.4: no push at all.
    expect(pushSupport({ userAgent: iphone, maxTouchPoints: 5, standalone: true, hasPushApis: false })).toBe("unsupported");
  });

  it("works in other browsers with the push APIs, installed or not", () => {
    expect(pushSupport({ userAgent: android, maxTouchPoints: 5, standalone: false, hasPushApis: true })).toBe("ready");
    expect(pushSupport({ userAgent: android, maxTouchPoints: 5, standalone: false, hasPushApis: false })).toBe("unsupported");
  });

  it("decodes the VAPID public key", () => {
    expect([...vapidKeyBytes("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
});
