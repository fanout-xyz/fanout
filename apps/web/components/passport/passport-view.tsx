"use client";

import { ChevronLeft } from "lucide-react";
import { m, useInView, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PayeeAuthGate } from "@/components/wallet/payee-auth-gate";
import { usePayeeHistory } from "@/lib/fanout/queries";
import type { PayeeHistoryItem } from "@/lib/fanout/types";
import { formatCents } from "@/lib/money";
import { monthOf, passportStats, type PassportStats } from "@/lib/payee/passport-stats";
import { usePayeeAccount } from "@/lib/payee/payee-account";
import { CountUp } from "./count-up";
import { MonthStrip } from "./month-strip";
import { PassportActions } from "./passport-actions";
import { ShareComposer } from "./share-composer";
import { Stamp } from "./stamp";
import { useFreshStamps } from "./use-seen-stamps";
import { YearReview } from "./year-review";

const sinceFmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dollars = (cents: number) => `$${Math.floor(cents / 100).toLocaleString("en-US")}`;
const whole = (n: number) => Math.round(n).toLocaleString("en-US");

/** The payee's own Earnings Passport: everything they've been paid, as a passport booklet. */
export function PassportView({ actions }: { actions?: ReactNode }) {
  return (
    <PayeeAuthGate>
      <Passport actions={actions} />
    </PayeeAuthGate>
  );
}

function Passport({ actions }: { actions?: ReactNode }) {
  const history = usePayeeHistory();
  const reduced = useReducedMotion() ?? false;

  return (
    <div className="flex flex-col gap-7 px-5 pt-2 pb-12">
      <Link
        href="/balance"
        className="-ml-1 inline-flex w-fit items-center gap-0.5 rounded-sm py-1 pr-2 text-sm font-semibold text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft aria-hidden className="size-4" /> Balance
      </Link>
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-danger/10 px-4 py-3" role="alert">
          <p className="text-sm font-semibold text-danger">Couldn&apos;t load your payouts.</p>
          <Button variant="secondary" size="sm" onClick={() => void history.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <Loaded history={history.data} reduced={reduced} actions={actions} />
      )}
    </div>
  );
}

function Loaded({ history, reduced, actions }: { history: PayeeHistoryItem[]; reduced: boolean; actions?: ReactNode }) {
  const [now] = useState(() => Date.now());
  const stats = useMemo(() => passportStats(history, now), [history, now]);
  if (stats.payouts === 0) return <Empty reduced={reduced} />;

  const scrollToShare = () =>
    document.getElementById("share")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });

  const sections = [
    <Cover key="cover" stats={stats} reduced={reduced} />,
    <PassportActions key="actions" onShare={scrollToShare}>
      {actions}
    </PassportActions>,
    <Numbers key="numbers" stats={stats} reduced={reduced} />,
    <Stamps key="stamps" stats={stats} reduced={reduced} />,
    <Section key="months" title="Month by month" id="months-title">
      <div className="rounded-lg border border-line bg-surface p-4">
        <MonthStrip months={stats.months} reduced={reduced} />
      </div>
    </Section>,
    <Section key="years" title="Year in review" id="years-title">
      <div className="flex flex-col gap-3">
        {stats.years.map((y) => (
          <YearReview key={y.year} year={y} current={y.year === Number(monthOf(now).slice(0, 4))} />
        ))}
      </div>
    </Section>,
    <ShareComposer key="share" history={history} reduced={reduced} />,
  ];

  return (
    <>
      {sections.map((s, i) => (
        // Pages settle in from just below, one after another: a booklet falling open.
        <m.div
          key={s.key}
          initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(14px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={reduced ? { duration: 0.2 } : { type: "spring", duration: 0.6, bounce: 0.12, delay: Math.min(i, 5) * 0.05 }}
        >
          {s}
        </m.div>
      ))}
    </>
  );
}

function Section({ title, id, children, aside }: { title: string; id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-lg font-bold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The booklet cover: cobalt, the total in big type, and a machine-readable strip at the foot. */
function Cover({ stats, reduced }: { stats: PassportStats; reduced: boolean }) {
  const since = stats.firstPaidAt ? monthOf(stats.firstPaidAt).replace("-", "") : "";
  return (
    <section
      aria-labelledby="passport-title"
      className="relative isolate overflow-hidden rounded-xl bg-cobalt px-6 pt-6 pb-5 text-cream shadow-[var(--shadow-float)]"
    >
      <PetalsMark
        size={240}
        color="var(--color-cobalt-600)"
        cutColor="var(--color-cobalt)"
        className="pointer-events-none absolute -top-14 -right-16 -z-10"
      />
      <div className="flex items-center gap-2">
        <PetalsMark size={20} color="var(--color-cream)" cutColor="var(--color-cobalt)" />
        <h1 id="passport-title" className="text-sm font-bold">
          Earnings Passport
        </h1>
      </div>
      <p className="mt-8 text-sm font-semibold text-cream/75">Total earned</p>
      <CountUp
        value={stats.totalCents}
        format={formatCents}
        reduced={reduced}
        durationMs={1100}
        className="mt-1 block font-display text-[clamp(40px,12vw,56px)] leading-none tracking-[-0.03em]"
      />
      <p className="mt-3 text-sm font-semibold text-cream/80">
        Since {stats.firstPaidAt ? sinceFmt.format(stats.firstPaidAt) : ""} · {stats.payouts} {stats.payouts === 1 ? "payout" : "payouts"}
      </p>
      <div aria-hidden className="mt-7 overflow-hidden font-mono text-[11px] leading-[1.5] whitespace-nowrap text-cream/55 uppercase">
        <p>P&lt;FANOUT&lt;&lt;EARNINGS&lt;PASSPORT&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</p>
        <p>
          {since}&lt;&lt;{stats.monthsPaid}M&lt;{stats.platforms.length}P&lt;&lt;{stats.longestStreak}S&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
        </p>
      </div>
    </section>
  );
}

function Numbers({ stats, reduced }: { stats: PassportStats; reduced: boolean }) {
  const tiles = [
    { label: "Months paid", value: stats.monthsPaid, format: whole },
    { label: "Platforms", value: stats.platforms.length, format: whole },
    { label: "Longest streak", value: stats.longestStreak, format: (n: number) => `${whole(n)} mo` },
    { label: "Average month", value: stats.averagePerPaidMonthCents, format: dollars },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-line bg-surface px-4 py-3.5">
          <dt className="text-sm text-muted">{t.label}</dt>
          <dd className="mt-1 font-display text-[28px] leading-none tracking-[-0.02em]">
            <CountUp value={t.value} format={t.format} reduced={reduced} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Stamps({ stats, reduced }: { stats: PassportStats; reduced: boolean }) {
  const payee = usePayeeAccount();
  const page = useRef<HTMLUListElement>(null);
  // Stamps land when the page scrolls into view, not while they're still off screen.
  const inView = useInView(page, { once: true, margin: "0px 0px -80px 0px" });
  const fresh = useFreshStamps(
    payee.address,
    stats.platforms.map((p) => p.id),
    inView,
  );
  let order = 0;
  return (
    <Section
      title="Stamps"
      id="stamps-title"
      aside={<span className="text-sm text-muted">One for each platform that pays you</span>}
    >
      {/* A passport page: paper, a faint rule, stamps scattered in a loose grid. */}
      <ul ref={page} className="grid grid-cols-2 gap-x-3 gap-y-6 rounded-lg border border-line bg-surface px-3 py-6 min-[400px]:grid-cols-3">
        {stats.platforms.map((p) => (
          <Stamp key={p.id} stamp={p} fresh={fresh.has(p.id)} play={inView} delay={fresh.has(p.id) ? 0.1 + order++ * 0.16 : 0} reduced={reduced} />
        ))}
      </ul>
    </Section>
  );
}

/** Nothing paid yet: a blank page with a dotted outline where the first stamp will go. */
function Empty({ reduced }: { reduced: boolean }) {
  return (
    <m.section
      aria-labelledby="passport-empty-title"
      className="flex flex-col items-center gap-5 rounded-xl border border-line bg-surface px-6 pt-10 pb-8 text-center"
      initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(10px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={reduced ? { duration: 0.2 } : { type: "spring", duration: 0.5, bounce: 0.1 }}
    >
      <div className="relative flex size-[112px] -rotate-6 items-center justify-center rounded-full border-2 border-dashed border-line">
        <PetalsMark size={40} color="var(--border)" cutColor="var(--card)" />
      </div>
      <div className="flex flex-col gap-2">
        <h1 id="passport-empty-title" className="font-display text-[26px] leading-tight tracking-[-0.02em] text-balance">
          Your Earnings Passport
        </h1>
        <p className="text-pretty text-muted">Your first stamp arrives with your first payout. Each platform that pays you adds one.</p>
      </div>
      <Button asChild size="lg" className="mt-2 h-12 w-full">
        <Link href="/balance">Back to your balance</Link>
      </Button>
    </m.section>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-7" aria-busy="true" aria-label="Loading your passport">
      <Skeleton className="h-[244px] w-full rounded-xl" />
      <Skeleton className="h-12 w-full" />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[76px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
