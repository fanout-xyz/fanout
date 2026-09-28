"use client";

import { useState } from "react";
import type { PayoutSheet } from "@/lib/csv";
import { formatUsd } from "@/lib/money";
import { cn } from "@/lib/utils";

export function PayoutPreview({ sheet }: { sheet: PayoutSheet }) {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const rows = problemsOnly ? sheet.rows.filter((r) => r.errors.length) : sheet.rows;

  return (
    <section aria-labelledby="preview-title" className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <h2 id="preview-title" className="font-display text-2xl tracking-[-0.015em]">
          Preview
        </h2>
        {sheet.errorRowCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={problemsOnly}
              onChange={(e) => setProblemsOnly(e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            Show only rows with problems ({sheet.errorRowCount})
          </label>
        )}
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[720px] text-left text-[15px]">
          <thead className="sticky top-0 z-10 bg-surface text-sm text-muted shadow-[0_1px_0_var(--border)]">
            <tr>
              <th scope="col" className="w-16 px-6 py-3 font-semibold">Line</th>
              <th scope="col" className="px-6 py-3 font-semibold">Email</th>
              <th scope="col" className="px-6 py-3 text-right font-semibold">Amount</th>
              <th scope="col" className="px-6 py-3 font-semibold">Note</th>
              <th scope="col" className="px-6 py-3 font-semibold">Check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const bad = row.errors.length > 0;
              return (
                <tr key={row.line} className={cn("border-b border-line last:border-b-0", bad && "bg-danger/5")}>
                  <td className="h-13 px-6 text-muted tabular-nums">{row.line}</td>
                  <td className="max-w-[18rem] truncate px-6" title={row.email}>
                    {row.email || <span className="text-muted">(empty)</span>}
                  </td>
                  <td className="px-6 text-right font-bold whitespace-nowrap tabular-nums">
                    {row.amount !== null && row.amount > 0n ? formatUsd(row.amount) : <span className="font-normal text-muted">{row.amountRaw || "(empty)"}</span>}
                  </td>
                  <td className="max-w-[14rem] truncate px-6 text-muted" title={row.note}>
                    {row.note}
                  </td>
                  <td className="px-6 py-2">
                    {bad ? (
                      <span className="flex items-start gap-1.5 text-sm font-semibold text-danger">
                        <AlertIcon />
                        <span>{row.errors.join(" ")}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-success">
                        <CheckIcon /> Ready
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 size-3.5 shrink-0" aria-hidden>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 4.8v3.6M8 11h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
