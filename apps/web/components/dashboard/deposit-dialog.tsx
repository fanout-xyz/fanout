"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { TxProgress, Spinner, type TxStage } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { config } from "@/lib/config";
import { useDeposit } from "@/lib/fanout/queries";
import { formatUsd, parseUsd } from "@/lib/money";
import { cn } from "@/lib/utils";

const QUICK = ["1,000", "5,000", "12,400"] as const;
/** Guardrail for the demo; a typo like 1000000 shouldn't go through silently. */
const MAX_DEPOSIT = "1,000,000";

type Phase = { kind: "form" } | { kind: "tx"; stage: TxStage; amount: bigint; txHash?: string };

export function DepositDialog() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const deposit = useDeposit();

  // "Preparing" is shown briefly; the mutation is "Confirming" until it resolves.
  useEffect(() => {
    if (phase.kind !== "tx" || phase.stage !== "preparing") return;
    const t = setTimeout(() => setPhase((p) => (p.kind === "tx" && p.stage === "preparing" ? { ...p, stage: "confirming" } : p)), 300);
    return () => clearTimeout(t);
  }, [phase]);

  function reset(nextOpen: boolean) {
    if (deposit.isPending) return; // don't lose track of an in-flight deposit
    setOpen(nextOpen);
    if (!nextOpen) {
      setValue("");
      setError(null);
      setPhase({ kind: "form" });
      deposit.reset();
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const amount = parseUsd(value);
    if (amount === null) return setError("Enter an amount in dollars, like 1,250.00.");
    if (amount <= 0n) return setError("Enter an amount more than $0.00.");
    if (amount > parseUsd(MAX_DEPOSIT)!) return setError(`The demo accepts up to $${MAX_DEPOSIT}.00 per deposit.`);
    setError(null);
    setPhase({ kind: "tx", stage: "preparing", amount });
    deposit.mutate(amount, {
      onSuccess: ({ txHash }) => {
        setPhase({ kind: "tx", stage: "done", amount, txHash });
        toast.success(`${formatUsd(amount)} added to your payout balance`);
      },
      onError: () => setPhase({ kind: "form" }),
    });
  }

  const parsed = parseUsd(value);

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="secondary">Deposit</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-[-0.015em]">Add to payout balance</DialogTitle>
          <DialogDescription>
            {config.useMock ? "Demo mode: this deposit is simulated." : "Moves AUSD from your account into your payout balance on Monad."}
          </DialogDescription>
        </DialogHeader>

        {phase.kind === "form" ? (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="deposit-amount">Amount (USD)</Label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden>
                  $
                </span>
                <Input
                  id="deposit-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  aria-invalid={!!error}
                  aria-describedby={error ? "deposit-error" : undefined}
                  className="pl-7 tabular-nums"
                  autoFocus
                />
              </div>
              {error && (
                <p id="deposit-error" className="text-sm text-danger">
                  {error}
                </p>
              )}
              {deposit.isError && !error && (
                <p className="text-sm text-danger" role="alert">
                  The deposit didn&apos;t go through: {deposit.error.message} Try again.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Quick amounts">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setValue(q);
                    setError(null);
                  }}
                  className={cn(
                    "h-9 rounded-full border border-line px-3 text-sm font-semibold tabular-nums transition-colors duration-150 outline-none hover:bg-card-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
                    value === q && "border-primary text-primary",
                  )}
                >
                  ${q}
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full sm:w-auto">
                {parsed && parsed > 0n ? `Deposit ${formatUsd(parsed)}` : "Deposit"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-6">
            <p className="font-display text-4xl tracking-[-0.02em] tabular-nums">{formatUsd(phase.amount)}</p>
            <TxProgress stage={phase.stage} txHash={phase.txHash} showTxLink={!config.useMock} />
            {phase.stage === "done" && config.useMock && (
              <p className="text-sm text-muted">Simulated transaction, so there&apos;s nothing to view on the explorer.</p>
            )}
            <DialogFooter>
              <Button onClick={() => reset(false)} disabled={phase.stage !== "done"} className="w-full sm:w-auto">
                {phase.stage === "done" ? (
                  "Done"
                ) : (
                  <>
                    <Spinner className="size-4" /> Depositing…
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
