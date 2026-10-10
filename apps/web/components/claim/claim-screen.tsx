"use client";

import { AnimatePresence, m } from "motion/react";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Button } from "@/components/ui/button";
import { useTweenNumber } from "@/hooks/use-tween-number";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

export type ClaimScreenState = "ready" | "claiming" | "success";

type Props = {
  state: ClaimScreenState;
  amountCents: number;
  platform: string;
  note?: string;
  onClaim: () => void;
  reduced: boolean;
  /** The landing mock shows the logo inside the phone; the real page has a top bar instead. */
  showLogo?: boolean;
  /** Button text in the ready state. */
  actionLabel?: string;
  /** Short line under the button (e.g. how sign-in works). */
  hint?: string;
  /** Plain-language error shown above the button. */
  error?: string | null;
  /** Shown under the success message (e.g. "See your balance"). */
  successAction?: ReactNode;
  /** Shown under the amount (e.g. the amount in the payee's local currency). */
  localAmount?: ReactNode;
  /** The payee's language (the /claim page); the landing mock uses the English defaults. */
  labels?: ClaimScreenLabels;
  /** Cents -> "$1,234.56" in the payee's number format. */
  formatAmount?: (cents: number) => string;
  className?: string;
};

export type ClaimScreenLabels = { youveBeenPaid: string; from: (platform: string) => string; claiming: string; inBalance: string };

const ENGLISH: ClaimScreenLabels = {
  youveBeenPaid: "You've been paid",
  from: (platform) => `from ${platform}`,
  claiming: "Claiming…",
  inBalance: "It's in your Fanout balance",
};

const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;

/**
 * The payee claim screen. Presentational only: the /claim page and the landing
 * page's phone mock both render this, so the demo and the product match.
 * Copy rules: dollars only, no crypto terms. It has no background of its own;
 * the parent sets it, plus `--petal-cut` to the same colour for the petals mark.
 */
export function ClaimScreen({
  state,
  amountCents,
  platform,
  note,
  onClaim,
  reduced,
  showLogo = true,
  actionLabel = "Claim with passkey",
  hint,
  error,
  successAction,
  localAmount,
  labels = ENGLISH,
  formatAmount = formatCents,
  className,
}: Props) {
  return (
    <div className={cn("flex h-full flex-col px-5 pt-5 pb-6", className)}>
      {showLogo && (
        <div className="self-start">
          <Logo width={88} height={18} className="h-[18px] w-auto" />
        </div>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {state === "success" ? (
          <m.div
            key="success"
            className="flex flex-1 flex-col items-center justify-center text-center"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
          >
            <Success amountCents={amountCents} reduced={reduced} label={labels.inBalance} formatAmount={formatAmount} />
            {localAmount && <div className="mt-3">{localAmount}</div>}
            {successAction && <div className="mt-10 w-full">{successAction}</div>}
          </m.div>
        ) : (
          <m.div
            key="ready"
            className="flex flex-1 flex-col"
            exit={reduced ? undefined : { opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <p className="text-base font-semibold text-muted">{labels.youveBeenPaid}</p>
              <p dir="ltr" className="mt-2 font-display text-[64px] leading-none tracking-[-0.03em] text-foreground tabular-nums">
                {formatAmount(amountCents)}
              </p>
              {localAmount && <div className="mt-3">{localAmount}</div>}
              <p className="mt-5 rounded-full bg-mint-surface px-3 py-1.5 text-xs font-semibold text-balance text-on-mint">
                {labels.from(platform)}
                {note ? ` · ${note}` : ""}
              </p>
            </div>
            {error && (
              <p role="alert" className="mb-4 rounded-md bg-danger/10 px-4 py-3 text-center text-sm font-semibold text-danger">
                {error}
              </p>
            )}
            <Button size="lg" className="h-14 w-full" onClick={onClaim} disabled={state === "claiming"} aria-busy={state === "claiming"}>
              {state === "claiming" ? (
                <>
                  <Spinner /> {labels.claiming}
                </>
              ) : (
                actionLabel
              )}
            </Button>
            {hint && <p className="mt-3 text-center text-sm text-muted">{hint}</p>}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Success({
  amountCents,
  reduced,
  label,
  formatAmount,
}: {
  amountCents: number;
  reduced: boolean;
  label: string;
  formatAmount: (cents: number) => string;
}) {
  const shown = useTweenNumber(amountCents, { durationMs: 800, instant: reduced });
  return (
    <>
      <PetalsMark size={72} color="var(--primary-solid)" cutColor="var(--petal-cut, var(--bg))" fanOut={!reduced} />
      <p className="mt-6 text-base font-semibold text-muted">{label}</p>
      <p dir="ltr" className="mt-2 font-display text-[56px] leading-none tracking-[-0.03em] text-foreground tabular-nums">
        {formatAmount(shown)}
      </p>
    </>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
