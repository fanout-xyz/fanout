"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { BatchSummary } from "@/lib/fanout/client";
import { useBatches } from "@/lib/fanout/queries";
import { formatUsd } from "@/lib/money";

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function PayoutsTable() {
  const batches = useBatches();

  return (
    <section aria-labelledby="payouts-title" className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-5">
        <h2 id="payouts-title" className="font-display text-2xl tracking-[-0.015em]">
          Payouts
        </h2>
      </div>
      {batches.isPending ? (
        <div className="flex flex-col gap-3 p-6" aria-busy="true" aria-label="Loading payouts">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : batches.isError ? (
        <div className="flex flex-col items-start gap-3 p-6" role="alert">
          <p className="text-danger">Couldn&apos;t load your payouts. {batches.error.message}</p>
          <Button variant="secondary" size="sm" onClick={() => void batches.refetch()}>
            Retry
          </Button>
        </div>
      ) : batches.data.length === 0 ? (
        <EmptyState />
      ) : (
        <BatchRows rows={batches.data} />
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <PetalsMark size={48} color="var(--primary)" cutColor="var(--card)" />
      <p className="text-muted">No payouts yet. Your first one takes a CSV and one approval.</p>
      <Button asChild variant="secondary">
        <Link href="/dashboard/payouts/new">Upload a CSV</Link>
      </Button>
    </div>
  );
}

function BatchRows({ rows }: { rows: BatchSummary[] }) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[15px] whitespace-nowrap">
        <thead className="sticky top-0 bg-surface text-sm text-muted">
          <tr className="border-b border-line">
            <th scope="col" className="px-6 py-3 font-semibold">Payout</th>
            <th scope="col" className="px-6 py-3 font-semibold">Sent</th>
            <th scope="col" className="px-6 py-3 text-right font-semibold">People</th>
            <th scope="col" className="px-6 py-3 font-semibold">Claimed</th>
            <th scope="col" className="hidden px-6 py-3 font-semibold lg:table-cell">Unclaimed returns</th>
            <th scope="col" className="px-6 py-3 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const href = `/dashboard/payouts/${b.id}`;
            const pct = b.rowCount ? Math.round((b.claimedCount / b.rowCount) * 100) : 0;
            return (
              <tr
                key={b.id}
                onClick={() => router.push(href)}
                className="h-13 cursor-pointer border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-card-raised"
              >
                <td className="px-6">
                  {/* The link is the keyboard/screen-reader target; the row click is a mouse shortcut. */}
                  <Link
                    href={href}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-sm font-semibold outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    Payout #{b.id}
                  </Link>
                </td>
                <td className="px-6 text-muted tabular-nums">{dateFormat.format(b.createdAt)}</td>
                <td className="px-6 text-right tabular-nums">{b.rowCount}</td>
                <td className="px-6">
                  <div className="flex items-center gap-3">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line" aria-hidden>
                      <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-sm tabular-nums">
                      {b.claimedCount} of {b.rowCount}
                    </span>
                  </div>
                </td>
                <td className="hidden px-6 text-muted tabular-nums lg:table-cell">
                  {b.expiresAt === undefined || b.claimedCount === b.rowCount ? "—" : dateFormat.format(b.expiresAt)}
                </td>
                <td className="px-6 text-right font-bold tabular-nums">{formatUsd(b.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
