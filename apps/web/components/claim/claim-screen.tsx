"use client";

import { AnimatePresence, m } from "motion/react";
import { Logo } from "@/components/brand/logo";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Button } from "@/components/ui/button";
import { useTweenNumber } from "@/hooks/use-tween-number";
import { formatCents } from "@/lib/money";

export type ClaimScreenState = "ready" | "claiming" | "success";

type Props = {
  state: ClaimScreenState;
  amountCents: number;
  platform: string;
  note?: string;
  onClaim: () => void;
  reduced: boolean;
};

const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;

/**
 * The payee claim screen. Presentational only: the /claim page and the landing
 * page's phone mock both render this, so the demo and the product match.
 * Copy rules: dollars only, no crypto terms. It has no background of its own;
 * the parent sets it, plus `--petal-cut` to the same colour for the petals mark.
 */
export function ClaimScreen({ state, amountCents, platform, note, onClaim, reduced }: Props) {
  return (
    <div className="flex h-full flex-col px-5 pt-5 pb-6">
      <div className="self-start">
        <Logo width={88} height={18} className="h-[18px] w-auto" />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {state === "success" ? (
          <m.div
            key="success"
            className="flex flex-1 flex-col items-center justify-center text-center"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
          >
            <Success amountCents={amountCents} reduced={reduced} />
          </m.div>
        ) : (
          <m.div
            key="ready"
            className="flex flex-1 flex-col"
            exit={reduced ? undefined : { opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <p className="text-base font-semibold text-muted">You&apos;ve been paid</p>
              <p className="mt-2 font-display text-[64px] leading-none tracking-[-0.03em] text-foreground tabular-nums">
                {formatCents(amountCents)}
              </p>
              <p className="mt-5 rounded-full bg-mint-surface px-3 py-1.5 text-xs font-semibold text-balance text-on-mint">
                from {platform}
                {note ? ` · ${note}` : ""}
              </p>
            </div>
            <Button size="lg" className="h-14 w-full" onClick={onClaim} disabled={state === "claiming"} aria-busy={state === "claiming"}>
              {state === "claiming" ? (
                <>
                  <Spinner /> Claiming…
                </>
              ) : (
                "Claim with passkey"
              )}
            </Button>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Success({ amountCents, reduced }: { amountCents: number; reduced: boolean }) {
  const shown = useTweenNumber(amountCents, { durationMs: 800, instant: reduced });
  return (
    <>
      <PetalsMark size={72} color="var(--primary-solid)" cutColor="var(--petal-cut, var(--bg))" fanOut={!reduced} />
      <p className="mt-6 text-base font-semibold text-muted">It&apos;s in your Fanout balance</p>
      <p className="mt-2 font-display text-[56px] leading-none tracking-[-0.03em] text-foreground tabular-nums">{formatCents(shown)}</p>
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
