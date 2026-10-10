"use client";

import { Sparkles } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { MAX_FILE_BYTES, MAX_ROWS } from "@/lib/csv";
import { cn } from "@/lib/utils";

type Props = {
  onLoad: (text: string, fileName: string) => void;
  onError: (message: string) => void;
  /** With the spreadsheet assistant on: other text tables are accepted, and a table can be pasted. */
  assistant?: { onPaste: () => void };
};

export function CsvDropzone({ onLoad, onError, assistant }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

  async function readFile(file: File | undefined) {
    if (!file) return;
    const csv = /\.csv$/i.test(file.name) || file.type === "text/csv";
    const otherText = /\.(tsv|tab|txt)$/i.test(file.name) || file.type === "text/tab-separated-values" || file.type === "text/plain";
    if (assistant && /\.(xlsx?|numbers|ods)$/i.test(file.name)) {
      return onError(`"${file.name}" is a spreadsheet file. Save it as CSV first (in Google Sheets: File > Download > CSV), or copy the rows and paste them.`);
    }
    if (!csv && !(assistant && otherText)) return onError(`"${file.name}" isn't a CSV file.`);
    if (file.size > MAX_FILE_BYTES) return onError("That file is over 1 MB. Split it into smaller payouts.");
    try {
      onLoad(await file.text(), file.name);
    } catch {
      onError(`Couldn't read "${file.name}". Try saving it again as CSV.`);
    }
  }

  async function loadSample() {
    setLoadingSample(true);
    try {
      const res = await fetch("/sample-payouts.csv");
      if (!res.ok) throw new Error(String(res.status));
      onLoad(await res.text(), "sample-payouts.csv");
    } catch {
      onError("Couldn't load the sample file. Refresh and try again.");
    } finally {
      setLoadingSample(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void readFile(e.dataTransfer.files[0]);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center gap-4 rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors duration-150",
        dragging ? "border-primary bg-primary/5" : "border-line bg-surface",
      )}
    >
      <FileIcon />
      <div>
        <p className="text-lg font-bold">Drop a CSV here</p>
        <p id={hintId} className="mt-1 text-sm text-muted">
          Columns: <span className="font-semibold text-foreground">email, amount, note</span>. Amounts in dollars, up to {MAX_ROWS} rows.
          {assistant ? " Other columns or a messy export? Our assistant can read it." : ""}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="secondary" onClick={() => inputRef.current?.click()} aria-describedby={hintId}>
          Choose a file
        </Button>
        <Button variant="ghost" onClick={() => void loadSample()} disabled={loadingSample}>
          {loadingSample ? (
            <>
              <Spinner className="size-4" /> Loading…
            </>
          ) : (
            "Load sample (50 people)"
          )}
        </Button>
        {assistant && (
          <Button variant="ghost" onClick={assistant.onPaste}>
            <Sparkles aria-hidden className="size-4 text-primary" /> Paste a table
          </Button>
        )}
      </div>
      <a href="/sample-payouts.csv" download className="rounded-sm text-sm font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
        Download the sample to see the format
      </a>
      <input
        ref={inputRef}
        type="file"
        accept={assistant ? ".csv,text/csv,.tsv,.txt,text/plain,text/tab-separated-values,.xlsx,.xls" : ".csv,text/csv"}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void readFile(e.target.files?.[0]);
          e.target.value = ""; // allow re-choosing the same file
        }}
      />
    </div>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 40 48" className="h-14 w-12" aria-hidden>
      <path d="M6 2h20l12 12v28a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      <path d="M26 2v8a4 4 0 0 0 4 4h8" fill="none" stroke="var(--border)" strokeWidth="2" />
      <rect x="7" y="26" width="26" height="12" rx="4" fill="var(--color-cobalt)" />
      <text x="20" y="35" textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--color-cream)" fontFamily="var(--font-sans)">
        CSV
      </text>
    </svg>
  );
}
