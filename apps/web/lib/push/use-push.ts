"use client";

import posthog from "posthog-js";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/auth/provider";
import { pushSupport, vapidKeyBytes } from "./device";

/**
 * "You've been paid" notifications on this device: whether they're available, on or off, and the
 * taps that change it. One shared state, so the prompt and the balance toggle stay in step.
 *
 * Permission is only ever asked from a tap (enable), never on page load.
 */

export type PushStatus =
  | "loading"
  /** Not set up on this site, or this browser can't do it: show nothing. */
  | "unavailable"
  /** iPhone/iPad in Safari: works once Fanout is on the Home Screen. */
  | "ios-install"
  /** The person blocked notifications for this site in their settings. */
  | "denied"
  | "off"
  | "on";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

let status = "loading" as PushStatus;
let busy = false;
let snapshot: { status: PushStatus; busy: boolean } = { status, busy };
const listeners = new Set<() => void>();
const set = (next: Partial<{ status: PushStatus; busy: boolean }>) => {
  if (next.status !== undefined) status = next.status;
  if (next.busy !== undefined) busy = next.busy;
  snapshot = { status, busy };
  listeners.forEach((l) => l());
};
const SERVER_SNAPSHOT = { status: "loading" as PushStatus, busy: false };

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

let serverEnabled: Promise<boolean> | null = null;
function enabledOnServer(): Promise<boolean> {
  return (serverEnabled ??= fetch("/api/push/subscribe")
    .then((r) => r.json())
    .then((b: { enabled?: unknown }) => b.enabled === true)
    .catch(() => false));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

let checking: Promise<void> | null = null;
function refresh(): Promise<void> {
  return (checking ??= (async () => {
    try {
      if (!VAPID_PUBLIC_KEY) return set({ status: "unavailable" });
      const support = pushSupport({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        standalone: isStandalone(),
        hasPushApis: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
      });
      if (support === "unsupported" || !(await enabledOnServer())) return set({ status: "unavailable" });
      if (support === "ios-install") return set({ status: "ios-install" });
      if (Notification.permission === "denied") return set({ status: "denied" });
      set({ status: Notification.permission === "granted" && (await currentSubscription()) ? "on" : "off" });
    } catch {
      set({ status: "unavailable" });
    } finally {
      checking = null;
    }
  })());
}

type Result = { ok: true } | { ok: false; error: string };

async function post(path: string, body: unknown, accessToken: string | null): Promise<Result> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: error ?? "Something went wrong. Try again." };
  } catch {
    return { ok: false, error: "You seem to be offline. Check your connection and try again." };
  }
}

/**
 * Turns notifications off in this browser, without asking the server (the next payout's push gets
 * a 410 and the server forgets the device). Used on sign-out so a shared device stops getting them.
 */
export async function forgetPushOnThisDevice(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    await (await currentSubscription())?.unsubscribe();
    if (status === "on") set({ status: "off" });
  } catch {
    // Nothing subscribed, or the browser refused: nothing more to do.
  }
}

export function usePush(source: "balance" | "claim" | "app") {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
  const { provider, authenticated, user, login, getAccessToken } = useAuth();

  useEffect(() => {
    if (status === "loading") void refresh();
  }, []);

  const needsSignIn = provider === "privy" && !authenticated;
  const mockEmail = provider === "mock" ? user?.email : undefined;

  const enable = useCallback(async (): Promise<Result> => {
    if (needsSignIn) {
      login();
      return { ok: false, error: "Sign in with your email first." };
    }
    if (busy || !VAPID_PUBLIC_KEY) return { ok: false, error: "Notifications aren't available right now." };
    set({ busy: true });
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        set({ status: permission === "denied" ? "denied" : "off" });
        return { ok: false, error: "Notifications weren't allowed." };
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(VAPID_PUBLIC_KEY) }));
      const saved = await post("/api/push/subscribe", { subscription: sub.toJSON(), mockEmail }, (await getAccessToken?.()) ?? null);
      if (!saved.ok) {
        await sub.unsubscribe().catch(() => {});
        set({ status: "off" });
        return saved;
      }
      posthog.capture("push_enabled", { source, standalone: isStandalone() });
      set({ status: "on" });
      return { ok: true };
    } catch {
      set({ status: "off" });
      return { ok: false, error: "Couldn't turn on notifications on this device." };
    } finally {
      set({ busy: false });
    }
  }, [needsSignIn, login, mockEmail, getAccessToken, source]);

  const disable = useCallback(async (): Promise<Result> => {
    if (busy) return { ok: false, error: "One moment." };
    set({ busy: true });
    try {
      const sub = await currentSubscription();
      if (sub) {
        // Tell the server first while the endpoint still exists; if that fails the 410 cleans up later.
        await post("/api/push/unsubscribe", { endpoint: sub.endpoint, mockEmail }, (await getAccessToken?.()) ?? null);
        await sub.unsubscribe();
      }
      posthog.capture("push_disabled", { source });
      set({ status: "off" });
      return { ok: true };
    } catch {
      return { ok: false, error: "Couldn't turn off notifications. Try again." };
    } finally {
      set({ busy: false });
    }
  }, [mockEmail, getAccessToken, source]);

  return { status: state.status, busy: state.busy, needsSignIn, enable, disable };
}
