"use client";

import type { Hex } from "viem";

/**
 * Where the platform keeps claim keys for a batch so the batch page can show links.
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
};

const key = (batchId: string) => `fanout.claims.v1.${batchId}`;

export function saveClaims(batchId: string, claims: StoredClaim[]): boolean {
  try {
    window.localStorage.setItem(key(batchId), JSON.stringify(claims));
    return true;
  } catch {
    return false;
  }
}

export function loadClaims(batchId: string): StoredClaim[] | null {
  try {
    const raw = window.localStorage.getItem(key(batchId));
    return raw ? (JSON.parse(raw) as StoredClaim[]) : null;
  } catch {
    return null;
  }
}
