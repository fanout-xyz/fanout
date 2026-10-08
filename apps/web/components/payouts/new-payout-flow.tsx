"use client";

import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DepositDialog } from "@/components/dashboard/deposit-dialog";
import { Spinner, TxProgress, type TxStage } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAiPost, useAiStatus } from "@/lib/ai/use-ai";
import { buildProposal, flagRows, proposalToCsv, summarize, type ProposedRow, type SheetReading } from "@/lib/assist/proposal";
import { readTable, tableForAi, TableUnreadable, type Table } from "@/lib/assist/table";
import { parsePayoutCsv, withoutErrorRows, type PayoutSheet } from "@/lib/csv";
import { CLAIM_WINDOW_OPTIONS, DEFAULT_CLAIM_WINDOW_SECONDS } from "@/lib/claim-window";
import { claimWindowEnabled, config } from "@/lib/config";
import { useCreatePayout, useTreasuryBalance } from "@/lib/fanout/queries";
import { formatUsd } from "@/lib/money";
import { AssistantReview } from "./assistant-review";
import { AssistOffer, PasteTable } from "./assistant-intake";
import { CsvDropzone } from "./csv-dropzone";
import { PayoutPreview } from "./payout-preview";
import { ScreeningCheck } from "./screening-check";

/** A plain CSV upload, or rows the spreadsheet assistant proposed (checked and edited before approval). */
type Source =
  | { kind: "csv"; sheet: PayoutSheet }
  | { kind: "assist"; rows: ProposedRow[]; emptyRows: number; mappingNote: string };
type Loaded = { fileName: string; text: string; source: Source };
/** Before anything is loaded: pasting a table, or offering the assistant for a file the plain reader can't use. */
type Intake = { kind: "paste" } | { kind: "offer"; text: string; fileName: string; reason: string };

export function NewPayoutFlow() {
  const router = useRouter();
  const balance = useTreasuryBalance();
  const createPayout = useCreatePayout();
  const ai = useAiStatus();
  const aiPost = useAiPost();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [intake, setIntake] = useState<Intake | null>(null);
  const [reading, setReading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screened, setScreened] = useState(false);
  const [stage, setStage] = useState<TxStage | null>(null);
  const [claimWindow, setClaimWindow] = useState<number>(DEFAULT_CLAIM_WINDOW_SECONDS);
  // Balance when the payout was approved. After it lands the query refetches the lower balance,
  // which would otherwise have the total subtracted a second time in "Balance after".
  const [balanceAtApprove, setBalanceAtApprove] = useState<bigint | undefined>(undefined);
  const shownBalance = stage !== null && balanceAtApprove !== undefined ? balanceAtApprove : balance.data;

  const source = loaded?.source;
  const assistRows = source?.kind === "assist" ? source.rows : null;
  const assistFlags = useMemo(() => (assistRows ? flagRows(assistRows) : null), [assistRows]);
  const assistSummary = useMemo(() => (assistRows && assistFlags ? summarize(assistRows, assistFlags) : null), [assistRows, assistFlags]);
  // The assistant's rows go through the same checks as an upload: as a CSV, through parsePayoutCsv.
  const sheet = useMemo(
    () => (!source ? undefined : source.kind === "csv" ? source.sheet : parsePayoutCsv(proposalToCsv(source.rows))),
    [source],
  );
  const toCheck = assistSummary?.toCheck ?? 0;
  const people = sheet?.rows.length ?? 0;
  const hasRowErrors = !!sheet && sheet.errorRowCount > 0;
  const hasFileErrors = !!sheet && sheet.fileErrors.length > 0;
  const shortfall = sheet && shownBalance !== undefined && sheet.total > shownBalance ? sheet.total - shownBalance : 0n;
  const valid = !!sheet && people > 0 && !hasRowErrors && !hasFileErrors && toCheck === 0;
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
    const parsedSheet = parsePayoutCsv(text);
    setLoadError(null);
    setScreened(false);
    createPayout.reset();
    // Other columns (an export, a pasted range): offer the assistant instead of a dead end.
    if (ai.on && parsedSheet.rows.length === 0 && parsedSheet.fileErrors.some((e) => e.startsWith("Missing column"))) {
      setLoaded(null);
      setIntake({ kind: "offer", text, fileName, reason: "It doesn't have email and amount columns." });
      return;
    }
    setIntake(null);
    setLoaded({ source: { kind: "csv", sheet: parsedSheet }, fileName, text });
    posthog.capture("payout_csv_loaded", {
      recipient_count: parsedSheet.rows.length,
      invalid_row_count: parsedSheet.errorRowCount,
      has_file_errors: parsedSheet.fileErrors.length > 0,
    });
  }

  async function readWithAssistant(text: string, fileName: string) {
    setReading(true);
    setLoadError(null);
    try {
      let table: Table;
      try {
        table = readTable(text);
      } catch (err) {
        throw new Error(err instanceof TableUnreadable ? `Couldn't read it: ${err.message}` : "Couldn't read it.");
      }
      const reading = await aiPost<SheetReading>("/api/ai/read-sheet", tableForAi(table));
      const { rows, emptyRows } = buildProposal(table, reading);
      if (rows.length === 0) throw new Error("Our assistant didn't find anyone to pay in it.");
      setScreened(false);
      createPayout.reset();
      setIntake(null);
      setLoaded({ fileName, text, source: { kind: "assist", rows, emptyRows, mappingNote: describeMapping(table, reading) } });
      posthog.capture("payout_assistant_read", {
        recipient_count: rows.length,
        to_check_count: summarize(rows, flagRows(rows)).toCheck,
        ai_mode: ai.mode,
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Our assistant couldn't read it. Try again.");
    } finally {
      setReading(false);
    }
  }

  function setAssistRows(rows: ProposedRow[]) {
    if (!loaded || loaded.source.kind !== "assist") return;
    setScreened(false);
    setLoaded({ ...loaded, source: { ...loaded.source, rows } });
  }

  function leaveOutProblems() {
    if (!loaded || !sheet) return;
    if (loaded.source.kind === "csv") return setLoaded({ ...loaded, source: { kind: "csv", sheet: withoutErrorRows(sheet) } });
    const flags = assistFlags!;
    setAssistRows(loaded.source.rows.map((r) => (flags.get(r.id)?.some((f) => f.blocking) ? { ...r, dropped: true } : r)));
  }

  function reset() {
    setLoaded(null);
    setIntake(null);
    setLoadError(null);
  }

  function approve() {
    if (!sheet || !canApprove) return;
    setBalanceAtApprove(balance.data);
    setStage("preparing");
    createPayout.mutate(
      { rows: sheet.rows.map((r) => ({ email: r.email, amount: r.amount!, note: r.note })), claimWindowSeconds: claimWindow },
      {
        onSuccess: ({ batchId, emailed }) => {
          setStage("done");
          const emailedCount = "sent" in emailed ? emailed.sent.length : 0;
          posthog.capture("payout_created", {
            recipient_count: people,
            total_usd: Number(sheet.total) / 1e6,
            demo_mode: config.useMock,
            emailed_count: emailedCount,
            claim_window_seconds: claimWindow,
            // Person properties for retention: split platforms from payees, and know when each started.
            $set: { is_platform: true },
            $set_once: { first_payout_at: new Date().toISOString() },
          });
          const paid = `Paid ${people} ${people === 1 ? "person" : "people"}`;
          if (emailedCount === people) {
            toast.success(`${paid}. Everyone has an email with their link.`);
          } else {
            toast.success(paid);
            const why = "error" in emailed ? emailed.error : emailed.failed[0]?.reason;
            toast.warning(
              emailedCount === 0
                ? "No links were emailed. Copy them from the payout page."
                : `Emailed ${emailedCount} of ${people} links. Copy the rest from the payout page.`,
              { description: why, duration: 10_000 },
            );
          }
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
          value: shownBalance === undefined ? null : shortfall > 0n ? "Not enough" : formatUsd(shownBalance - sheet.total),
        },
      ],
    [sheet, people, shownBalance, shortfall],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] leading-tight tracking-[-0.02em]">New payout</h1>
          <p className="mt-1 text-muted">Upload who gets what. Everyone is paid in one transaction.</p>
        </div>
        {(loaded || intake) && !busy && !reading && (
          <Button variant="secondary" onClick={reset}>
            Use a different file
          </Button>
        )}
      </div>

      {loadError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">
          {loadError}
        </p>
      )}

      {!loaded && intake?.kind === "paste" ? (
        <PasteTable busy={reading} demo={ai.demo} onRead={(text) => void readWithAssistant(text, "Pasted table")} onCancel={reset} />
      ) : !loaded && intake?.kind === "offer" ? (
        <AssistOffer
          fileName={intake.fileName}
          reason={intake.reason}
          busy={reading}
          demo={ai.demo}
          onRead={() => void readWithAssistant(intake.text, intake.fileName)}
          onCancel={reset}
        />
      ) : !loaded ? (
        <CsvDropzone onLoad={load} onError={setLoadError} assistant={ai.on ? { onPaste: () => setIntake({ kind: "paste" }) } : undefined} />
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
                  {sheet!.errorRowCount} of {people} rows need fixing.{" "}
                  {loaded.source.kind === "assist" ? "Fix them below, or leave them out." : "Fix them in the file and upload again, or leave them out."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {ai.on && loaded.source.kind === "csv" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const { text, fileName } = loaded;
                        const n = sheet!.errorRowCount;
                        setLoaded(null);
                        setIntake({ kind: "offer", text, fileName, reason: `${n} ${n === 1 ? "row has" : "rows have"} emails or amounts the plain reader couldn't use.` });
                      }}
                    >
                      Fix with our assistant
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={leaveOutProblems}>
                    Leave out {sheet!.errorRowCount} {sheet!.errorRowCount === 1 ? "row" : "rows"}
                  </Button>
                </div>
              </div>
            )}

            {loaded.source.kind === "assist" && assistFlags && assistSummary ? (
              <AssistantReview
                rows={loaded.source.rows}
                flags={assistFlags}
                summary={assistSummary}
                emptyRows={loaded.source.emptyRows}
                mappingNote={loaded.source.mappingNote}
                demo={ai.demo}
                disabled={busy}
                onChange={setAssistRows}
              />
            ) : (
              people > 0 && <PayoutPreview sheet={sheet!} />
            )}
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
                  This payout is {formatUsd(shortfall)} more than your balance of {formatUsd(shownBalance!)}.
                </p>
                <DepositDialog />
              </div>
            )}

            {toCheck > 0 && !busy && (
              <p className="rounded-md bg-warning/10 p-3 text-sm font-semibold text-warning">
                Check {toCheck} {toCheck === 1 ? "row" : "rows"} first: fix, confirm or leave out each flagged row.
              </p>
            )}

            {valid && claimWindowEnabled() && <ClaimWindowPicker value={claimWindow} onChange={setClaimWindow} disabled={busy} />}

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
                Each person gets a claim link. Unclaimed money returns to your balance after {claimWindowLabel(claimWindow)}.
                {config.useMock ? " Demo mode: nothing real is sent." : ""}
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

/** Which columns the assistant used: "Email from "Customer Email", amount from "Net"." */
function describeMapping(table: Table, reading: SheetReading): string {
  const c = reading.columns;
  const named = (label: string, i: number | null) => (i === null ? null : `${label} from "${table.headers[i]}"`);
  const parts = [named("Email", c.email), named("amount", c.amount), named("name", c.name), named("note", c.note), named("language", c.language), named("country", c.country)];
  return `${parts.filter(Boolean).join(", ")}.`;
}

/** "30 days", "10 minutes": the option's label without "(default)". */
function claimWindowLabel(seconds: number): string {
  const option = CLAIM_WINDOW_OPTIONS.find((o) => o.seconds === seconds);
  return option ? option.label.replace(" (default)", "") : `${Math.round(seconds / 60)} minutes`;
}

/** Advanced: how long claim links work before unclaimed money returns to the balance. */
function ClaimWindowPicker({ value, onChange, disabled }: { value: number; onChange: (seconds: number) => void; disabled: boolean }) {
  const custom = value !== DEFAULT_CLAIM_WINDOW_SECONDS;
  return (
    <details className="rounded-md border border-line px-3 py-2 text-sm" open={custom || undefined}>
      <summary className="cursor-pointer font-semibold">
        Advanced{custom ? <span className="font-normal text-muted"> · returns after {claimWindowLabel(value)}</span> : null}
      </summary>
      <div className="mt-3 flex flex-col gap-2">
        <label htmlFor="claim-window" className="text-sm text-muted">
          Unclaimed money returns after
        </label>
        <select
          id="claim-window"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-11 w-full rounded-sm border border-line bg-card-raised px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {CLAIM_WINDOW_OPTIONS.map((o) => (
            <option key={o.seconds} value={o.seconds}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted">After that, you can return what wasn&apos;t claimed to your balance, and those links stop working.</p>
      </div>
    </details>
  );
}
