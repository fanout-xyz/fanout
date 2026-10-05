"use client";

import type { ReactNode } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountSetup } from "@/components/payee/account-setup";
import { useAuth } from "@/lib/auth/provider";
import { useAppUnlocked } from "@/lib/payee/app-lock";
import { usePayeeAccount } from "@/lib/payee/payee-account";
import { AppLockScreen } from "./app-lock-screen";

/**
 * Payee pages: show children only once there's an account ready and it's unlocked on this visit.
 * A passkey account remembered on this device opens with the passkey alone, even after the email
 * sign-in session has run out.
 */
export function PayeeAuthGate({ children }: { children: ReactNode }) {
  const { ready, authenticated, login } = useAuth();
  const payee = usePayeeAccount();
  const unlocked = useAppUnlocked(payee.email);

  if (!ready) {
    return (
      <div className="flex flex-col gap-4 px-5 pt-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (!authenticated && payee.kind !== "passkey") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 pb-10 text-center">
        <PetalsMark size={48} color="var(--primary)" cutColor="var(--bg)" />
        <h1 className="font-display text-[28px] leading-tight tracking-[-0.02em]">See your balance</h1>
        <p className="text-muted">Sign in with the email you were paid at.</p>
        <Button size="lg" className="mt-4 h-14 w-full" onClick={login}>
          Sign in
        </Button>
      </div>
    );
  }
  // Signed in on a device that hasn't opened this payee's account yet.
  if (payee.kind === "none") return <AccountSetup mode="open" />;
  if (!payee.address) {
    return (
      <p className="flex items-center justify-center gap-2 px-5 pt-10 text-muted" role="status">
        <Spinner className="size-4" /> Setting up your account…
      </p>
    );
  }
  // A passkey account opens behind Face ID / fingerprint / screen lock, like a bank app. The email
  // fallback has no passkey to ask for, so it opens as before.
  if (payee.kind === "passkey" && !unlocked) return <AppLockScreen />;
  return <>{children}</>;
}
