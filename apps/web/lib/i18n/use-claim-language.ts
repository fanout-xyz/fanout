"use client";

import { useSyncExternalStore } from "react";
import { normalizeLanguage, type Lang } from "./languages";

/** The payee's own language choice on this device (the switcher on the claim page). */
const KEY = "fanout.lang";
const listeners = new Set<() => void>();

const store = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    window.addEventListener("storage", cb);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  },
  get(): string | null {
    try {
      return window.localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(lang: Lang) {
    try {
      window.localStorage.setItem(KEY, lang);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
      memory = lang;
    }
    listeners.forEach((cb) => cb());
  },
};
let memory: Lang | null = null;

/**
 * [language, choose]. `initial` is what the server picked (the payout's ?lang=, else Accept-Language);
 * a choice made on this device wins over it.
 */
export function useClaimLanguage(initial: Lang): [Lang, (lang: Lang) => void] {
  const saved = useSyncExternalStore(store.subscribe, () => store.get() ?? memory, () => null);
  return [normalizeLanguage(saved) ?? initial, store.set];
}
