"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { StampArt } from "@/components/passport/stamp";
import { usePayeeHistory } from "@/lib/fanout/queries";
import { passportStats, stampLook } from "@/lib/payee/passport-stats";

/**
 * Earnings Passport on the balance page: the closed booklet. Shows the stamps collected so far
 * and opens the full passport, where the payee can also share a checked proof of income.
 */
export function PassportCard() {
  const history = usePayeeHistory();
  const [now] = useState(() => Date.now());
  const stats = useMemo(() => (history.data ? passportStats(history.data, now) : null), [history.data, now]);
  if (!stats) return null;

  const stamps = stats.platforms.length;
  return (
    <Link
      href="/balance/passport"
      className="group relative isolate flex items-center gap-4 overflow-hidden rounded-xl bg-cobalt px-5 py-5 text-cream outline-none transition-transform duration-150 ease-out active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <PetalsMark size={150} color="var(--color-cobalt-600)" cutColor="var(--color-cobalt)" className="pointer-events-none absolute -right-8 -bottom-12 -z-10" />
      <div className="min-w-0 flex-1">
        <p className="text-lg font-bold">Earnings Passport</p>
        <p className="mt-0.5 text-sm text-pretty text-cream/80">
          {stamps === 0
            ? "Your first stamp arrives with your first payout."
            : `${stamps} ${stamps === 1 ? "stamp" : "stamps"} · ${stats.monthsPaid} ${stats.monthsPaid === 1 ? "month" : "months"} paid. Prove what you earn.`}
        </p>
      </div>
      {stamps > 0 ? (
        <div className="relative h-14 w-[76px] shrink-0" aria-hidden>
          {stats.platforms.slice(-3).map((p, i) => {
            const look = stampLook(p.id);
            return (
              <span
                key={p.id}
                className="absolute top-0 size-14 rounded-full bg-cobalt text-cream"
                style={{ left: i * 10, transform: `rotate(${look.tilt}deg)`, zIndex: i } as CSSProperties}
              >
                <StampArt platform={p.id} firstPaidAt={p.firstPaidAt} className="size-full" />
              </span>
            );
          })}
        </div>
      ) : (
        <span aria-hidden className="size-12 shrink-0 -rotate-6 rounded-full border-2 border-dashed border-cream/40" />
      )}
      <ChevronRight aria-hidden className="size-5 shrink-0 text-cream/70 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
    </Link>
  );
}
