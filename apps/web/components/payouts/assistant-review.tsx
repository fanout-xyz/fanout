"use client";

import { CircleAlert, Sparkles, Undo2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCentsPlain } from "@/lib/assist/amount";
import {
  canMerge,
  editAmount,
  editEmail,
  mergeDuplicates,
  needsAttention,
  summaryLine,
  type Flag,
  type ProposalSummary,
  type ProposedRow,
} from "@/lib/assist/proposal";
import { languageInfo } from "@/lib/i18n/languages";
import { cn } from "@/lib/utils";

type Props = {
  rows: ProposedRow[];
  flags: Map<number, Flag[]>;
  summary: ProposalSummary;
  emptyRows: number;
  /** "Email from "Customer email", amount from "Net"": which columns the assistant used. */
  mappingNote: string;
  demo: boolean;
  disabled: boolean;
  onChange: (rows: ProposedRow[]) => void;
};

const dollars = (value: string) => `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The spreadsheet assistant's rows, in the New payout review step. Flagged rows can be fixed in
 * place, merged (duplicates), confirmed (warnings) or left out. Every change re-runs the checks.
 */
export function AssistantReview({ rows, flags, summary, emptyRows, mappingNote, demo, disabled, onChange }: Props) {
  const [toCheckOnly, setToCheckOnly] = useState(false);
  const shown = toCheckOnly ? rows.filter((r) => needsAttention(r, flags.get(r.id))) : rows;
  const update = (id: number, fn: (r: ProposedRow) => ProposedRow) => onChange(rows.map((r) => (r.id === id ? fn(r) : r)));

  return (
    <section aria-labelledby="assist-title" className="rounded-lg border border-line bg-surface">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="assist-title" className="flex items-center gap-2 font-display text-2xl tracking-[-0.015em]">
            <Sparkles aria-hidden className="size-5 text-primary" /> Read by our assistant
          </h2>
          {summary.toCheck > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={toCheckOnly}
                onChange={(e) => setToCheckOnly(e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              Show only rows to check ({summary.toCheck})
            </label>
          )}
        </div>
        <p className="text-lg font-bold tabular-nums" aria-live="polite">
          {summaryLine(summary)}
        </p>
        <p className="text-sm text-muted">
          {mappingNote}
          {emptyRows > 0 ? ` ${emptyRows} empty or total ${emptyRows === 1 ? "row was" : "rows were"} left out.` : ""} Check the rows below: our
          assistant only suggests, and nothing is paid until you approve.
          {demo ? " Demo mode: a simple stand-in reads the columns, not the AI." : ""}
        </p>
      </div>

      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[660px] text-left text-[15px]">
          <thead className="sticky top-0 z-10 bg-surface text-sm text-muted shadow-[0_1px_0_var(--border)]">
            <tr>
              <th scope="col" className="w-12 px-4 py-3 font-semibold">Row</th>
              <th scope="col" className="px-3 py-3 font-semibold">Email</th>
              <th scope="col" className="w-32 px-3 py-3 text-right font-semibold">Amount</th>
              <th scope="col" className="px-3 py-3 font-semibold">Check</th>
              <th scope="col" className="w-12 px-3 py-3">
                <span className="sr-only">Leave out</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <Row
                key={row.id}
                row={row}
                flags={flags.get(row.id) ?? []}
                mergeTotal={row.dropped ? null : canMerge(rows, row.email)}
                disabled={disabled}
                onEmail={(v) => update(row.id, (r) => editEmail(r, v))}
                onAmount={(v) => update(row.id, (r) => editAmount(r, v))}
                onCheck={() => update(row.id, (r) => ({ ...r, checked: true }))}
                onDrop={(dropped) => update(row.id, (r) => ({ ...r, dropped }))}
                onMerge={() => onChange(mergeDuplicates(rows, row.email))}
              />
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-muted">
                  Nothing left to check.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({
  row,
  flags,
  mergeTotal,
  disabled,
  onEmail,
  onAmount,
  onCheck,
  onDrop,
  onMerge,
}: {
  row: ProposedRow;
  flags: Flag[];
  mergeTotal: bigint | null;
  disabled: boolean;
  onEmail: (v: string) => void;
  onAmount: (v: string) => void;
  onCheck: () => void;
  onDrop: (dropped: boolean) => void;
  onMerge: () => void;
}) {
  const blocking = flags.some((f) => f.blocking);
  const attention = needsAttention(row, flags);
  const emailFlag = flags.some((f) => f.kind === "missing-email" || f.kind === "invalid-email");
  const amountFlag = flags.some((f) => ["missing-amount", "bad-amount", "currency", "assistant-amount", "outlier", "above-usual"].includes(f.kind));
  const duplicate = flags.find((f) => f.kind === "duplicate");

  if (row.dropped) {
    return (
      <tr className="border-b border-line last:border-b-0 text-muted">
        <td className="h-12 px-4 tabular-nums">{row.sourceRow}</td>
        <td className="max-w-[16rem] truncate px-3 line-through" title={row.email}>
          {row.email || "(no email)"}
        </td>
        <td className="px-3 text-right line-through tabular-nums">{row.amount ? dollars(row.amount) : row.amountRaw}</td>
        <td className="px-3 text-sm">Left out</td>
        <td className="px-3">
          <Button variant="ghost" size="icon-sm" disabled={disabled} onClick={() => onDrop(false)} aria-label={`Put row ${row.sourceRow} back`}>
            <Undo2 aria-hidden />
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <tr className={cn("border-b border-line align-top last:border-b-0", blocking ? "bg-danger/5" : attention && "bg-warning/5")}>
      <td className="px-4 py-3 text-muted tabular-nums">{row.sourceRow}</td>
      <td className="max-w-[15rem] px-3 py-3">
        {emailFlag ? (
          <CellInput key={row.email} label={`Email for row ${row.sourceRow}`} value={row.email} disabled={disabled} onCommit={onEmail} invalid type="email" />
        ) : (
          <span className="block truncate" title={row.email}>
            {row.email}
          </span>
        )}
        {(row.name || row.language) && (
          <span className="mt-0.5 block truncate text-xs text-muted">
            {row.name}
            {row.name && row.language ? " · " : ""}
            {row.language ? `Email in ${languageInfo(row.language).name}` : ""}
          </span>
        )}
      </td>
      <td className="px-3 py-3 text-right">
        {amountFlag ? (
          <CellInput
            key={row.amount ?? row.amountRaw}
            label={`Dollar amount for row ${row.sourceRow}`}
            value={row.amount ?? ""}
            placeholder={row.amountRaw || "0.00"}
            disabled={disabled}
            onCommit={onAmount}
            invalid={flags.some((f) => f.kind === "missing-amount" || f.kind === "bad-amount" || f.kind === "currency")}
            inputMode="decimal"
            className="text-right"
          />
        ) : (
          <span className="font-bold whitespace-nowrap tabular-nums">{row.amount ? dollars(row.amount) : row.amountRaw}</span>
        )}
        {row.amountFrom !== "you" && row.amount && !/^\$?\d+(\.\d{1,2})?$/.test(row.amountRaw) && (
          <span className="mt-0.5 block text-xs whitespace-nowrap text-muted">from &ldquo;{row.amountRaw}&rdquo;</span>
        )}
        {row.note && <span className="mt-0.5 block truncate text-xs text-muted" title={row.note}>{row.note}</span>}
      </td>
      <td className="px-3 py-3">
        {flags.length === 0 ? (
          <span className="text-sm font-semibold text-success">Ready</span>
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-1">
              {flags.map((f) => (
                <li key={f.kind} className={cn("flex items-start gap-1.5 text-sm font-semibold", f.blocking ? "text-danger" : row.checked ? "text-muted" : "text-warning")}>
                  <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  <span>{f.message}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {duplicate && mergeTotal !== null && (
                <Button size="xs" variant="secondary" disabled={disabled} onClick={onMerge}>
                  Merge into one payment of {dollars(formatCentsPlain(mergeTotal))}
                </Button>
              )}
              {!blocking && !row.checked && (
                <Button size="xs" variant="secondary" disabled={disabled} onClick={onCheck}>
                  Looks right
                </Button>
              )}
              {!blocking && row.checked && <span className="text-xs font-semibold text-muted">Checked</span>}
            </div>
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        <Button variant="ghost" size="icon-sm" disabled={disabled} onClick={() => onDrop(true)} aria-label={`Leave out row ${row.sourceRow}`}>
          <X aria-hidden />
        </Button>
      </td>
    </tr>
  );
}

/** Commits on blur or Enter, so the checks don't jump while typing. */
function CellInput({
  label,
  value,
  onCommit,
  invalid,
  className,
  ...rest
}: { label: string; value: string; onCommit: (v: string) => void; invalid?: boolean; className?: string } & Omit<
  React.ComponentProps<"input">,
  "value" | "onChange"
>) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <input
      {...rest}
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      className={cn(
        "h-9 w-full min-w-0 rounded-sm border border-input bg-card-raised px-2 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger disabled:opacity-60",
        className,
      )}
    />
  );
}
