"use client";

import { AnimatePresence, m } from "motion/react";
import { useId } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { cardFacts, cardPeriod, type ShareCard as Card } from "@/lib/payee/passport-share";
import { cn } from "@/lib/utils";

export type CardStatus = "preview" | "checking" | "verified" | "failed";

const SEAL: Record<Exclude<CardStatus, "checking">, { text: string; className: string }> = {
  verified: { text: "VERIFIED · VERIFIED · VERIFIED · ", className: "text-mint" },
  preview: { text: "PREVIEW · PREVIEW · PREVIEW · ", className: "text-cream/45" },
  failed: { text: "NOT VERIFIED · NOT VERIFIED · ", className: "text-[#FF8A73]" },
};

/**
 * The shareable Passport card. Always dark, like the balance card, so it reads the same on any
 * page and matches the link-preview image. Shows only the fields on `card`.
 */
export function ShareCard({ card, status, reduced, className }: { card: Card; status: CardStatus; reduced: boolean; className?: string }) {
  const amount = card.minMonthlyUsd;
  const facts = cardFacts(card);

  return (
    <article
      aria-label="Earnings Passport card"
      className={cn(
        "relative isolate overflow-hidden rounded-xl border border-band-dark-border bg-band-dark text-cream shadow-[var(--shadow-float)]",
        className,
      )}
    >
      <PetalsMark
        size={220}
        color="var(--color-cobalt)"
        cutColor="var(--band-dark)"
        className="pointer-events-none absolute -bottom-16 -left-14 -z-10 opacity-15"
      />

      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="flex items-center gap-2">
          <PetalsMark size={22} color="var(--color-cream)" cutColor="var(--band-dark)" />
          <span className="text-sm font-bold">Earnings Passport</span>
        </div>
        <Seal status={status} reduced={reduced} />
      </div>

      <div className="px-6 pt-1">
        <p className="text-sm font-semibold text-cream/70">{amount !== undefined ? "Earned at least" : "Earnings record"}</p>
        <p className="mt-1 font-display text-[clamp(34px,10vw,44px)] leading-[1.02] tracking-[-0.03em] text-balance tabular-nums">
          {amount !== undefined ? (
            <>
              ${amount.toLocaleString("en-US")}
              <span className="text-cream/70"> a month</span>
            </>
          ) : (
            "Paid every month"
          )}
        </p>
        <p className="mt-2 font-semibold text-cream/80 tabular-nums">{cardPeriod(card)}</p>
      </div>

      {/* Perforation: the card tears off the passport like a page stub. */}
      <div aria-hidden className="relative mt-6 h-0 border-t-2 border-dashed border-cream/15">
        <span className="absolute -top-3 -left-3 size-6 rounded-full bg-background" />
        <span className="absolute -top-3 -right-3 size-6 rounded-full bg-background" />
      </div>

      <div className="flex flex-col gap-4 px-6 pt-5 pb-6">
        <ul className="flex flex-wrap gap-2" aria-label="Details">
          {facts.map((f) => (
            <li key={f} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold tabular-nums">
              {f}
            </li>
          ))}
        </ul>
        <p className="text-xs text-cream/55">
          {status === "verified"
            ? "Checked against the payouts on record."
            : status === "failed"
              ? "The payouts on record don't match this card."
              : status === "checking"
                ? "Checking the payouts on record…"
                : "Anyone with the link can check this."}
        </p>
      </div>
    </article>
  );
}

/** A round rubber-stamp seal. It lands with a spring when the check passes. */
function Seal({ status, reduced }: { status: CardStatus; reduced: boolean }) {
  const id = useId();
  return (
    <div className="relative size-[76px] shrink-0" aria-hidden>
      <AnimatePresence initial={false}>
        {status === "checking" ? (
          <m.span
            key="checking"
            className="absolute inset-0 rounded-full border-2 border-dashed border-cream/30 motion-safe:animate-[spin_6s_linear_infinite]"
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          />
        ) : (
          <m.svg
            key={status}
            viewBox="0 0 100 100"
            className={cn("absolute inset-0 size-full", SEAL[status].className)}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.6, rotate: -28 }}
            animate={{ opacity: 1, scale: 1, rotate: -12 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={reduced ? { duration: 0.2 } : { type: "spring", stiffness: 480, damping: 22, opacity: { duration: 0.1 } }}
          >
            <defs>
              <path id={`${id}-ring`} d="M50,50 m-36,0 a36,36 0 1,1 72,0 a36,36 0 1,1 -72,0" />
            </defs>
            <circle cx={50} cy={50} r={47} fill="none" stroke="currentColor" strokeWidth={3} />
            <circle cx={50} cy={50} r={27} fill="none" stroke="currentColor" strokeWidth={1.5} />
            <text fontSize={10.5} fontWeight={800} fill="currentColor">
              <textPath href={`#${id}-ring`} textLength={224} lengthAdjust="spacing">{SEAL[status].text}</textPath>
            </text>
            {status === "verified" ? (
              <path d="M38 50.5l8 8 16-17" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
            ) : status === "failed" ? (
              <path d="M41 41l18 18M59 41L41 59" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
            ) : (
              <circle cx={50} cy={50} r={5} fill="currentColor" />
            )}
          </m.svg>
        )}
      </AnimatePresence>
    </div>
  );
}
