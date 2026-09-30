"use client";

import type { Hex } from "viem";

/**
 * Where the platform keeps claim keys so the batch page can show links.
 *
 * Keys are stored by claim address (not batch number), so they can be saved
 * BEFORE the payout is submitted: if saving fails, nothing is sent, and money
 * never goes out without its links.
 *
 * DEMO ONLY: keys live in this browser's localStorage. Each key is a bearer
 * credential for one payout: anyone holding it can claim that money. A real
 * deployment would email the link and not keep the key at all, or hold it
 * server-side, encrypted, with a short retention window (EU data rules apply
 * to the email addresses too).
 */

export type StoredClaim = {
  claimSigner: Hex;
  privateKey: Hex;
  email: string;
  note: string;
  /** When the link was last emailed to the payee (unix ms). Missing = never emailed. */
  emailedAt?: number;
};

type ClaimMap = Record<string, StoredClaim>; // lowercased claimSigner -> claim

const KEY = "fanout.claims.v2";
const LEGACY_PREFIX = "fanout.claims.v1."; // per-batch arrays from earlier builds

let cache: { raw: string | null; map: ClaimMap } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** For useSyncExternalStore: fires after this tab saves or updates claims. */
export function subscribeClaims(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readMap(): ClaimMap {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return cache?.map ?? {};
  }
  if (cache && cache.raw === raw) return cache.map;
  const map: ClaimMap = {};
  try {
    // Fold in legacy per-batch entries so links from earlier builds still show.
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k?.startsWith(LEGACY_PREFIX)) continue;
      for (const c of JSON.parse(window.localStorage.getItem(k) ?? "[]") as StoredClaim[]) map[c.claimSigner.toLowerCase()] = c;
    }
    Object.assign(map, raw ? (JSON.parse(raw) as ClaimMap) : {});
  } catch {
    // Corrupt entry: show what we could read.
  }
  cache = { raw, map };
  return map;
}

/** Adds claims. Returns false if storage is unavailable or full (caller must not send). */
export function saveClaims(claims: StoredClaim[]): boolean {
  try {
    const map = { ...readMap() };
    for (const c of claims) map[c.claimSigner.toLowerCase()] = c;
    const raw = JSON.stringify(map);
    window.localStorage.setItem(KEY, raw);
    cache = { raw, map };
    notify();
    return true;
  } catch {
    return false;
  }
}

/** Records that these links were emailed. Best effort: a storage failure only loses the timestamp. */
export function markEmailed(claimSigners: string[], at = Date.now()): void {
  const map = { ...readMap() };
  for (const s of claimSigners) {
    const c = map[s.toLowerCase()];
    if (c) map[s.toLowerCase()] = { ...c, emailedAt: at };
  }
  try {
    const raw = JSON.stringify(map);
    window.localStorage.setItem(KEY, raw);
    cache = { raw, map };
  } catch {
    // Storage failed: keep the timestamps for this session so the page still shows them.
    cache = { raw: cache?.raw ?? null, map };
  }
  notify();
}

/** All claims this browser knows about. Stable object between saves (safe for useSyncExternalStore). */
export function loadAllClaims(): ClaimMap {
  return readMap();
}
