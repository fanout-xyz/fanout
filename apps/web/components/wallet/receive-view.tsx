"use client";

import posthog from "posthog-js";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd, parseUsd } from "@/lib/money";
import { cleanRequestNote, payLink, walletBase, type PaymentRequest } from "@/lib/payment-request";
import { BackButton, CopyButton, PayQr, ShareButton, groupAddress } from "./wallet-ui";

type Mode = { kind: "receive" } | { kind: "request-form" } | { kind: "request"; amount: bigint; note?: string };

/**
 * Get paid: a QR anyone's phone camera can scan, the address to copy, and a link to share.
 * "Request an amount" puts the amount and a note into the same link, so the payer only confirms.
 */
export function ReceiveView({ address, onClose, startWithRequest }: { address: `0x${string}`; onClose: () => void; startWithRequest?: boolean }) {
  const [mode, setMode] = useState<Mode>(startWithRequest ? { kind: "request-form" } : { kind: "receive" });
  const base = useMemo(() => (typeof window === "undefined" ? "" : walletBase(window.location)), []);

  if (mode.kind === "request-form") {
    return (
      <RequestForm
        onBack={() => (startWithRequest ? onClose() : setMode({ kind: "receive" }))}
        onDone={(amount, note) => {
          posthog.capture("wallet_request_created", { amount_usd: Number(amount) / 1e6, has_note: !!note });
          setMode({ kind: "request", amount, note });
        }}
      />
    );
  }

  const req: PaymentRequest = mode.kind === "request" ? { to: address, amount: mode.amount, note: mode.note } : { to: address };
  const link = base ? payLink(base, req) : "";
  const asking = mode.kind === "request";

  return (
    <div className="flex flex-1 flex-col gap-5 px-5 pt-4 pb-6">
      <BackButton onClick={asking ? () => setMode({ kind: "request-form" }) : onClose} label={asking ? "Change amount" : "Back"} />
      <div className="text-center">
        <h1 className="font-display text-[32px] leading-tight tracking-[-0.02em]">
          {asking ? `Request ${formatUsd(mode.amount)}` : "Receive money"}
        </h1>
        <p className="mt-1 text-muted">
          {asking
            ? mode.note
              ? `For “${mode.note}”. Whoever scans this pays exactly that.`
              : "Whoever scans this pays exactly that."
            : "Show this code, or share the link. Any phone camera can scan it."}
        </p>
      </div>

      {link && <PayQr value={link} title={asking ? `Pay ${formatUsd(mode.amount)} to ${address}` : `Pay ${address}`} />}

      <div className="rounded-lg border border-line bg-surface px-4 py-3">
        <p className="text-sm font-semibold text-muted">Your address</p>
        <p className="mt-1 font-mono text-[15px] leading-relaxed break-all">{groupAddress(address)}</p>
      </div>

      <div className="flex gap-3">
        <CopyButton text={asking ? link : address} label={asking ? "Copy link" : "Copy address"} />
        {link && (
          <ShareButton
            url={link}
            title="Pay me with Fanout"
            text={asking ? `Please pay me ${formatUsd(mode.amount)}${mode.note ? ` for ${mode.note}` : ""}:` : "Pay me with Fanout:"}
          />
        )}
      </div>

      {!asking && (
        <Button variant="ghost" className="h-12" onClick={() => setMode({ kind: "request-form" })}>
          Request a specific amount
        </Button>
      )}

      <p className="text-center text-sm text-muted">Only send US dollars (AUSD) on Monad to this address.</p>
    </div>
  );
}

function RequestForm({ onBack, onDone }: { onBack: () => void; onDone: (amount: bigint, note?: string) => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = amount.trim() ? parseUsd(amount) : null;
    if (!amount.trim()) return setError("Enter how much to ask for.");
    if (value === null) return setError("Enter an amount in dollars, like 25.00.");
    if (value <= 0n) return setError("Enter an amount more than $0.00.");
    onDone(value, cleanRequestNote(note));
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-6 px-5 pt-4 pb-6">
      <BackButton onClick={onBack} label="Back" />
      <h1 className="font-display text-[32px] leading-tight tracking-[-0.02em]">Request money</h1>

      <div className="grid gap-2">
        <Label htmlFor="request-amount">Amount</Label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden>
            $
          </span>
          <Input
            id="request-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
            aria-invalid={!!error}
            aria-describedby={error ? "request-amount-error" : undefined}
            className="h-14 pl-7 text-lg tabular-nums"
          />
        </div>
        {error && (
          <p id="request-amount-error" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="request-note">What it&apos;s for (optional)</Label>
        <Input id="request-note" maxLength={80} placeholder="Lunch on Friday" value={note} onChange={(e) => setNote(e.target.value)} className="h-12" />
      </div>

      <div className="mt-auto">
        <Button type="submit" size="lg" className="h-14 w-full">
          Create request
        </Button>
      </div>
    </form>
  );
}
