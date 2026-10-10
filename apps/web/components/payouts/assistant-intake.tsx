"use client";

import { Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { MAX_TABLE_CHARS } from "@/lib/assist/table";

/** What the platform is told before its table goes to the AI provider. */
export function AssistantConsent({ demo }: { demo: boolean }) {
  return (
    <p className="text-xs text-muted">
      {demo
        ? "Demo mode: a simple stand-in reads the columns here, and nothing leaves this server. With AI on, the table, including email addresses, is sent to our AI provider to read the columns."
        : "The table, including email addresses, is sent to our AI provider to read the columns. It isn't stored. Our assistant only suggests: you check every row and approve the payout."}
    </p>
  );
}

/** After a file without email and amount columns (or with amounts the plain reader refused). */
export function AssistOffer({
  fileName,
  reason,
  busy,
  demo,
  onRead,
  onCancel,
}: {
  fileName: string;
  reason: string;
  busy: boolean;
  demo: boolean;
  onRead: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-surface text-on-mint" aria-hidden>
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold">Let our assistant read {fileName}?</h2>
          <p className="mt-1 text-sm text-muted">{reason} Our assistant can find the email and amount columns and tidy up the amounts.</p>
        </div>
      </div>
      <AssistantConsent demo={demo} />
      <div className="flex flex-wrap gap-3">
        <Button onClick={onRead} disabled={busy} aria-busy={busy}>
          {busy ? (
            <>
              <Spinner className="size-4" /> Reading…
            </>
          ) : (
            "Read it with our assistant"
          )}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Choose another file
        </Button>
      </div>
    </div>
  );
}

/** Paste a table copied from a spreadsheet, an export or an email. */
export function PasteTable({ busy, demo, onRead, onCancel }: { busy: boolean; demo: boolean; onRead: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const id = useId();
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6">
      <div>
        <label htmlFor={id} className="text-lg font-bold">
          Paste who gets what
        </label>
        <p className="mt-1 text-sm text-muted">
          Copy the rows from Google Sheets, Excel, a Stripe or Shopify export, or an email. Any columns, any order, as long as there&apos;s an
          email and an amount for each person.
        </p>
      </div>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_TABLE_CHARS}
        rows={8}
        placeholder={"Name\tEmail\tEarned\nAna Silva\tana@example.com\t$1,200.00\nKofi Mensah\tkofi@example.com\t85"}
        className="w-full rounded-sm border border-input bg-card-raised p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <AssistantConsent demo={demo} />
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => onRead(text)} disabled={busy || !text.trim()} aria-busy={busy}>
          {busy ? (
            <>
              <Spinner className="size-4" /> Reading…
            </>
          ) : (
            "Read it with our assistant"
          )}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
