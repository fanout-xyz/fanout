"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DepositDialog } from "@/components/dashboard/deposit-dialog";
import { Spinner, TxProgress, type TxStage } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { parsePayoutCsv, withoutErrorRows, type PayoutSheet } from "@/lib/csv";
import { config } from "@/lib/config";
import { useCreatePayout, useTreasuryBalance } from "@/lib/fanout/queries";
import { formatUsd } from "@/lib/money";
import { CsvDropzone } from "./csv-dropzone";
import { PayoutPreview } from "./payout-preview";
import { ScreeningCheck } from "./screening-check";

type Loaded = { sheet: PayoutSheet; fileName: string };

export function NewPayoutFlow() {
  const router = useRouter();
  const balance = useTreasuryBalance();
  const createPayout = useCreatePayout();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screened, setScreened] = useState(false);
  const [stage, setStage] = useState<TxStage | null>(null);

  const sheet = loaded?.sheet;
  const people = sheet?.rows.length ?? 0;
  const hasRowErrors = !!sheet && sheet.errorRowCount > 0;
  const hasFileErrors = !!sheet && sheet.fileErrors.length > 0;
  const shortfall = sheet && balance.data !== undefined && sheet.total > balance.data ? sheet.total - balance.data : 0n;
  const valid = !!sheet && people > 0 && !hasRowErrors && !hasFileErrors;
  const busy = stage !== null;
  const canApprove = valid && screened && shortfall === 0n && balance.isSuccess && !busy;

  const onPassed = useCallback(() => setScreened(true), []);

  // "Preparing" (claim links being generated) shows briefly, then "Confirming" until the payout lands.
  useEffect(() => {
    if (stage !== "preparing") return;
    const t = setTimeout(() => setStage((s) => (s === "preparing" ? "confirming" : s)), 300);
    return () => clearTimeout(t);
  }, [stage]);

  function load(text: string, fileName: string) {
    setLoadError(null);
    setScreened(false);
    createPayout.reset();
    setLoaded({ sheet: parsePayoutCsv(text), fileName });
  }

  function approve() {
    if (!sheet || !canApprove) return;
    setStage("preparing");
    createPayout.mutate(
      sheet.rows.map((r) => ({ email: r.email, amount: r.amount!, note: r.note })),
      {
        onSuccess: ({ batchId, linksSaved }) => {
          setStage("done");
          if (!linksSaved) toast.error("Payout sent, but claim links couldn't be saved in this browser.");
          else toast.success(`Paid ${people} ${people === 1 ? "person" : "people"}`);
          router.push(`/dashboard/payouts/${batchId}`);
        },
        onError: () => setStage(null),
      },
    );
  }

  const summary = useMemo(
    () =>
      sheet && [
        { label: "People", value: String(people) },
        { label: "Total", value: formatUsd(sheet.total) },
        {
          label: "Balance after",
          value: balance.data === undefined ? null : shortfall > 0n ? "Not enough" : formatUsd(balance.data - sheet.total),
        },
      ],
    [sheet, people, balance.data, shortfall],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] leading-tight tracking-[-0.02em]">New payout</h1>
          <p className="mt-1 text-muted">Upload who gets what. Everyone is paid in one transaction.</p>
        </div>
        {loaded && !busy && (
          <Button variant="secondary" onClick={() => setLoaded(null)}>
            Use a different file
          </Button>
        )}
      </div>

      {loadError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">
          {loadError}
        </p>
      )}

      {!loaded ? (
        <CsvDropzone onLoad={load} onError={setLoadError} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <p className="text-sm text-muted">
              From <span className="font-semibold text-foreground">{loaded.fileName}</span>
            </p>

            {hasFileErrors && (
              <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                <p className="font-bold">This file can&apos;t be used yet</p>
                <ul className="mt-1 list-disc pl-5">
                  {sheet!.fileErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {hasRowErrors && !hasFileErrors && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3">
                <p className="text-sm font-semibold text-danger">
                  {sheet!.errorRowCount} of {people} rows need fixing. Fix them in the file and upload again, or leave them out.
                </p>
                <Button variant="secondary" size="sm" onClick={() => setLoaded({ ...loaded, sheet: withoutErrorRows(sheet!) })}>
                  Leave out {sheet!.errorRowCount} {sheet!.errorRowCount === 1 ? "row" : "rows"}
                </Button>
              </div>
            )}

            {people > 0 && <PayoutPreview sheet={sheet!} />}
          </div>

          <aside aria-label="Payout summary" className="order-first flex flex-col gap-5 rounded-lg border border-line bg-surface p-6 lg:sticky lg:top-24 lg:order-none">
            <dl className="grid gap-3">
              {summary?.map((item) => (
                <div key={item.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-muted">{item.label}</dt>
                  <dd className="font-bold tabular-nums">{item.value ?? <Skeleton className="h-5 w-20" />}</dd>
                </div>
              ))}
            </dl>

            {balance.isError && (
              <p role="alert" className="text-sm text-danger">
                Couldn&apos;t check your balance.{" "}
                <button className="font-semibold underline" onClick={() => void balance.refetch()}>
                  Retry
                </button>
              </p>
            )}

            {shortfall > 0n && (
              <div role="alert" className="flex flex-col gap-3 rounded-md bg-danger/10 p-3">
                <p className="text-sm font-semibold text-danger">
                  This payout is {formatUsd(shortfall)} more than your balance of {formatUsd(balance.data!)}.
                </p>
                <DepositDialog />
              </div>
            )}

            {valid && <ScreeningCheck key={loaded.fileName + people} count={people} onPassed={onPassed} />}

            {createPayout.isError && (
              <p role="alert" className="text-sm text-danger">
                The payout didn&apos;t go through: {createPayout.error.message}
              </p>
            )}

            {busy ? (
              <TxProgress stage={stage} />
            ) : (
              <Button size="lg" className="w-full" disabled={!canApprove} onClick={approve}>
                {valid ? `Pay ${people} ${people === 1 ? "person" : "people"}` : "Pay"}
              </Button>
            )}
            {busy && stage !== "done" && (
              <p className="flex items-center gap-2 text-sm text-muted" role="status">
                <Spinner className="size-4" /> Paying {people} {people === 1 ? "person" : "people"}…
              </p>
            )}
            {!busy && valid && (
              <p className="text-xs text-muted">
                Each person gets a claim link. Unclaimed money returns to your balance.
                {config.useMock ? " Demo mode: nothing real is sent." : ""}
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
