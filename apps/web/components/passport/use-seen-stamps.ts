"use client";

import { useEffect, useState } from "react";

const KEY = "fanout.passportStampsSeen.v1";

function read(account: string): Set<string> | null {
  try {
    const all = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, string[]>;
    const list = all[account.toLowerCase()];
    return list ? new Set(list) : null;
  } catch {
    return null;
  }
}

function write(account: string, ids: string[]) {
  try {
    const all = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, string[]>;
    all[account.toLowerCase()] = ids;
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Not fatal: the stamps play their entrance again next time.
  }
}

/**
 * Which stamps this device has already shown, so each one lands with its stamp-in only once.
 * Returns the ids that are new on this visit. They're remembered as seen once `shown` is true
 * (the stamps have scrolled into view and played).
 */
export function useFreshStamps(account: string | undefined, ids: string[], shown: boolean): Set<string> {
  // Captured on first render: later renders keep the same answer.
  const [fresh] = useState(() => {
    if (!account || typeof window === "undefined") return new Set<string>();
    const seen = read(account) ?? new Set<string>();
    return new Set(ids.filter((id) => !seen.has(id)));
  });
  const key = ids.join(",");
  useEffect(() => {
    if (shown && account && key) write(account, key.split(","));
  }, [shown, account, key]);
  return fresh;
}
