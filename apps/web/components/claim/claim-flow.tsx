"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/provider";
import { activeChain } from "@/lib/chains";
import { claimVerifyingContract, config } from "@/lib/config";
import { claimSignerFromKey, parseClaimFragment, signClaim } from "@/lib/fanout/claim-keys";
import { NotFoundError } from "@/lib/fanout/client";
import { useFanoutClient } from "@/lib/fanout/use-fanout-client";
import { formatUsd, toCents } from "@/lib/money";
import { ClaimScreen, type ClaimScreenState } from "./claim-screen";

// The key lives in the URL fragment (#k=...), which browsers never send to a server.
const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function ClaimFlow() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => null);
  const privateKey: Hex | null | undefined = hash === null ? undefined : parseClaimFragment(hash);
  // Remount per link so state (claiming, success, errors) never carries over to another link.
  return <ClaimForKey key={privateKey ?? String(privateKey)} privateKey={privateKey} />;
}

function ClaimForKey({ privateKey }: { privateKey: Hex | null | undefined }) {
  const claimSigner = privateKey ? claimSignerFromKey(privateKey) : null;

  const client = useFanoutClient();
  const queryClient = useQueryClient();
  const { ready, authenticated, user, login, logout, provider } = useAuth();
  const reduced = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<ClaimScreenState>("ready");
  const [error, setError] = useState<string | null>(null);
  const [wantsClaim, setWantsClaim] = useState(false);
  const running = useRef(false);

  const info = useQuery({
    queryKey: ["fanout", "claim", claimSigner],
    queryFn: () => client.getClaim(claimSigner!),
    enabled: !!claimSigner,
    retry: (count, err) => !(err instanceof NotFoundError) && count < 2,
  });

  const recipient = user?.address;

  const runClaim = useCallback(
    async (to: Address) => {
      if (!privateKey || !claimSigner || running.current) return;
      running.current = true;
      setPhase("claiming");
      setError(null);
      try {
        const signature = await signClaim(privateKey, {
          recipient: to,
          claimContract: claimVerifyingContract(),
          chainId: activeChain.id,
        });
        await client.claim(claimSigner, to, signature);
        setPhase("success");
        // The key stays in the URL: once claimed it's spent (a second claim is refused), and
        // the page needs it to keep showing this payment.
        void queryClient.invalidateQueries({ queryKey: ["fanout"] });
      } catch (err) {
        console.error("[claim] failed", err instanceof Error ? err.message : err);
        setPhase("ready");
        setError(humanClaimError(err));
        void info.refetch();
      } finally {
        running.current = false;
        setWantsClaim(false);
      }
    },
    [privateKey, claimSigner, client, queryClient, info],
  );

  // After sign-in (and the account being ready), continue the claim the payee started.
  useEffect(() => {
    if (!(wantsClaim && authenticated && recipient && phase === "ready")) return;
    // Start on the next microtask rather than inside the effect body; `running` guards double starts.
    void Promise.resolve().then(() => runClaim(recipient));
  }, [wantsClaim, authenticated, recipient, phase, runClaim]);

  function onClaim() {
    setWantsClaim(true);
    if (!authenticated) login();
  }

  // --- Dead ends first ---------------------------------------------------------
  if (privateKey === undefined || (claimSigner && info.isPending)) return <Loading />;
  if (!privateKey || (info.isError && info.error instanceof NotFoundError)) {
    return (
      <Notice
        title="This link isn't valid"
        body="Open the full link from your email. If it still doesn't work, ask the sender to send it again."
      />
    );
  }
  if (info.isError) {
    return (
      <Notice title="We couldn't load your payment" body="Check your connection and try again.">
        <Button className="w-full" size="lg" onClick={() => void info.refetch()}>
          Try again
        </Button>
      </Notice>
    );
  }

  const claim = info.data!;
  const platform = config.platformName;
  const amountLabel = formatUsd(claim.amount);

  if (phase !== "success" && claim.status === "claimed") {
    return (
      <Notice title="This payment has already been claimed" body={`${amountLabel} from ${platform} was claimed with this link.`}>
        {authenticated && <BalanceLink />}
      </Notice>
    );
  }
  if (phase !== "success" && claim.status === "refunded") {
    return <Notice title="This link has expired" body={`Ask ${platform} to send your ${amountLabel} again.`} />;
  }

  const waitingForAccount = wantsClaim && authenticated && !recipient;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col">
        <ClaimScreen
          className="h-auto flex-1"
          state={waitingForAccount ? "claiming" : phase}
          amountCents={toCents(claim.amount)}
          platform={platform}
          onClaim={onClaim}
          reduced={reduced}
          showLogo={false}
          actionLabel={`Claim ${amountLabel}`}
          hint={!authenticated ? signInHint(provider) : undefined}
          error={error}
          successAction={<BalanceLink />}
        />
      </div>
      {ready && authenticated && phase !== "success" && (
        <p className="px-5 pb-6 text-center text-sm text-muted">
          Signed in as {user?.email ?? "you"}.{" "}
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-sm font-semibold text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Not you?
          </button>
        </p>
      )}
    </div>
  );
}

function signInHint(provider: "privy" | "mock") {
  return provider === "privy"
    ? "You'll confirm with your email or a passkey. Nothing to install."
    : "You'll confirm with your email. Nothing to install.";
}

/** Payee-facing wording; the raw error is logged, never shown. */
function humanClaimError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (/already been claimed/i.test(msg)) return "This payment has already been claimed.";
  if (/expired|returned to the sender/i.test(msg)) return "This link has expired. Ask the sender to send it again.";
  if (/reach the server|connection/i.test(msg)) return "You seem to be offline. Check your connection and try again.";
  if (err instanceof NotFoundError) return "This link isn't valid. Ask the sender to send it again.";
  return "Something went wrong and nothing was claimed. Try again in a moment.";
}

function BalanceLink() {
  return (
    <Button asChild size="lg" variant="secondary" className="h-14 w-full">
      <Link href="/wallet">See your balance</Link>
    </Button>
  );
}

function Loading() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5" aria-busy="true" aria-label="Loading your payment">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-16 w-56" />
      <Skeleton className="h-8 w-48 rounded-full" />
    </div>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 pb-10 text-center">
      <PetalsMark size={48} color="var(--primary)" cutColor="var(--bg)" />
      <h1 className="font-display text-[28px] leading-tight tracking-[-0.02em]">{title}</h1>
      <p className="text-muted">{body}</p>
      {children && <div className="mt-4 w-full">{children}</div>}
    </div>
  );
}
