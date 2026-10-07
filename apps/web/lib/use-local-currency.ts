"use client";

import { useQuery } from "@tanstack/react-query";
import posthog from "posthog-js";
import { useCallback, useSyncExternalStore } from "react";
import { guessLocalCurrency, isLocalCurrency, type FxRates, type LocalCurrency } from "./fx";

// The payee's pick, per device. "USD" means they chose dollars only.
const STORAGE_KEY = "fanout.localCurrency";
const listeners = new Set<() => void>();
// Fallback when storage is blocked (private mode): the choice lasts until reload.
let memoryChoice: string | null = null;

function readChoice(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memoryChoice;
  } catch {
    return memoryChoice;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function currentCurrency(): LocalCurrency | null {
  const saved = readChoice();
  if (saved === "USD") return null;
  if (isLocalCurrency(saved)) return saved;
  return guessLocalCurrency(Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.languages ?? [navigator.language]);
}

export function useFxRates() {
  return useQuery({
    queryKey: ["fx"],
    queryFn: async (): Promise<FxRates> => {
      const res = await fetch("/api/fx");
      if (!res.ok) throw new Error(`fx ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60_000,
    retry: 1,
  });
}

/** The payee's local currency (null = dollars only) and a setter that remembers it on this device. */
export function useLocalCurrency() {
  // Server snapshot is null, so the first render matches SSR and the local line appears after hydration.
  const currency = useSyncExternalStore(subscribe, currentCurrency, () => null);

  const setCurrency = useCallback((next: LocalCurrency | null) => {
    memoryChoice = next ?? "USD";
    try {
      window.localStorage.setItem(STORAGE_KEY, memoryChoice);
    } catch {
      // Storage blocked; memoryChoice covers this session.
    }
    listeners.forEach((l) => l());
    posthog.capture("local_currency_changed", { currency: next ?? "USD" });
  }, []);

  return { currency, setCurrency };
}
