"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Check, CircleAlert } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Button } from "@/components/ui/button";
import { config } from "@/lib/config";
import { indexerEnabled } from "@/lib/fanout/indexer";
import { useFanoutClient } from "@/lib/fanout/use-fanout-client";
import { decodePassport, monthLabel, verifyPassport, type Passport } from "@/lib/payee/passport";
import { decodeFields, shareCardFor, type ShareFields } from "@/lib/payee/passport-share";
import { cn } from "@/lib/utils";
import { ShareCard, type CardStatus } from "./share-card";

// The passport rides in the URL fragment (#p=...), which browsers never send to a server.
const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

const issued = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

export function VerifyView() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => null);
  if (hash === null) return <CheckingShell />;
  const params = new URLSearchParams(hash.slice(1));
  const encoded = params.get("p");
  const passport = encoded ? decodePassport(encoded) : null;
  if (!passport) {
    return (
      <Notice
        tone="danger"
        title="This link isn't a valid Earnings Passport"
        body="Part of the link may be missing. Ask the person who sent it to share the full link again."
      />
    );
  }
  // Onchain, payout history for any account comes from the indexer; without it we can't check.
  if (!config.useMock && !indexerEnabled()) {
    return <Notice title="This passport can't be checked here" body="Earnings checks aren't switched on for this site yet." />;
  }
  return <Verify key={encoded} passport={passport} fields={decodeFields(params.get("show"))} />;
}

function Verify({ passport, fields }: { passport: Passport; fields: ShareFields }) {
  const client = useFanoutClient();
  const reduced = useReducedMotion() ?? false;
  const [now] = useState(() => Date.now());
  const s = passport.statement;
  const check = useQuery({
    queryKey: ["passport", s.account, passport.sig],
    queryFn: async () => verifyPassport(passport, await client.getPayeeHistory(s.account), now),
    retry: 1,
  });

  const verdict = check.data;
  // The total isn't signed: when the payee chose to show it, it's the sum of the payouts just checked.
  const totalCents = verdict?.ok ? verdict.income.months.reduce((t, mo) => t + mo.cents, 0) : undefined;
  const card = shareCardFor(s, fields, totalCents);
  const status: CardStatus = check.isPending || check.isError ? "checking" : verdict?.ok ? "verified" : "failed";

  const amount = `$${s.minMonthlyUsd.toLocaleString("en-US")}`;
  const failure =
    verdict && !verdict.ok
      ? verdict.reason === "signature"
        ? "The signatures on this passport don't match. It may have been changed after it was made."
        : verdict.reason === "future"
          ? "This passport claims months that haven't happened yet."
          : verdict.reason === "short-month"
            ? fields.amount
              ? `The payouts on record don't reach ${amount} in ${monthLabel(verdict.detail!)}.`
              : `The payouts on record don't cover ${monthLabel(verdict.detail!)}.`
            : "The payouts on record come from fewer platforms than this passport claims."
      : null;

  return (
    <div className="flex flex-1 flex-col gap-6 px-5 pt-4 pb-12">
      <Headline status={status} reduced={reduced} />

      <m.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(16px) scale(0.98)" }}
        animate={{ opacity: status === "failed" ? 0.85 : 1, transform: "translateY(0px) scale(1)" }}
        transition={reduced ? { duration: 0.2 } : { type: "spring", duration: 0.6, bounce: 0.15 }}
      >
        <ShareCard card={card} status={status} reduced={reduced} />
      </m.div>

      {check.isError && (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4" role="alert">
          <p className="font-semibold">We couldn&apos;t check this right now</p>
          <p className="text-sm text-muted">Check your connection and try again.</p>
          <Button onClick={() => void check.refetch()}>Try again</Button>
        </div>
      )}

      {failure && (
        <p role="alert" className="flex gap-3 rounded-lg bg-danger/10 px-4 py-3 text-sm text-pretty">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          <span>{failure}</span>
        </p>
      )}

      {verdict?.ok && (
        <ul aria-label="Months checked" className="overflow-hidden rounded-lg border border-line bg-surface">
          {s.months.map((mo, i) => (
            <m.li
              key={mo}
              className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: 0.25 + i * 0.04 }}
            >
              <span className="font-semibold">{monthLabel(mo)}</span>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-success">
                <Check aria-hidden className="size-4" /> {fields.amount ? `${amount} or more` : "Paid"}
              </span>
            </m.li>
          ))}
        </ul>
      )}

      {verdict && (
        <p className="text-center text-sm text-balance text-muted">Signed with the earner&apos;s passkey on {issued.format(s.issuedAt)}.</p>
      )}
      <HowItWorks />
    </div>
  );
}

/** What a landlord or lender reads first: one big plain answer. */
function Headline({ status, reduced }: { status: CardStatus; reduced: boolean }) {
  const copy = {
    checking: { title: "Checking these earnings…", body: "Comparing this passport with the payouts on record." },
    preview: { title: "", body: "" },
    verified: { title: "Verified earnings", body: "This person was paid what the card says. We checked it against their payouts." },
    failed: { title: "Not verified", body: "This card doesn't match the payouts on record. Don't rely on it." },
  }[status];
  return (
    <div className="flex flex-col items-center gap-3 text-center" aria-live="polite">
      <span
        className={cn(
          "flex size-14 items-center justify-center rounded-full transition-colors duration-200",
          status === "verified" ? "bg-mint-surface text-success" : status === "failed" ? "bg-danger/10 text-danger" : "bg-card-raised text-muted",
        )}
        aria-hidden
      >
        {status === "verified" ? (
          <m.span initial={reduced ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 22 }}>
            <BadgeCheck className="size-7" />
          </m.span>
        ) : status === "failed" ? (
          <CircleAlert className="size-7" />
        ) : (
          <PetalsMark size={26} color="currentColor" cutColor="var(--card-raised)" />
        )}
      </span>
      <h1 className="font-display text-[clamp(28px,8vw,34px)] leading-tight tracking-[-0.02em] text-balance">{copy.title}</h1>
      <p className="max-w-[34ch] text-pretty text-muted">{copy.body}</p>
    </div>
  );
}

function HowItWorks() {
  return (
    <details className="group rounded-lg border border-line bg-surface px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold">How this is checked</summary>
      <div className="mt-2 flex flex-col gap-2 text-pretty text-muted">
        <p>
          Platforms pay people through Fanout, and every payout is recorded on a public ledger. This page adds up the payouts
          this person actually received in each month and checks them against the card. It doesn&apos;t show the individual
          payments.
        </p>
        <p>
          The card is signed with a key from the person&apos;s passkey, so it can&apos;t be changed without breaking the
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

function CheckingShell() {
  return (
    <div className="flex flex-1 flex-col gap-6 px-5 pt-4 pb-12" aria-busy="true" aria-label="Checking this passport">
      <Headline status="checking" reduced />
      <div className="h-[300px] rounded-xl bg-band-dark" />
    </div>
  );
}

function Notice({ title, body, tone }: { title: string; body: string; tone?: "danger" }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 pb-10 text-center">
      {tone === "danger" ? (
        <span className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger" aria-hidden>
          <CircleAlert className="size-7" />
        </span>
      ) : (
        <PetalsMark size={48} color="var(--primary)" cutColor="var(--bg)" />
      )}
      <h1 className="font-display text-[28px] leading-tight tracking-[-0.02em] text-balance">{title}</h1>
      <p className="max-w-[34ch] text-pretty text-muted">{body}</p>
      <Link href="/" className="mt-2 text-sm font-semibold underline underline-offset-4">
        What is Fanout?
      </Link>
    </div>
  );
}
