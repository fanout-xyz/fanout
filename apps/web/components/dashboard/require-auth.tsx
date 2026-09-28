"use client";

import type { ReactNode } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/provider";

/** Renders children only for a signed-in user with an account address. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login } = useAuth();

  if (!ready) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-44 w-full rounded-lg" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 rounded-lg border border-line bg-surface p-8 text-center">
        <PetalsMark size={48} cutColor="var(--card)" />
        <h1 className="font-display text-2xl tracking-[-0.015em]">Sign in to your dashboard</h1>
        <p className="text-muted">See your payout balance and send payouts.</p>
        <Button onClick={login} className="w-full">
          Sign in
        </Button>
      </div>
    );
  }

  if (!user?.address) {
    // Privy creates the embedded account right after first sign-in.
    return (
      <p className="flex items-center gap-2 text-muted" role="status">
        <Spinner className="size-4" /> Setting up your account…
      </p>
    );
  }

  return <>{children}</>;
}
