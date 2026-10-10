"use client";

import { Copy, FileText, Share2 } from "lucide-react";
import posthog from "posthog-js";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAiStatus } from "@/lib/ai/use-ai";
import { LETTER_LINK, type Audience } from "@/lib/assist/letter-ai";
import { usePayeeHistory } from "@/lib/fanout/queries";
import { LANGUAGES, type Lang } from "@/lib/i18n/languages";
import { PasskeyCancelled } from "@/lib/payee/passkey-account";
import { bestClaim, encodePassport, monthLabel, monthlyIncome, recentMonths } from "@/lib/payee/passport";
import { signPassport } from "@/lib/payee/passport-key";
import { claimToSign, shareUrl, type ShareFields } from "@/lib/payee/passport-share";
import { usePayeeAccount } from "@/lib/payee/payee-account";
import { cn } from "@/lib/utils";
import { PassportView } from "./passport-view";

const SPANS = [1, 3, 6, 12] as const;
const FIELDS: ShareFields = { amount: true, platforms: true, total: false };
const AUDIENCE_LABELS: { value: Audience; label: string }[] = [
  { value: "landlord", label: "A landlord" },
  { value: "lender", label: "A lender or bank" },
  { value: "other", label: "Someone else" },
];

/** The passport page, with "Write a letter" next to Share when AI is on. */
export function PassportWithLetter() {
  const ai = useAiStatus();
  return <PassportView actions={ai.on ? <PassportLetter demo={ai.demo} /> : undefined} />;
}

/**
 * Drafts a short income letter from a freshly signed passport: the payee confirms with their passkey
 * (that makes the verify link), our assistant writes from the statement only, and the payee edits it.
 */
export function PassportLetter({ demo }: { demo: boolean }) {
  const payee = usePayeeAccount();
  const history = usePayeeHistory();
  const [open, setOpen] = useState(false);
  const [now] = useState(() => Date.now());
  const [span, setSpan] = useState<(typeof SPANS)[number]>(3);
  const [language, setLanguage] = useState<Lang>("en");
  const [audience, setAudience] = useState<Audience>("landlord");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const languageId = useId();
  const audienceId = useId();
  const letterId = useId();

  const months = useMemo(() => recentMonths(span, now), [span, now]);
  const best = useMemo(() => (history.data ? bestClaim(monthlyIncome(history.data, months)) : null), [history.data, months]);
  const period = months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} to ${monthLabel(months.at(-1)!)}`;
  const canSign = payee.kind === "passkey" && !!payee.address && !!payee.email;

  async function write() {
    if (!best || !canSign) return;
    setBusy(true);
    setError(null);
    try {
      const passport = await signPassport(payee.email!, { account: payee.address!, months, ...claimToSign(best, FIELDS) });
      const url = shareUrl(window.location.origin, passport, FIELDS);
      const res = await fetch("/api/ai/passport-letter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passport: encodePassport(passport), language, audience }),
      }).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as { letter?: string; error?: string };
      if (!res?.ok || !body.letter) throw new Error(body?.error ?? "Couldn't reach our assistant. Try again.");
      setDraft(body.letter.split(LETTER_LINK).join(url));
      posthog.capture("passport_letter_written", { months: months.length, language, audience });
    } catch (err) {
      if (!(err instanceof PasskeyCancelled)) setError(err instanceof Error ? err.message : "Couldn't write the letter. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft!);
      toast.success("Letter copied");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it.");
    }
  }

  async function share() {
    if (typeof navigator.share !== "function") return copy();
    try {
      await navigator.share({ title: "Income letter", text: draft! });
    } catch {
      // Closed the share sheet.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setDraft(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg" variant="secondary" className="h-12 w-full">
          <FileText aria-hidden className="size-4" /> Write a letter
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>A letter for a landlord or lender</DialogTitle>
          <DialogDescription>
            A short letter about what you earn, with a link they can use to check it. Your payments aren&apos;t in it.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <div className="flex flex-col gap-3">
            <label htmlFor={letterId} className="text-sm font-semibold">
              Your letter. Edit anything before you send it.
            </label>
            <textarea
              id={letterId}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={14}
              className="w-full rounded-sm border border-input bg-card-raised p-3 text-[15px] leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted">
              {demo ? "Demo mode: a fixed template wrote this, not the AI. " : "Written by our assistant from your passport. "}
              Replace [Your name], and check it says what you mean.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => void copy()}>
                <Copy aria-hidden className="size-4" /> Copy
              </Button>
              <Button onClick={() => void share()}>
                <Share2 aria-hidden className="size-4" /> Share
              </Button>
            </div>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Start over
            </Button>
          </div>
        ) : !canSign ? (
          <p className="text-sm text-muted">Your letter needs an account with a passkey. Set one up on a phone that supports passkeys.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div role="radiogroup" aria-label="Period" className="grid grid-cols-4 gap-1 rounded-md bg-card-raised p-1">
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
                  {n === 1 ? "1 month" : `${n} months`}
                </button>
              ))}
            </div>
            {best ? (
              <p className="text-[15px]">
                It will say you earned at least <strong>${best.minMonthlyUsd.toLocaleString("en-US")} a month</strong> for {period}, from{" "}
                {best.platforms} {best.platforms === 1 ? "platform" : "platforms"}.
              </p>
            ) : (
              <p className="text-sm text-muted">Not every month in {period} had payouts. Pick a shorter period.</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={audienceId} className="text-sm font-semibold">
                  Who it&apos;s for
                </label>
                <select
                  id={audienceId}
                  value={audience}
                  onChange={(e) => setAudience(e.target.value as Audience)}
                  className="h-11 rounded-sm border border-line bg-card-raised px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {AUDIENCE_LABELS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={languageId} className="text-sm font-semibold">
                  Language
                </label>
                <select
                  id={languageId}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as Lang)}
                  className="h-11 rounded-sm border border-line bg-card-raised px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code} lang={l.code}>
                      {l.native}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-muted">
              To write it, the period, the monthly amount and the number of platforms go to our AI provider. Never your payments, name or
              email.
            </p>
            {error && (
              <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">
                {error}
              </p>
            )}
            <Button size="lg" className="h-12 w-full" disabled={!best || busy} onClick={() => void write()} aria-busy={busy}>
              {busy ? (
                <>
                  <Spinner className="size-4" /> Writing…
                </>
              ) : (
                "Confirm with your passkey and write"
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
