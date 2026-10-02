"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Check, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { config } from "@/lib/config";
import { indexerEnabled } from "@/lib/fanout/indexer";
import { useFanoutClient } from "@/lib/fanout/use-fanout-client";
import { decodePassport, monthLabel, verifyPassport, type Passport } from "@/lib/payee/passport";

// The passport rides in the URL fragment (#p=...), which browsers never send to a server.
const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

const issued = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

export function VerifyView() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => null);
  if (hash === null) return <Checking />;
  const encoded = new URLSearchParams(hash.slice(1)).get("p");
  const passport = encoded ? decodePassport(encoded) : null;
  if (!passport) {
    return (
      <Notice
        title="This link isn't a valid Earnings Passport"
        body="Ask the person who sent it to share the full link again."
      />
    );
  }
  // Onchain, payout history for any account comes from the indexer; without it we can't check.
  if (!config.useMock && !indexerEnabled()) {
    return <Notice title="This passport can't be checked here" body="Earnings checks aren't switched on for this site yet." />;
  }
  return <Verify key={encoded} passport={passport} />;
}

function Verify({ passport }: { passport: Passport }) {
  const client = useFanoutClient();
  const [now] = useState(() => Date.now());
  const s = passport.statement;
  const check = useQuery({
    queryKey: ["passport", s.account, passport.sig],
    queryFn: async () => verifyPassport(passport, await client.getPayeeHistory(s.account), now),
    retry: 1,
  });

  if (check.isPending) return <Checking />;
  if (check.isError) {
    return (
      <Notice title="We couldn't check this right now" body="Check your connection and try again.">
        <Button className="w-full" size="lg" onClick={() => void check.refetch()}>
          Try again
        </Button>
      </Notice>
    );
  }

  const verdict = check.data;
  const amount = `$${s.minMonthlyUsd.toLocaleString("en-US")}`;
  const period = s.months.length === 1 ? monthLabel(s.months[0]) : `${monthLabel(s.months[0])} to ${monthLabel(s.months.at(-1)!)}`;

  if (!verdict.ok) {
    const body =
      verdict.reason === "signature"
        ? "The signatures on this passport don't match. It may have been edited."
        : verdict.reason === "future"
          ? "This passport claims months that haven't happened yet."
          : verdict.reason === "short-month"
            ? `The payouts on record don't reach ${amount} in ${monthLabel(verdict.detail!)}.`
            : "The payouts on record come from fewer platforms than this passport claims.";
    return (
      <div className="flex flex-1 flex-col gap-6 px-5 pt-8 pb-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger" aria-hidden>
            <CircleAlert className="size-7" />
          </span>
          <h1 className="font-display text-[28px] leading-tight tracking-[-0.02em]">Not verified</h1>
          <p className="text-muted">{body}</p>
        </div>
        <HowItWorks />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-5 pt-8 pb-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-mint-surface text-success" aria-hidden>
          <BadgeCheck className="size-7" />
        </span>
        <p className="text-sm font-bold tracking-[0.08em] text-success uppercase">Verified earnings</p>
        <h1 className="font-display text-[clamp(28px,8vw,36px)] leading-tight tracking-[-0.02em] text-balance">
          At least {amount} a month
        </h1>
        <p className="text-muted">
          {period}, paid by {s.platforms} {s.platforms === 1 ? "platform" : "platforms"}
        </p>
      </div>

      <ul aria-label="Months checked" className="overflow-hidden rounded-lg border border-line bg-surface">
        {s.months.map((m) => (
          <li key={m} className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0">
            <span className="font-semibold">{monthLabel(m)}</span>
            <span className="flex items-center gap-1.5 text-sm text-success">
              <Check aria-hidden className="size-4" /> {amount} or more
            </span>
          </li>
        ))}
      </ul>

      <p className="text-center text-sm text-balance text-muted">Signed with the payee&apos;s passkey on {issued.format(s.issuedAt)}.</p>
      <HowItWorks />
    </div>
  );
}

function HowItWorks() {
  return (
    <details className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold">How this is checked</summary>
      <div className="mt-2 flex flex-col gap-2 text-muted">
        <p>
          Platforms pay people through Fanout, and every payout is recorded on a public ledger. This page adds up the payouts
          this person actually received in each month and checks them against the claim. It doesn&apos;t show the individual
          payments.
        </p>
        <p>
          The claim is signed with a key from the person&apos;s passkey, so it can&apos;t be edited without breaking the
          signature.
        </p>
        <p>
          <Link href="/" className="font-semibold text-foreground underline underline-offset-4">
            What is Fanout?
          </Link>
        </p>
      </div>
    </details>
  );
}

function Checking() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5" aria-busy="true" aria-label="Checking this passport">
      <Skeleton className="size-14 rounded-full" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-48" />
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
