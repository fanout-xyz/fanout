"use client";

import { useSyncExternalStore } from "react";
import { normalizeEmail } from "@/lib/email-hash";

/**
 * The wallet's lock, like a bank app's: the balance stays hidden until the payee passes their
 * passkey (Face ID, fingerprint or the phone's screen lock) on this visit.
 *
 * Kept in memory only, so every cold start of the app is locked. It locks again after the app has
 * been in the background for RELOCK_AFTER_MS. Any passkey prompt the payee passes (setting up,
 * opening, sending) counts as unlocking, so they're never asked twice in a row. It's per email, so
 * signing out and in as someone else locks again.
 *
 * This hides the screen; it isn't what protects the money. Moving money always needs the passkey.
 */
const RELOCK_AFTER_MS = 5 * 60_000;

/** The email whose account is unlocked, or null. */
let unlockedFor: string | null = null;
let hiddenAt: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function markUnlocked(email: string): void {
  const e = normalizeEmail(email);
  if (unlockedFor === e) return;
  unlockedFor = e;
  emit();
}

function lock(): void {
  if (unlockedFor === null) return;
  unlockedFor = null;
  emit();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
    } else if (hiddenAt !== null) {
      if (Date.now() - hiddenAt >= RELOCK_AFTER_MS) lock();
      hiddenAt = null;
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True once `email`'s payee has passed a passkey prompt on this visit. False on the server. */
export function useAppUnlocked(email: string | undefined): boolean {
  const current = useSyncExternalStore(subscribe, () => unlockedFor, () => null);
  return !!email && current === normalizeEmail(email);
}
