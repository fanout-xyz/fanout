"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useAuth } from "@/lib/auth/provider";
import { normalizeEmail } from "@/lib/email-hash";
import {
  createPasskeyAccount,
  loadRecord,
  passkeysAvailable,
  unlockPasskeyAccount,
  type PasskeyAccountRecord,
  type UnlockedAccount,
} from "./passkey-account";

/**
 * Where a payee's money lives. Normally their Mera passkey account (see passkey-account.ts). If
 * their device can't make that kind of passkey, they can fall back to the account that comes with
 * email sign-in, so nobody is locked out of their money.
 */
type PayeeAccount = {
  /** "passkey": Mera account; "email": sign-in account fallback; "none": not set up on this device. */
  kind: "passkey" | "email" | "none";
  /** Where claims are paid and whose balance is shown. Undefined until set up. */
  address?: Address;
  passkeysAvailable: boolean;
  record: PasskeyAccountRecord | null;
  /** Makes a passkey account (Face ID / Touch ID). Resolves with its address. */
  create: () => Promise<Address>;
  /** Opens the passkey account for signing (one prompt). End the session when done. */
  unlock: () => Promise<UnlockedAccount>;
  /** Uses the sign-in account instead, on this device. */
  chooseEmailAccount: () => void;
};

const FALLBACK_STORE = "fanout.payeeEmailAccount.v1";

function fallbackEmails(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(FALLBACK_STORE) ?? "[]") as string[];
  } catch {
    return [];
  }
}

const Ctx = createContext<PayeeAccount | null>(null);

export function PayeeAccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const email = user?.email;
  // Bumped after any change so the memo below re-reads localStorage.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo<PayeeAccount>(() => {
    const record = typeof window !== "undefined" && email ? loadRecord(email) : null;
    const usesEmail = typeof window !== "undefined" && !!email && fallbackEmails().includes(normalizeEmail(email));
    const kind = record ? "passkey" : usesEmail ? "email" : "none";
    const need = () => {
      if (!email) throw new Error("Sign in first.");
      return email;
    };
    return {
      kind,
      address: record?.address ?? (usesEmail ? user?.address : undefined),
      passkeysAvailable: typeof window !== "undefined" && passkeysAvailable(),
      record,
      create: async () => {
        const unlocked = await createPasskeyAccount(need());
        unlocked.end(); // claiming only needs the address; sending unlocks again
        bump();
        return unlocked.address;
      },
      unlock: async () => {
        const unlocked = await unlockPasskeyAccount(need());
        bump();
        return unlocked;
      },
      chooseEmailAccount: () => {
        const e = normalizeEmail(need());
        try {
          window.localStorage.setItem(FALLBACK_STORE, JSON.stringify([...new Set([...fallbackEmails(), e])]));
        } catch {
          // ignore: it just asks again next visit
        }
        bump();
      },
    };
    // `version` forces a re-read after create/unlock/fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, user?.address, version, bump]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePayeeAccount(): PayeeAccount {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePayeeAccount needs PayeeAccountProvider");
  return v;
}
