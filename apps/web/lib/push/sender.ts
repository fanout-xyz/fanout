import "server-only";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { Hex } from "viem";
import webpush from "web-push";
import { emitPosthogLog, flushPosthogLogs } from "@/instrumentation";
import { pushConfig, type PushConfig } from "./config";
import { buildPaidPayload } from "./payload";
import { pushStore, type DeviceSubscription, type PushStore } from "./store";

export type PaidPayee = { emailHash: Hex; amount: bigint };
export type PushCounts = { payees: number; sent: number; removed: number; failed: number };

/** Sends one push; rejects with an error carrying the push service's statusCode on failure. */
export type PushSend = (sub: DeviceSubscription, payload: string) => Promise<unknown>;

/** The push service says this device is gone for good: forget it. */
const GONE = new Set([404, 410]);

/**
 * One "You've been paid" push per subscribed device for each payee (several payments to the same
 * email in one payout add up into one notification). Never throws.
 */
export async function sendPaidNotifications(
  payees: PaidPayee[],
  deps: { store: PushStore; send: PushSend; platformName: string },
): Promise<PushCounts> {
  const totals = new Map<Hex, bigint>();
  for (const p of payees) {
    const h = p.emailHash.toLowerCase() as Hex;
    totals.set(h, (totals.get(h) ?? 0n) + p.amount);
  }
  const counts: PushCounts = { payees: 0, sent: 0, removed: 0, failed: 0 };

  await Promise.all(
    [...totals].map(async ([emailHash, amount]) => {
      const devices = await deps.store.list(emailHash).catch(() => [] as DeviceSubscription[]);
      if (devices.length) counts.payees++;
      const payload = JSON.stringify(buildPaidPayload({ amount, platformName: deps.platformName }));
      await Promise.all(
        devices.map(async (sub) => {
          try {
            await deps.send(sub, payload);
            counts.sent++;
          } catch (err) {
            const status = (err as { statusCode?: unknown })?.statusCode;
            if (typeof status === "number" && GONE.has(status)) {
              await deps.store.remove(emailHash, sub.endpoint).catch(() => {});
              counts.removed++;
            } else {
              counts.failed++;
            }
          }
        }),
      );
    }),
  );
  return counts;
}

export function webPushSender(vapid: PushConfig["vapid"]): PushSend {
  return (sub, payload) =>
    webpush.sendNotification(sub, payload, {
      vapidDetails: vapid,
      TTL: 24 * 60 * 60,
      urgency: "high",
      timeout: 10_000,
    });
}

/**
 * Called after claim emails go out. Off unless push is configured; errors are logged (status
 * only, nothing about the payee) and swallowed so they can never affect the emails.
 */
export async function notifyPaid(payees: PaidPayee[], platformName: string): Promise<void> {
  const config = pushConfig();
  if (!config || payees.length === 0) return;
  try {
    const counts = await sendPaidNotifications(payees, { store: pushStore(config), send: webPushSender(config.vapid), platformName });
    if (counts.payees > 0) {
      emitPosthogLog("push_sent", SeverityNumber.INFO, { route: "/api/claims/email", ...counts });
      await flushPosthogLogs();
    }
  } catch (err) {
    console.error("[push] paid notifications failed", err instanceof Error ? err.name : "unknown");
  }
}
