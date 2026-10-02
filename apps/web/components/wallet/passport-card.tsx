"use client";

import { BadgeCheck, Copy, Share2 } from "lucide-react";
import posthog from "posthog-js";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/provider";
import { usePayeeHistory } from "@/lib/fanout/queries";
import { usePayeeAccount } from "@/lib/payee/payee-account";
import { PasskeyCancelled } from "@/lib/payee/passkey-account";
import { bestClaim, monthLabel, monthlyIncome, passportUrl, recentMonths } from "@/lib/payee/passport";
import { signPassport } from "@/lib/payee/passport-key";
import { cn } from "@/lib/utils";

const SPANS = [1, 3, 6] as const;

/**
 * Earnings Passport on the balance page: turn the payouts this account has claimed into a proof
 * of income ("at least $500 a month for 3 months, from 2 platforms") someone else can check.
 */
export function PassportCard() {
  const { user } = useAuth();
  const payee = usePayeeAccount();
  const history = usePayeeHistory();
  const [span, setSpan] = useState<(typeof SPANS)[number]>(1);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const [now] = useState(() => Date.now());
  const months = useMemo(() => recentMonths(span, now), [span, now]);
  const claim = useMemo(() => (history.data ? bestClaim(monthlyIncome(history.data, months)) : null), [history.data, months]);
  const period = months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} to ${monthLabel(months.at(-1)!)}`;

  if (!history.data) return null;
  const hasPayouts = history.data.some((i) => i.kind === "received" && i.payout);

  async function create() {
    if (!claim || !payee.address || !user?.email) return;
    setBusy(true);
    try {
      const passport = await signPassport(user.email, { account: payee.address, months, ...claim });
      setLink(passportUrl(window.location.origin, passport));
      posthog.capture("passport_created", { months: months.length, min_monthly_usd: claim.minMonthlyUsd, platforms: claim.platforms });
    } catch (err) {
      if (!(err instanceof PasskeyCancelled)) toast.error(err instanceof Error ? err.message : "Couldn't create your proof. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link!);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy. Press and hold the link to copy it.");
    }
  }

  async function share() {
    if (typeof navigator.share !== "function") return copy();
    try {
      await navigator.share({ title: "My earnings, verified by Fanout", url: link! });
    } catch {
      // Closed the share sheet.
    }
  }

  return (
    <section aria-labelledby="passport-title" className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-surface text-on-mint" aria-hidden>
          <BadgeCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="passport-title" className="text-lg font-bold tracking-[-0.01em]">
            Earnings Passport
          </h2>
          <p className="mt-0.5 text-sm text-muted">Prove what you earn, for rent, a loan or a visa. Your payments stay private.</p>
        </div>
      </div>

      {payee.kind !== "passkey" ? (
        <p className="mt-4 text-sm text-muted">Your passport needs an account with a passkey. Set one up on a phone that supports passkeys.</p>
      ) : !hasPayouts ? (
        <p className="mt-4 text-sm text-muted">Your passport starts with your first payout.</p>
      ) : link ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm">
            Anyone with this link can check that you earned at least <strong>${claim?.minMonthlyUsd.toLocaleString("en-US")} a month</strong>.
          </p>
          <input
            readOnly
            value={link}
            aria-label="Your Earnings Passport link"
            onFocus={(e) => e.currentTarget.select()}
            className="h-11 w-full truncate rounded-sm border border-line bg-card-raised px-3 font-mono text-xs text-muted"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => void copy()}>
              <Copy aria-hidden className="size-4" /> Copy
            </Button>
            <Button onClick={() => void share()}>
              <Share2 aria-hidden className="size-4" /> Share
            </Button>
          </div>
          <a href={link} target="_blank" rel="noreferrer" className="text-center text-sm font-semibold underline underline-offset-4">
            See what they&apos;ll see
          </a>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div role="radiogroup" aria-label="Period to prove" className="grid grid-cols-3 gap-1 rounded-md bg-card-raised p-1">
            {SPANS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={span === n}
                onClick={() => setSpan(n)}
                className={cn(
                  "h-9 rounded-sm text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  span === n ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
                )}
              >
                {n === 1 ? "This month" : `${n} months`}
              </button>
            ))}
          </div>
          {claim ? (
            <p className="text-[15px]">
              You can prove at least <strong>${claim.minMonthlyUsd.toLocaleString("en-US")} a month</strong> for {period}, from{" "}
              {claim.platforms} {claim.platforms === 1 ? "platform" : "platforms"}.
            </p>
          ) : (
            <p className="text-sm text-muted">Not every month in {period} had payouts. Pick a shorter period.</p>
          )}
          <Button size="lg" className="h-12 w-full" disabled={!claim || busy} onClick={() => void create()} aria-busy={busy}>
            {busy ? (
              <>
                <Spinner className="size-4" /> Confirm with your passkey…
              </>
            ) : (
              "Create proof"
            )}
          </Button>
        </div>
      )}
    </section>
  );
}
