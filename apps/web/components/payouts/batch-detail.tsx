"use client";

import Link from "next/link";
import posthog from "posthog-js";
import { useMemo, useState, useSyncExternalStore } from "react";
import { zeroHash } from "viem";
import { StatusChip } from "@/components/status-chip";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { batchToCsv } from "@/lib/batch-export";
import { explorerTxUrl } from "@/lib/chains";
import { config } from "@/lib/config";
import { buildClaimLink } from "@/lib/fanout/claim-keys";
import { loadAllClaims, subscribeClaims, type StoredClaim } from "@/lib/fanout/claim-link-store";
import type { PayoutStatus } from "@/lib/fanout/client";
import { useBatch, useMockExpireUnclaimed } from "@/lib/fanout/queries";
import { formatUsd } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ClaimLinkActions } from "./claim-link-actions";
import { EmailLinkButton, emailedLabel, UnclaimedReminder } from "./claim-reminders";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const FILTERS = ["all", "sent", "claimed", "refunded"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = { all: "All", sent: "Waiting", claimed: "Claimed", refunded: "Returned" };

type Row = {
  n: number;
  claimSigner: string;
  amount: bigint;
  status: PayoutStatus;
  claim?: StoredClaim;
};

const subscribeNoop = () => () => {};

export function BatchDetail({ id }: { id: string }) {
  const batch = useBatch(id);
  const expire = useMockExpireUnclaimed(id);
  const [filter, setFilter] = useState<Filter>("all");
  const [includeLinks, setIncludeLinks] = useState(false);

  // Claim keys live in this browser only (see claim-link-store). Read on the client.
  const allClaims = useSyncExternalStore(subscribeClaims, loadAllClaims, () => null);
  const origin = useSyncExternalStore(subscribeNoop, () => window.location.origin, () => "");

  const rows: Row[] = useMemo(() => {
    if (!batch.data) return [];
    return batch.data.rows.map((r, i) => ({
      n: i + 1,
      claimSigner: r.claimSigner,
      amount: r.amount,
      status: r.status,
      claim: allClaims?.[r.claimSigner.toLowerCase()],
    }));
  }, [batch.data, allClaims]);

  if (batch.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading payout">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  if (batch.isError) {
    return (
      <div className="flex flex-col items-start gap-4" role="alert">
        <BackLink />
        <h1 className="font-display text-[32px] tracking-[-0.02em]">Payout #{id}</h1>
        <p className="text-danger">{batch.error.message}</p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => void batch.refetch()}>
            Retry
          </Button>
          <Button asChild variant="ghost">
            <Link href="/dashboard">Back to overview</Link>
          </Button>
        </div>
      </div>
    );
  }

  const b = batch.data;
  const sum = (s: PayoutStatus) => rows.filter((r) => r.status === s).reduce((t, r) => t + r.amount, 0n);
  const count = (s: PayoutStatus) => rows.filter((r) => r.status === s).length;
  const counts: Record<Filter, number> = { all: rows.length, sent: count("sent"), claimed: count("claimed"), refunded: count("refunded") };
  const visible = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const hasTx = b.txHash !== zeroHash;
  const linksMissing = rows.length > 0 && rows.every((r) => !r.claim);

  function exportCsv() {
    const csv = batchToCsv(
      rows.map((r) => ({
        email: r.claim?.email,
        amount: r.amount,
        note: r.claim?.note,
        status: r.status,
        claimLink: r.claim && r.status === "sent" ? buildClaimLink(origin, r.claim.privateKey as `0x${string}`) : "",
      })),
      { includeLinks },
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `fanout-payout-${id}.csv` });
    a.click();
    posthog.capture("payout_csv_exported", {
      recipient_count: rows.length,
      includes_claim_links: includeLinks,
    });
    // Revoke after the click has been handled; revoking synchronously can cancel the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] leading-tight tracking-[-0.02em]">Payout #{b.id}</h1>
          <p className="mt-1 text-muted">
            Sent {dateFormat.format(b.createdAt)} · {rows.length} {rows.length === 1 ? "person" : "people"} · one transaction
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {hasTx &&
            (config.useMock ? (
              <span className="text-sm text-muted">Simulated transaction (demo mode)</span>
            ) : (
              <Button asChild variant="secondary">
                <a href={explorerTxUrl(b.txHash)} target="_blank" rel="noreferrer">
                  View transaction
                </a>
              </Button>
            ))}
          <ExportMenu includeLinks={includeLinks} setIncludeLinks={setIncludeLinks} onExport={exportCsv} canIncludeLinks={!linksMissing} />
        </div>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total sent" value={formatUsd(b.total)} />
        <Stat label="Claimed" value={formatUsd(sum("claimed"))} sub={`${counts.claimed} of ${rows.length} people`} />
        <Stat label="Waiting to be claimed" value={formatUsd(sum("sent"))} sub={`${counts.sent} ${counts.sent === 1 ? "person" : "people"}`} />
        <Stat label="Returned to balance" value={formatUsd(sum("refunded"))} sub={`${counts.refunded} unclaimed`} />
      </dl>

      {linksMissing && (
        <p role="note" className="rounded-md border border-line bg-card-raised px-4 py-3 text-sm text-muted">
          Claim links and emails for this payout aren&apos;t stored in this browser. They&apos;re kept only on the device that
          created the payout.
        </p>
      )}

      <UnclaimedReminder
        waiting={rows.flatMap((r) => (r.status === "sent" && r.claim ? [r.claim] : []))}
        total={rows.filter((r) => r.status === "sent" && r.claim).reduce((t, r) => t + r.amount, 0n)}
      />

      <section aria-labelledby="people-title" className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
          <h2 id="people-title" className="font-display text-2xl tracking-[-0.015em]">
            People
          </h2>
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "h-9 rounded-full px-3 text-sm font-semibold tabular-nums transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                  filter === f ? "bg-primary/10 text-primary" : "text-muted hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                {FILTER_LABEL[f]} {counts[f]}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="px-6 py-12 text-center text-muted">Nobody here yet.</p>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full min-w-[760px] text-left text-[15px] whitespace-nowrap">
              <thead className="sticky top-0 z-10 bg-surface text-sm text-muted shadow-[0_1px_0_var(--border)]">
                <tr>
                  <th scope="col" className="w-14 px-6 py-3 font-semibold">#</th>
                  <th scope="col" className="px-6 py-3 font-semibold">Email</th>
                  <th scope="col" className="px-6 py-3 text-right font-semibold">Amount</th>
                  <th scope="col" className="px-6 py-3 font-semibold">Note</th>
                  <th scope="col" className="px-6 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-6 py-3 text-right font-semibold">Claim link</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.claimSigner} className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-card-raised">
                    <td className="h-13 px-6 text-muted tabular-nums">{r.n}</td>
                    <td className="max-w-[18rem] truncate px-6" title={r.claim?.email}>
                      {r.claim?.email ?? <span className="text-muted">Person {r.n}</span>}
                      {r.claim && r.status === "sent" && (
                        <span className="block text-xs text-muted">{emailedLabel(r.claim)}</span>
                      )}
                    </td>
                    <td className="px-6 text-right font-bold tabular-nums">{formatUsd(r.amount)}</td>
                    <td className="max-w-[12rem] truncate px-6 text-muted" title={r.claim?.note}>
                      {r.claim?.note}
                    </td>
                    <td className="px-6">
                      <StatusChip status={r.status} />
                    </td>
                    <td className="px-6 py-2">
                      {r.status !== "sent" ? (
                        <span className="block text-right text-sm text-muted">{r.status === "claimed" ? "Used" : "Expired"}</span>
                      ) : r.claim && origin ? (
                        <div className="flex items-center justify-end gap-2">
                          <EmailLinkButton claim={r.claim} amount={r.amount} />
                          <ClaimLinkActions
                            link={buildClaimLink(origin, r.claim.privateKey as `0x${string}`)}
                            email={r.claim.email}
                            amount={r.amount}
                          />
                        </div>
                      ) : (
                        <span className="block text-right text-sm text-muted">Not on this device</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {config.useMock && counts.sent > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>Demo:</span>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                Expire unclaimed links
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Expire {counts.sent} unclaimed {counts.sent === 1 ? "link" : "links"}?</DialogTitle>
                <DialogDescription>
                  Simulates the claim window closing: {formatUsd(sum("sent"))} returns to your payout balance and those links stop
                  working. Demo mode only.
                </DialogDescription>
              </DialogHeader>
              {expire.isError && <p className="text-sm text-danger">{expire.error.message}</p>}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Keep them</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button
                    variant="destructive"
                    onClick={() =>
                      expire.mutate(undefined, {
                        onSuccess: () =>
                          posthog.capture("unclaimed_payouts_expired", {
                            recipient_count: counts.sent,
                            total_usd: Number(sum("sent")) / 1e6,
                          }),
                      })
                    }
                    disabled={expire.isPending}
                  >
                    {expire.isPending ? <Spinner className="size-4" /> : null} Expire links
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard"
      className="w-fit rounded-sm text-sm font-semibold text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      ← Overview
    </Link>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-2 font-display text-[28px] leading-none tracking-[-0.02em] tabular-nums">{value}</dd>
      {sub && <dd className="mt-2 text-sm text-muted">{sub}</dd>}
    </div>
  );
}

function ExportMenu({
  includeLinks,
  setIncludeLinks,
  onExport,
  canIncludeLinks,
}: {
  includeLinks: boolean;
  setIncludeLinks: (v: boolean) => void;
  onExport: () => void;
  canIncludeLinks: boolean;
}) {
  return (
    <Dialog onOpenChange={(open) => !open && setIncludeLinks(false)}>
      <DialogTrigger asChild>
        <Button variant="secondary">Export CSV</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export CSV</DialogTitle>
          <DialogDescription>Email, amount, note and status for everyone in this payout.</DialogDescription>
        </DialogHeader>
        {canIncludeLinks && (
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line p-3">
            <input
              type="checkbox"
              checked={includeLinks}
              onChange={(e) => setIncludeLinks(e.target.checked)}
              className="mt-1 size-4 accent-[var(--primary)]"
            />
            <span>
              <span className="block text-sm font-bold">Include claim links</span>
              <span className="block text-sm text-muted">
                Anyone with the file can claim the unclaimed money. Only use this to send links yourself, then delete the file.
              </span>
            </span>
          </label>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button onClick={onExport}>Download CSV</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
