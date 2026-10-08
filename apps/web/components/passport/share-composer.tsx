"use client";

import { Copy, Download, ExternalLink, Share2 } from "lucide-react";
import posthog from "posthog-js";
import { Switch } from "radix-ui";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import type { PayeeHistoryItem } from "@/lib/fanout/types";
import { PasskeyCancelled } from "@/lib/payee/passkey-account";
import { bestClaim, encodePassport, monthlyIncome, recentMonths, type Passport } from "@/lib/payee/passport";
import { signPassport } from "@/lib/payee/passport-key";
import { cardPeriod, cardQuery, claimToSign, DEFAULT_FIELDS, shareCardFor, shareUrl, type ShareFields } from "@/lib/payee/passport-share";
import { usePayeeAccount } from "@/lib/payee/payee-account";
import { cn } from "@/lib/utils";
import { BadgeSection } from "./badge-section";
import { ShareCard } from "./share-card";

const SPANS = [1, 3, 6, 12] as const;
type Span = (typeof SPANS)[number];

const FIELD_COPY: { key: keyof ShareFields; label: string; hint: string }[] = [
  { key: "amount", label: "Monthly amount", hint: "“At least $X a month”, rounded down" },
  { key: "platforms", label: "Number of platforms", hint: "How many paid you, never which" },
  { key: "total", label: "Total earned", hint: "The exact sum for the period" },
];

type Made = { passport: Passport; url: string; fields: ShareFields };

/**
 * Pick a period and what to show, see the card update, then sign it with the passkey and share.
 * Individual payments are never part of it; hidden fields are signed as the weakest true claim.
 */
export function ShareComposer({ history, reduced }: { history: PayeeHistoryItem[]; reduced: boolean }) {
  const payee = usePayeeAccount();
  const [now] = useState(() => Date.now());
  const [span, setSpan] = useState<Span>(3);
  const [fields, setFields] = useState<ShareFields>(DEFAULT_FIELDS);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Made | null>(null);

  const months = useMemo(() => recentMonths(span, now), [span, now]);
  const income = useMemo(() => monthlyIncome(history, months), [history, months]);
  const best = bestClaim(income);
  const totalCents = income.months.reduce((t, m) => t + m.cents, 0);
  const draft = best
    ? shareCardFor({ months, ...claimToSign(best, fields) }, fields, totalCents)
    : null;
  const card = made ? shareCardFor(made.passport.statement, made.fields, totalCents) : draft;

  // Any change after signing needs a new signature.
  const pickSpan = (n: Span) => {
    setSpan(n);
    setMade(null);
  };
  const toggle = (key: keyof ShareFields, on: boolean) => {
    setFields((f) => ({ ...f, [key]: on }));
    setMade(null);
  };

  async function create() {
    if (!best || !payee.address || !payee.email) return;
    setBusy(true);
    try {
      const passport = await signPassport(payee.email, { account: payee.address, months, ...claimToSign(best, fields) });
      setMade({ passport, fields, url: shareUrl(window.location.origin, passport, fields, totalCents) });
      posthog.capture("passport_created", {
        months: months.length,
        min_monthly_usd: fields.amount ? best.minMonthlyUsd : null,
        platforms: fields.platforms ? best.platforms : null,
        shows_total: fields.total,
      });
    } catch (err) {
      if (!(err instanceof PasskeyCancelled)) toast.error(err instanceof Error ? err.message : "Couldn't create your passport link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(made!.url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy. Press and hold the link to copy it.");
    }
  }

  async function share() {
    if (typeof navigator.share !== "function") return copy();
    try {
      await navigator.share({ title: "My earnings, checked by Fanout", url: made!.url });
      posthog.capture("passport_shared", { via: "share_sheet" });
    } catch {
      // Closed the share sheet.
    }
  }

  async function saveImage() {
    if (!card) return;
    try {
      const res = await fetch(`/api/passport/card?${cardQuery(card)}&format=portrait`);
      if (!res.ok) throw new Error();
      const file = new File([await res.blob()], "earnings-passport.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "My Earnings Passport" }).catch(() => {});
        return;
      }
      const href = URL.createObjectURL(file);
      const a = Object.assign(document.createElement("a"), { href, download: file.name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1_000);
    } catch {
      toast.error("Couldn't make the image. Try again.");
    }
  }

  const canSign = payee.kind === "passkey";

  return (
    <section id="share" aria-labelledby="share-title" className="flex scroll-mt-6 flex-col gap-5">
      <div>
        <h2 id="share-title" className="text-lg font-bold">
          Share your passport
        </h2>
        <p className="mt-0.5 text-sm text-pretty text-muted">
          For rent, a loan or a visa. They see a card and a check mark, never your payments.
        </p>
      </div>

      <div role="radiogroup" aria-label="Period to show" className="grid grid-cols-4 gap-1 rounded-md bg-card-raised p-1">
        {SPANS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={span === n}
            onClick={() => pickSpan(n)}
            className={cn(
              "h-9 rounded-sm text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96]",
              span === n ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            {n === 1 ? "This month" : `${n} months`}
          </button>
        ))}
      </div>

      {card ? (
        <ShareCard card={card} status="preview" reduced={reduced} />
      ) : (
        <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-6 text-center">
          <p className="font-semibold">Not every month here had a payout</p>
          <p className="text-sm text-pretty text-muted">
            A passport covers months that were all paid. Pick a shorter period than {cardPeriod({ from: months[0], to: months.at(-1)! })}.
          </p>
        </div>
      )}

      <ul className="overflow-hidden rounded-lg border border-line bg-surface" aria-label="What the card shows">
        {FIELD_COPY.map(({ key, label, hint }) => (
          <li key={key} className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
            <label htmlFor={`field-${key}`} className="min-w-0 cursor-pointer">
              <span className="block font-semibold">{label}</span>
              <span className="block text-sm text-muted">{hint}</span>
            </label>
            <Switch.Root
              id={`field-${key}`}
              checked={fields[key]}
              onCheckedChange={(on) => toggle(key, on)}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full outline-none",
                "transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                "bg-line data-[state=checked]:bg-primary-solid",
              )}
            >
              <Switch.Thumb
                className={cn(
                  "block size-6 translate-x-0.5 rounded-full bg-white shadow-sm",
                  "transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=checked]:translate-x-[22px]",
                )}
              />
            </Switch.Root>
          </li>
        ))}
      </ul>

      {!canSign ? (
        <p className="rounded-md bg-card-raised px-4 py-3 text-sm text-muted">
          Sharing needs an account with a passkey, so your card can be signed. Set one up on a phone that supports passkeys.
        </p>
      ) : made ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" className="col-span-2 h-12" onClick={() => void share()}>
              <Share2 aria-hidden className="size-4" /> Share link
            </Button>
            <Button variant="secondary" onClick={() => void copy()}>
              <Copy aria-hidden className="size-4" /> Copy link
            </Button>
            <Button variant="secondary" onClick={() => void saveImage()}>
              <Download aria-hidden className="size-4" /> Save image
            </Button>
          </div>
          <a
            href={made.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-sm text-sm font-semibold underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            See what they&apos;ll see <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </div>
      ) : (
        <Button size="lg" className="h-12 w-full" disabled={!best || busy} onClick={() => void create()} aria-busy={busy}>
          {busy ? (
            <>
              <Spinner className="size-4" /> Confirm with your passkey…
            </>
          ) : (
            "Create passport link"
          )}
        </Button>
      )}

      {made && <BadgeSection passport={made.passport} encoded={encodePassport(made.passport)} fields={made.fields} link={made.url} />}
    </section>
  );
}
