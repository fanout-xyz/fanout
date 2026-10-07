"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useAuth } from "@/lib/auth/provider";
import { normalizeEmail } from "@/lib/email-hash";
import { forgetPushOnThisDevice } from "@/lib/push/use-push";
import { markUnlocked } from "./app-lock";
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
 *
 * A passkey account opens without email sign-in: this device remembers the last one used, so when
 * the sign-in session runs out the payee still gets in with Face ID / fingerprint / screen lock.
 * Only what needs to prove the email (claiming, paying by email) asks them to sign in again.
 */
type PayeeAccount = {
  /** "passkey": Mera account; "email": sign-in account fallback; "none": not set up on this device. */
  kind: "passkey" | "email" | "none";
  /** Whose account this is: the signed-in email, or the passkey account remembered on this device. */
  email?: string;
  /** True when signed in with email (not just opened with the passkey). */
  signedIn: boolean;
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
  /** Signs out and stops this device opening the account with the passkey alone. */
  signOut: () => Promise<void>;
};

const FALLBACK_STORE = "fanout.payeeEmailAccount.v1";
/** The email of the passkey account this device opens when not signed in. */
const REMEMBERED_STORE = "fanout.payeeRememberedAccount.v1";

function rememberedEmail(): string | null {
  try {
    return window.localStorage.getItem(REMEMBERED_STORE);
  } catch {
    return null;
  }
}

function remember(email: string | null): void {
  try {
    if (email) window.localStorage.setItem(REMEMBERED_STORE, normalizeEmail(email));
    else window.localStorage.removeItem(REMEMBERED_STORE);
  } catch {
    // ignore: they sign in with email next time instead
  }
}

function fallbackEmails(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(FALLBACK_STORE) ?? "[]") as string[];
  } catch {
    return [];
  }
}

const Ctx = createContext<PayeeAccount | null>(null);

export function PayeeAccountProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, logout } = useAuth();
  // Bumped after any change so the memo below re-reads localStorage.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo<PayeeAccount>(() => {
    const browser = typeof window !== "undefined";
    // Signed out (session ran out): fall back to the passkey account this device remembers.
    const remembered = browser && ready && !authenticated ? rememberedEmail() : null;
    const email = user?.email ?? (remembered && loadRecord(remembered) ? remembered : undefined);
    const record = browser && email ? loadRecord(email) : null;
    const usesEmail = typeof window !== "undefined" && !!email && fallbackEmails().includes(normalizeEmail(email));
    const kind = record ? "passkey" : usesEmail ? "email" : "none";
    const need = () => {
      if (!email) throw new Error("Sign in first.");
      return email;
    };
    return {
      kind,
      email,
      signedIn: authenticated,
      address: record?.address ?? (usesEmail ? user?.address : undefined),
      passkeysAvailable: typeof window !== "undefined" && passkeysAvailable(),
      record,
      create: async () => {
        const unlocked = await createPasskeyAccount(need());
        unlocked.end(); // claiming only needs the address; sending unlocks again
        markUnlocked(need());
        remember(need());
        bump();
        return unlocked.address;
      },
      unlock: async () => {
        const unlocked = await unlockPasskeyAccount(need());
        markUnlocked(need());
        remember(need());
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
      signOut: async () => {
        remember(null);
        // Signed out, this device stops getting "You've been paid" for this account.
        await forgetPushOnThisDevice();
        await logout();
        bump();
      },
    };
    // `version` forces a re-read after create/unlock/fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, user?.email, user?.address, logout, version, bump]);

  // Payees who opened their passkey account before this device remembered it.
  useEffect(() => {
    if (authenticated && value.kind === "passkey" && value.email) remember(value.email);
  }, [authenticated, value.kind, value.email]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePayeeAccount(): PayeeAccount {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePayeeAccount needs PayeeAccountProvider");
  return v;
}
