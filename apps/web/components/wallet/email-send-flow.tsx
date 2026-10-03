"use client";

import posthog from "posthog-js";
import { useState, type FormEvent } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSendToEmail } from "@/lib/fanout/queries";
import { formatUsd, parseUsd } from "@/lib/money";
import { cleanRequestNote } from "@/lib/payment-request";
import { cn } from "@/lib/utils";
import { BackButton, CopyButton } from "./wallet-ui";

export type SendMode = "address" | "email";

/** "To an address | To an email" at the top of Send. */
export function SendModeSwitch({ mode, onChange }: { mode: SendMode; onChange: (mode: SendMode) => void }) {
  return (
    <div role="tablist" aria-label="Send to" className="grid grid-cols-2 rounded-full border border-line bg-surface p-1">
      {(["address", "email"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={mode === m}
          onClick={() => onChange(m)}
          className={cn(
            "h-10 rounded-full text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
            mode === m ? "bg-primary-solid text-primary-solid-fg" : "text-muted hover:text-foreground",
          )}
        >
          {m === "address" ? "To an address" : "To an email"}
        </button>
      ))}
    </div>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step =
  | { kind: "form" }
  | { kind: "review"; email: string; amount: bigint; note?: string }
  | { kind: "sent"; email: string; amount: bigint; emailed: boolean; link: string };

/**
 * Pay anyone by email, even someone who has never used Fanout. They get an email with a link;
 * only someone signed in with that address can claim it.
 */
export function EmailSendFlow({ balance, onClose, onMode }: { balance: bigint; onClose: () => void; onMode: (mode: SendMode) => void }) {
  const send = useSendToEmail();
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ email?: string; amount?: string }>({});
  const [step, setStep] = useState<Step>({ kind: "form" });

  function review(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) next.email = "Enter the email of the person you're paying.";
    else if (!EMAIL.test(cleanEmail)) next.email = "That doesn't look like an email address.";
    const value = amount.trim() ? parseUsd(amount) : null;
    if (!amount.trim()) next.amount = "Enter how much to send.";
    else if (value === null) next.amount = "Enter an amount in dollars, like 25.00.";
    else if (value <= 0n) next.amount = "Enter an amount more than $0.00.";
    else if (value > balance) next.amount = `You have ${formatUsd(balance)}. Enter that or less.`;
    setErrors(next);
    if (next.email || next.amount || value === null) return;
    send.reset();
    setStep({ kind: "review", email: cleanEmail, amount: value, note: cleanRequestNote(note) });
  }

  function confirm() {
    if (step.kind !== "review") return;
    send.mutate(
      { email: step.email, amount: step.amount, note: step.note },
      {
        onSuccess: ({ emailed, link }) => {
          posthog.capture("wallet_email_payment_sent", { amount_usd: Number(step.amount) / 1e6, emailed });
          setStep({ kind: "sent", email: step.email, amount: step.amount, emailed, link });
        },
      },
    );
  }

  if (step.kind === "sent") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 pb-10 text-center" role="status">
        <PetalsMark size={56} color="var(--primary-solid)" cutColor="var(--bg)" fanOut />
        <h1 className="mt-4 font-display text-[40px] leading-none tracking-[-0.03em] tabular-nums">Sent {formatUsd(step.amount)}</h1>
        <p className="text-muted">to {step.email}</p>
        {step.emailed ? (
          <p className="mt-2 text-sm text-muted">We emailed them a link. They sign in with that email to get it.</p>
        ) : (
          <div className="mt-2 flex w-full flex-col gap-3">
            <p className="rounded-md bg-warning/10 px-4 py-3 text-sm text-warning">
              The money is sent, but the email didn&apos;t go out. Copy the link and send it to them yourself.
            </p>
            <div className="flex">
              <CopyButton text={step.link} label="Copy their link" />
            </div>
          </div>
        )}
        <Button size="lg" className="mt-8 h-14 w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }

  if (step.kind === "review") {
    return (
      <div className="flex flex-1 flex-col gap-6 px-5 pt-4 pb-6">
        <BackButton onClick={() => setStep({ kind: "form" })} disabled={send.isPending} label="Edit" />
        <div>
          <p className="text-muted">You&apos;re sending</p>
          <p className="mt-1 font-display text-[56px] leading-none tracking-[-0.03em] tabular-nums">{formatUsd(step.amount)}</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-muted">To</p>
          <p className="mt-1 text-lg font-semibold break-all">{step.email}</p>
          {step.note && <p className="mt-1 text-muted">For “{step.note}”</p>}
        </div>
        <ul className="flex flex-col gap-2 rounded-md bg-card-raised px-4 py-3 text-sm">
          <li>They get an email with a link. Only someone signed in with this email can claim it.</li>
          <li>If they don&apos;t claim it within 30 days, you can take it back.</li>
        </ul>
        {send.isError && (
          <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">
            {send.error.message}
          </p>
        )}
        <div className="mt-auto">
          <Button size="lg" className="h-14 w-full" onClick={confirm} disabled={send.isPending} aria-busy={send.isPending}>
            {send.isPending ? (
              <>
                <Spinner className="size-5" /> Sending…
              </>
            ) : (
              `Send ${formatUsd(step.amount)}`
            )}
          </Button>
          {send.isPending && <p className="mt-3 text-center text-sm text-muted">This takes up to half a minute. Keep this page open.</p>}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={review} noValidate className="flex flex-1 flex-col gap-6 px-5 pt-4 pb-6">
      <BackButton onClick={onClose} label="Back" />
      <h1 className="font-display text-[32px] leading-tight tracking-[-0.02em]">Send money</h1>
      <SendModeSwitch mode="email" onChange={onMode} />

      <div className="grid gap-2">
        <Label htmlFor="send-email">Their email</Label>
        <Input
          id="send-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "send-email-error" : "send-email-hint"}
          className="h-14 text-[16px]"
        />
        {errors.email ? (
          <p id="send-email-error" className="text-sm text-danger">
            {errors.email}
          </p>
        ) : (
          <p id="send-email-hint" className="text-sm text-muted">
            They don&apos;t need Fanout. They&apos;ll get a link to claim it.
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="send-email-amount">Amount</Label>
          <button
            type="button"
            onClick={() => setAmount(formatUsd(balance).replace(/[$,]/g, ""))}
            className="rounded-sm text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Max {formatUsd(balance)}
          </button>
        </div>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden>
            $
          </span>
          <Input
            id="send-email-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={!!errors.amount}
            aria-describedby={errors.amount ? "send-email-amount-error" : undefined}
            className="h-14 pl-7 text-lg tabular-nums"
          />
        </div>
        {errors.amount && (
          <p id="send-email-amount-error" className="text-sm text-danger">
            {errors.amount}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="send-email-note">Note (optional)</Label>
        <Input id="send-email-note" maxLength={80} placeholder="Thanks for the help!" value={note} onChange={(e) => setNote(e.target.value)} className="h-12" />
      </div>

      <div className="mt-auto">
        <Button type="submit" size="lg" className="h-14 w-full">
          Review
        </Button>
      </div>
    </form>
  );
}
