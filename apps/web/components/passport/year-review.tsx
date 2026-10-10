import { formatCents } from "@/lib/money";
import { monthLabel } from "@/lib/payee/passport";
import type { YearReview as Year } from "@/lib/payee/passport-stats";

/** A year at a glance. The current year reads "so far"; past years are "in review". */
export function YearReview({ year, current }: { year: Year; current: boolean }) {
  const rows: [string, string][] = [
    ["Earned", formatCents(year.cents)],
    ["Months paid", `${year.monthsPaid}`],
    ["Best month", `${monthLabel(year.bestMonth.month).split(" ")[0]} · ${formatCents(year.bestMonth.cents)}`],
    ["Platforms", `${year.platforms}`],
    ["Payouts", `${year.payouts}`],
  ];
  return (
    <article aria-label={`${year.year} ${current ? "so far" : "in review"}`} className="rounded-lg border border-line bg-surface p-5">
      <p className="flex items-baseline gap-2">
        <span className="font-display text-[40px] leading-none tracking-[-0.03em] tabular-nums">{year.year}</span>
        <span className="text-sm font-semibold text-muted">{current ? "so far" : "in review"}</span>
      </p>
      <dl className="mt-4 divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
