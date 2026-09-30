"use client";

import posthog from "posthog-js";
import { useState, type FormEvent } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/provider";
import { useSend } from "@/lib/fanout/queries";
import { formatUsd } from "@/lib/money";
import { checkSend, shortAddress } from "@/lib/send-validation";

type Step = { kind: "form" } | { kind: "review"; amount: bigint; to: `0x${string}` } | { kind: "sent"; amount: bigint; to: `0x${string}` };

/** Send dollars to an address. The address is the one thing shown as typed (guidelines §8). */
export function SendFlow({ balance, onClose }: { balance: bigint; onClose: () => void }) {
  const self = useAuth().user?.address;
  const send = useSend();
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [errors, setErrors] = useState<{ amount?: string; to?: string }>({});
  const [step, setStep] = useState<Step>({ kind: "form" });

  function review(e: FormEvent) {
    e.preventDefault();
    const result = checkSend({ amount, to }, balance, self);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    send.reset();
    setStep({ kind: "review", amount: result.amount, to: result.to });
  }

  function confirm() {
    if (step.kind !== "review") return;
    send.mutate({ to: step.to, amount: step.amount }, {
      onSuccess: () => {
        setStep({ ...step, kind: "sent" });
        posthog.capture("wallet_transfer_completed", {
          amount_usd: Number(step.amount) / 1e6,
        });
      },
    });
  }

  if (step.kind === "sent") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 pb-10 text-center" role="status">
        <PetalsMark size={56} color="var(--primary-solid)" cutColor="var(--bg)" fanOut />
        <h1 className="mt-4 font-display text-[40px] leading-none tracking-[-0.03em] tabular-nums">Sent {formatUsd(step.amount)}</h1>
        <p className="text-muted">to {shortAddress(step.to)}</p>
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
          <p className="text-sm font-semibold text-muted">To this address</p>
          {/* Full address, grouped in fours, so it's easy to compare with what the recipient gave you. */}
          <p className="mt-2 rounded-md border border-line bg-surface px-4 py-3 font-mono text-[15px] leading-relaxed break-all">
            {groupAddress(step.to)}
          </p>
        </div>
        <p className="rounded-md bg-warning/10 px-4 py-3 text-sm text-warning">
          Check the address carefully. Money sent to the wrong address can&apos;t be pulled back.
        </p>
        {send.isError && (
          <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">
            {humanSendError(send.error)}
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
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={review} noValidate className="flex flex-1 flex-col gap-6 px-5 pt-4 pb-6">
      <BackButton onClick={onClose} label="Back" />
      <h1 className="font-display text-[32px] leading-tight tracking-[-0.02em]">Send money</h1>

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="send-amount">Amount</Label>
          <button
            type="button"
            onClick={() => setAmount(formatUsd(balance).replace("$", ""))}
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
            id="send-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={!!errors.amount}
            aria-describedby={errors.amount ? "send-amount-error" : undefined}
            className="h-14 pl-7 text-lg tabular-nums"
          />
        </div>
        {errors.amount && (
          <p id="send-amount-error" className="text-sm text-danger">
            {errors.amount}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="send-to">Send to</Label>
        <Input
          id="send-to"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="0x…"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-invalid={!!errors.to}
          aria-describedby={errors.to ? "send-to-error" : "send-to-hint"}
          className="h-14 font-mono text-[15px]"
        />
        {errors.to ? (
          <p id="send-to-error" className="text-sm text-danger">
            {errors.to}
          </p>
        ) : (
          <p id="send-to-hint" className="text-sm text-muted">
            Paste the address the person you&apos;re paying gave you.
          </p>
        )}
      </div>

      <div className="mt-auto">
        <Button type="submit" size="lg" className="h-14 w-full">
          Review
        </Button>
      </div>
    </form>
  );
}

/** "0x5290 8400 0985 …" */
function groupAddress(address: string): string {
  return `0x ${(address.slice(2).match(/.{1,4}/g) ?? []).join(" ")}`;
}

function humanSendError(err: Error): string {
  if (/not enough/i.test(err.message)) return "You don't have enough for that. Nothing was sent.";
  if (/reach the server|connection/i.test(err.message)) return "You seem to be offline. Nothing was sent. Try again.";
  if (/sign in/i.test(err.message)) return "Your session ended. Sign in again, then send.";
  return "Something went wrong and nothing was sent. Try again in a moment.";
}

function BackButton({ onClick, label, disabled }: { onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-fit rounded-sm text-sm font-semibold text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      ← {label}
    </button>
  );
}
