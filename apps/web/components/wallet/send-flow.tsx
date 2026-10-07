"use client";

import { ScanLine } from "lucide-react";
import posthog from "posthog-js";
import { useMemo, useState, type FormEvent } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePayeeAccount } from "@/lib/payee/payee-account";
import { usePayeeHistory, useSend } from "@/lib/fanout/queries";
import { formatUsd } from "@/lib/money";
import type { PaymentRequest } from "@/lib/payment-request";
import { checkSend, shortAddress } from "@/lib/send-validation";
import { EmailSendFlow, SendModeSwitch, type SendMode } from "./email-send-flow";
import { BackButton, groupAddress } from "./wallet-ui";

type Step =
  | { kind: "form" }
  | { kind: "review"; amount: bigint; to: `0x${string}` }
  | { kind: "sent"; amount: bigint; to: `0x${string}`; noFee: boolean };

/**
 * Send dollars to an address. The address is the one thing shown as typed (guidelines §8).
 * `request` pre-fills it from a scanned code or a pay link; the payer still reviews everything.
 */
export function SendFlow({
  balance,
  onClose,
  onScan,
  request,
}: {
  balance: bigint;
  onClose: () => void;
  onScan?: () => void;
  request?: PaymentRequest;
}) {
  const self = usePayeeAccount().address;
  const send = useSend();
  const history = usePayeeHistory();
  const [amount, setAmount] = useState(request?.amount ? formatUsd(request.amount).replace(/[$,]/g, "") : "");
  const [to, setTo] = useState<string>(request?.to ?? "");
  const note = request?.note;
  const [mode, setMode] = useState<SendMode>("address");
  // People this account sent to before, newest first: one tap instead of pasting again.
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return (history.data ?? [])
      .filter((i) => i.kind === "sent" && !i.toUsdc && !seen.has(i.counterparty.toLowerCase()) && seen.add(i.counterparty.toLowerCase()))
      .slice(0, 4)
      .map((i) => i.counterparty);
  }, [history.data]);
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
      onSuccess: ({ gasless }) => {
        setStep({ ...step, kind: "sent", noFee: gasless });
        posthog.capture("wallet_transfer_completed", {
          amount_usd: Number(step.amount) / 1e6,
          gasless,
        });
      },
    });
  }

  if (mode === "email") return <EmailSendFlow balance={balance} onClose={onClose} onMode={setMode} />;

  if (step.kind === "sent") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 pb-10 text-center" role="status">
        <PetalsMark size={56} color="var(--primary-solid)" cutColor="var(--bg)" fanOut />
        <h1 className="mt-4 font-display text-[40px] leading-none tracking-[-0.03em] tabular-nums">Sent {formatUsd(step.amount)}</h1>
        <p className="text-muted">to {shortAddress(step.to)}</p>
        {step.noFee && <p className="text-sm text-muted">No fee.</p>}
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
        {note && (
          <div>
            <p className="text-sm font-semibold text-muted">For</p>
            <p className="mt-1 text-lg">{note}</p>
          </div>
        )}
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
      {!request && <SendModeSwitch mode="address" onChange={setMode} />}
      {note && (
        <p className="-mt-3 rounded-md bg-card-raised px-4 py-3 text-sm">
          <span className="font-semibold">Payment request:</span> {note}
        </p>
      )}

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
        <div className="flex gap-2">
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
          {onScan && (
            <Button type="button" variant="secondary" size="icon-lg" className="shrink-0" onClick={onScan} aria-label="Scan a code">
              <ScanLine />
            </Button>
          )}
        </div>
        {errors.to ? (
          <p id="send-to-error" className="text-sm text-danger">
            {errors.to}
          </p>
        ) : (
          <p id="send-to-hint" className="text-sm text-muted">
            Paste the address the person you&apos;re paying gave you, or scan their code.
          </p>
        )}
        {recent.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2" aria-label="People you paid before">
            {recent.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setTo(a)}
                aria-pressed={to.toLowerCase() === a.toLowerCase()}
                className="rounded-full border border-line bg-surface px-3 py-1.5 font-mono text-sm outline-none hover:bg-card-raised focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:text-primary"
              >
                {shortAddress(a)}
              </button>
            ))}
          </div>
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

function humanSendError(err: Error): string {
  if (/not enough|don't have enough/i.test(err.message)) return "You don't have enough for that. Nothing was sent.";
  if (/already sent/i.test(err.message)) return "This was already sent. Check your activity before trying again.";
  if (/too long/i.test(err.message)) return "That took too long. Nothing was sent. Try again.";
  // Without a session the send goes from the account itself, which can't cover the fee. Signing in removes it.
  if (/network fees/i.test(err.message)) return "Your session ended. Sign in again, then send.";
  if (/reach the server|connection/i.test(err.message)) return "You seem to be offline. Nothing was sent. Try again.";
  if (/sign in/i.test(err.message)) return "Your session ended. Sign in again, then send.";
  return "Something went wrong and nothing was sent. Try again in a moment.";
}
