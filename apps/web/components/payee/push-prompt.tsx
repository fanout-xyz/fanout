"use client";

import { Bell, Mail, X } from "lucide-react";
import posthog from "posthog-js";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { isStandalone, usePush } from "@/lib/push/use-push";
import { cn } from "@/lib/utils";

/**
 * "You've been paid" notifications for payees: a gentle prompt (in the installed app, and after a
 * claim), the on/off toggle on the balance page, and the note shown when a notification is tapped.
 */

const DISMISSED = "fanout.pushPromptDismissed.v1";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

const noop = () => () => {};
const useStandalone = () => useSyncExternalStore(noop, isStandalone, () => false);

export function PushPrompt({ source, className }: { source: "claim" | "app"; className?: string }) {
  const push = usePush(source);
  const standalone = useStandalone();
  const [dismissed, setDismissed] = useState(readDismissed);

  const show = !dismissed && ((push.status === "off" && (source === "claim" || standalone)) || (push.status === "ios-install" && source === "claim"));
  if (!show) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED, "1");
    } catch {
      // ignore
    }
    posthog.capture("push_prompt_dismissed", { source });
  }

  async function turnOn() {
    const res = await push.enable();
    if (!res.ok) toast.error(res.error);
  }

  return (
    <aside aria-label="Payment notifications" className={className}>
      <div className="relative flex items-start gap-3 rounded-xl border border-line bg-surface p-4 pr-11 text-left">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-primary-solid text-primary-solid-fg">
          <Bell aria-hidden className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Get a notification when you&apos;re paid</p>
          {push.status === "ios-install" ? (
            <p className="mt-0.5 text-sm text-muted">Add Fanout to your Home Screen first, then turn notifications on from your balance.</p>
          ) : (
            <>
              <p className="mt-0.5 text-sm text-muted">We&apos;ll let you know the moment money is waiting for you.</p>
              <Button size="sm" className="mt-3" onClick={() => void turnOn()} disabled={push.busy}>
                {push.busy && <Spinner className="size-4" />}
                {push.needsSignIn ? "Sign in to turn on" : "Turn on"}
              </Button>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Not now"
          className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full text-muted outline-none hover:bg-card-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </aside>
  );
}

/** The on/off switch on the balance page. Hidden where notifications aren't set up or can't work. */
export function PushToggle({ className }: { className?: string }) {
  const push = usePush("balance");
  if (push.status === "loading" || push.status === "unavailable") return null;

  const on = push.status === "on";
  const canToggle = push.status === "on" || push.status === "off";
  const hint = {
    on: "We'll let you know when you're paid.",
    off: push.needsSignIn ? "Sign in with your email to turn this on." : "Get a notification when you're paid.",
    "ios-install": "Add Fanout to your Home Screen first, then turn this on from there.",
    denied: "Notifications are blocked for Fanout. Allow them in your settings, then come back.",
  }[push.status];

  async function toggle() {
    const res = on ? await push.disable() : await push.enable();
    if (!res.ok) toast.error(res.error);
  }

  return (
    <section aria-label="Payment notifications" className={cn("flex items-center gap-3 rounded-xl border border-line bg-surface p-4", className)}>
      <Bell aria-hidden className="size-5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p id="push-toggle-label" className="font-semibold">
          Payment notifications
        </p>
        <p className="mt-0.5 text-sm text-muted">{hint}</p>
      </div>
      {canToggle && (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="push-toggle-label"
          disabled={push.busy}
          onClick={() => void toggle()}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
            on ? "bg-primary-solid" : "bg-line",
          )}
        >
          <span
            aria-hidden
            className={cn("absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform", on && "translate-x-5")}
          />
        </button>
      )}
    </section>
  );
}

const readPaid = () => new URLSearchParams(window.location.search).get("paid") === "1";

/**
 * Shown when a "You've been paid" notification is tapped. The notification never carries the
 * claim link (the claim key only travels in the email), so this points to that email.
 */
export function PaidNotice({ className }: { className?: string }) {
  const paid = useSyncExternalStore(noop, readPaid, () => false);
  const [closed, setClosed] = useState(false);
  if (!paid || closed) return null;

  function close() {
    setClosed(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("paid");
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <aside role="status" className={className}>
      <div className="relative flex items-start gap-3 rounded-xl border border-line bg-surface p-4 pr-11 text-left">
        <Mail aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="font-semibold">You&apos;ve been paid</p>
          <p className="mt-0.5 text-sm text-muted">Open the email we just sent you and tap Claim to add it to your balance.</p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full text-muted outline-none hover:bg-card-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </aside>
  );
}
