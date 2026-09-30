"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import posthog from "posthog-js";
import { keccak256, toBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createConfig, http, WagmiProvider } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { activeChain } from "@/lib/chains";
import { normalizeEmail } from "@/lib/email-hash";
import { AuthContext } from "./context";
import type { AuthContextValue } from "./types";

/**
 * Stand-in for Privy when NEXT_PUBLIC_PRIVY_APP_ID isn't set. Email only, no
 * verification. Each email maps to a fixed local address so balances persist
 * across sign-ins. Dev only: never use with the onchain client.
 */

const SESSION_KEY = "fanout.mockauth.email";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function addressForEmail(email: string): Address {
  return privateKeyToAccount(keccak256(toBytes(`fanout-mock:${email}`))).address;
}

// Session lives in localStorage; useSyncExternalStore keeps SSR (no storage) and client in sync.
const sessionListeners = new Set<() => void>();
const sessionStore = {
  subscribe(cb: () => void) {
    sessionListeners.add(cb);
    window.addEventListener("storage", cb);
    return () => {
      sessionListeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  },
  /** null = signed out. */
  get(): string | null {
    try {
      return window.localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },
  /** undefined = not known yet (server render). */
  getServer: (): string | null | undefined => undefined,
  set(email: string | null) {
    try {
      if (email) window.localStorage.setItem(SESSION_KEY, email);
      else window.localStorage.removeItem(SESSION_KEY);
    } catch {
      // Storage blocked: session won't persist.
    }
    sessionListeners.forEach((cb) => cb());
  },
};

const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [],
  transports: { [activeChain.id]: http() },
  ssr: true,
});

export function MockAuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.getServer);
  const ready = session !== undefined;
  const email = session ?? null;
  const [open, setOpen] = useState(false);
  const identifiedAddress = useRef<Address | null>(null);

  useEffect(() => {
    if (!ready) return;

    if (!email) {
      if (identifiedAddress.current) {
        posthog.reset();
        identifiedAddress.current = null;
      }
      return;
    }

    const address = addressForEmail(email);
    if (identifiedAddress.current === address) return;
    if (identifiedAddress.current) posthog.reset();

    posthog.identify(address, { email });
    identifiedAddress.current = address;
  }, [ready, email]);

  const signIn = useCallback((value: string) => {
    sessionStore.set(value);
    setOpen(false);
  }, []);

  const logout = useCallback(async () => {
    posthog.reset();
    identifiedAddress.current = null;
    sessionStore.set(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      provider: "mock",
      ready,
      authenticated: !!email,
      user: email ? { email, address: addressForEmail(email) } : null,
      login: () => setOpen(true),
      logout,
    }),
    [ready, email, logout],
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <AuthContext.Provider value={value}>
        {children}
        <MockSignInDialog open={open} onOpenChange={setOpen} onSignIn={signIn} />
      </AuthContext.Provider>
    </WagmiProvider>
  );
}

function MockSignInDialog({
  open,
  onOpenChange,
  onSignIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignIn: (email: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const email = normalizeEmail(value);
    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setPending(true);
    await new Promise((r) => setTimeout(r, 600));
    setPending(false);
    setValue("");
    onSignIn(email);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in to Fanout</DialogTitle>
          <DialogDescription>Demo sign-in. Any email works.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mock-email">Email</Label>
            <Input
              id="mock-email"
              type="email"
              autoComplete="email"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={!!error}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Continue"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
