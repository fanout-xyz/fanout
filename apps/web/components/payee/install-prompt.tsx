"use client";

import { Plus, Share, X } from "lucide-react";
import Image from "next/image";
import posthog from "posthog-js";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

/**
 * "Add Fanout to your home screen", for payees. Chrome and Android offer a real install prompt
 * (beforeinstallprompt); iPhone Safari has none, so it shows the two taps instead. Hidden once
 * installed, when dismissed, and everywhere else.
 */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISMISSED = "fanout.installDismissed.v1";
const listeners = new Set<() => void>();
let deferred: InstallEvent | null = null;
let dismissed = false;

const notify = () => listeners.forEach((l) => l());

// The browser fires this once, early, possibly before the prompt mounts: keep it for later.
if (typeof window !== "undefined") {
  try {
    dismissed = window.localStorage.getItem(DISMISSED) === "1";
  } catch {
    // Storage blocked: the prompt can come back next visit.
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    posthog.capture("app_installed");
    notify();
  });
}

type Mode = "none" | "prompt" | "ios";

function currentMode(): Mode {
  if (dismissed) return "none";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return "none";
  if (deferred) return "prompt";
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  // Only Safari can add to the home screen; in-app browsers (Instagram, Gmail) and Chrome on iOS can't.
  const safari = /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|GSA|Instagram|FBAN|FBAV|Line\//.test(ua);
  return iOS && safari ? "ios" : "none";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function dismiss() {
  dismissed = true;
  try {
    window.localStorage.setItem(DISMISSED, "1");
  } catch {
    // ignore
  }
  posthog.capture("install_prompt_dismissed");
  notify();
}

export function InstallPrompt({ className }: { className?: string }) {
  const mode = useSyncExternalStore(subscribe, currentMode, () => "none" as Mode);
  if (mode === "none") return null;

  async function install() {
    if (!deferred) return;
    posthog.capture("install_prompt_shown");
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") deferred = null;
    notify();
  }

  return (
    <aside aria-label="Add Fanout to your home screen" className={className}>
      <div className="relative flex items-start gap-3 rounded-xl border border-line bg-surface p-4 pr-11 text-left">
        <Image src="/icon-192.png" alt="" width={40} height={40} className="size-10 shrink-0 rounded-[10px]" />
        <div className="min-w-0">
          <p className="font-semibold">Keep Fanout on your home screen</p>
          {mode === "prompt" ? (
            <>
              <p className="mt-0.5 text-sm text-muted">Open your balance in one tap, like a bank app.</p>
              <Button size="sm" className="mt-3" onClick={() => void install()}>
                Add to home screen
              </Button>
            </>
          ) : (
            <p className="mt-0.5 text-sm text-muted">
              Tap <Share aria-label="Share" className="inline size-4 -translate-y-px align-middle" /> then{" "}
              <span className="font-semibold text-foreground">
                Add to Home Screen <Plus aria-hidden className="inline size-3.5 -translate-y-px rounded-[3px] border border-current align-middle" />
              </span>
            </p>
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
