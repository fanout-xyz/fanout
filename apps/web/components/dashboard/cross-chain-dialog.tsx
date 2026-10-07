"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Copy, ExternalLink } from "lucide-react";
import posthog from "posthog-js";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatToken, statusLabel, type Quote, type SourceOption, type StatusReply } from "@/lib/aurora";
import { useAuth } from "@/lib/auth/provider";
import { shortAddress } from "@/lib/send-validation";
import { cn } from "@/lib/utils";

type Sources = { enabled: boolean; sources: SourceOption[] };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again.");
  return data as T;
}

/** Shown only when Aurora is switched on (AURORA_APP_KEY on the server). */
export function CrossChainDialog() {
  const sources = useQuery({
    queryKey: ["aurora", "sources"],
    queryFn: async (): Promise<Sources> => (await fetch("/api/aurora/tokens")).json(),
    staleTime: 10 * 60_000,
  });
  if (!sources.data?.enabled || sources.data.sources.length === 0) return null;
  return <CrossChain sources={sources.data.sources} />;
}

function CrossChain({ sources }: { sources: SourceOption[] }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState(sources[0].assetId);
  const [amount, setAmount] = useState("");
  const [deposit, setDeposit] = useState<{ quote: Quote; source: SourceOption } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = sources.find((s) => s.assetId === assetId)!;
  const recipient = user?.address;
  const cleanAmount = amount.replace(/[$,\s]/g, "");
  const amountOk = /^\d+(\.\d{1,2})?$/.test(cleanAmount) && Number(cleanAmount) >= 1;

  // Live estimate (a dry quote: no deposit address, nothing to send yet).
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(amountOk ? cleanAmount : ""), 500);
    return () => clearTimeout(t);
  }, [cleanAmount, amountOk]);
  const estimate = useQuery({
    queryKey: ["aurora", "estimate", assetId, debounced, recipient],
    queryFn: () => post<{ quote: Quote }>("/api/aurora/quote", { originAsset: assetId, amountUsd: debounced, recipient, dry: true }),
    enabled: open && !deposit && !!debounced && !!recipient,
    retry: false,
  });

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setDeposit(null);
      setAmount("");
      setError(null);
    }
  }

  async function getAddress(e: FormEvent) {
    e.preventDefault();
    if (!amountOk || !recipient) return setError("Enter an amount of $1 or more.");
    setBusy(true);
    setError(null);
    try {
      const { quote } = await post<{ quote: Quote }>("/api/aurora/quote", { originAsset: assetId, amountUsd: cleanAmount, recipient, dry: false });
      if (!quote.depositAddress) throw new Error("Aurora didn't return a deposit address. Try again.");
      setDeposit({ quote, source });
      posthog.capture("cross_chain_deposit_started", { chain: source.chain, symbol: source.symbol, amount_usd: Number(cleanAmount) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't get a deposit address. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="ghost">From another chain</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-[-0.015em]">Add money from another chain</DialogTitle>
          <DialogDescription>
            Send USDC or USDT from Base, Arbitrum, Ethereum and more. It arrives as USDC in your account on Monad, routed by
            Aurora.
          </DialogDescription>
        </DialogHeader>

        {deposit ? (
          <DepositStep deposit={deposit} recipient={recipient!} onDone={() => reset(false)} />
        ) : (
          <form onSubmit={getAddress} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cc-source">Send from</Label>
              <select
                id="cc-source"
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                className="h-11 w-full rounded-sm border border-line bg-card-raised px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {sources.map((s) => (
                  <option key={s.assetId} value={s.assetId}>
                    {s.symbol} on {s.chainName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cc-amount">Amount to arrive (USD)</Label>
              <Input
                id="cc-amount"
                inputMode="decimal"
                placeholder="500.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={!!error}
              />
            </div>

            <div className="min-h-12 rounded-md bg-card-raised px-4 py-3 text-sm" aria-live="polite">
              {!amountOk ? (
                <span className="text-muted">Enter an amount to see the route.</span>
              ) : estimate.isFetching || !estimate.data ? (
                estimate.isError ? (
                  <span className="text-danger">{(estimate.error as Error).message}</span>
                ) : (
                  <span className="flex items-center gap-2 text-muted">
                    <Spinner className="size-4" /> Finding the best route…
                  </span>
                )
              ) : (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong className="tabular-nums">
                    {formatToken(estimate.data.quote.amountIn, source.decimals)} {source.symbol}
                  </strong>
                  <span className="text-muted">on {source.chainName}</span>
                  <ArrowRight aria-hidden className="size-4 text-muted" />
                  <strong className="tabular-nums">{estimate.data.quote.amountOutFormatted} USDC</strong>
                  <span className="text-muted">
                    on Monad{estimate.data.quote.timeEstimate ? `, in about ${Math.max(1, Math.round(estimate.data.quote.timeEstimate / 60))} min` : ""}
                  </span>
                </span>
              )}
            </div>

            {error && (
              <p role="alert" className="text-sm font-semibold text-danger">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy || !amountOk} aria-busy={busy}>
              {busy ? (
                <>
                  <Spinner className="size-4" /> Getting your deposit address…
                </>
              ) : (
                "Get deposit address"
              )}
            </Button>
            {recipient && (
              <p className="text-center text-xs text-muted">
                Arrives in your account {shortAddress(recipient)} on Monad mainnet. Refunds go back to the same address.
              </p>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DepositStep({ deposit, recipient, onDone }: { deposit: { quote: Quote; source: SourceOption }; recipient: string; onDone: () => void }) {
  const { quote, source } = deposit;
  const address = quote.depositAddress!;
  const send = `${formatToken(quote.amountIn, source.decimals)} ${source.symbol}`;
  const status = useQuery({
    queryKey: ["aurora", "status", address],
    queryFn: async (): Promise<StatusReply> => {
      const res = await fetch(`/api/aurora/status?depositAddress=${encodeURIComponent(address)}`);
      if (!res.ok) throw new Error("status");
      return res.json();
    },
    refetchInterval: (q) => (q.state.data && statusLabel(q.state.data.status).done ? false : 5000),
  });
  const s = status.data ? statusLabel(status.data.status) : null;
  const succeeded = status.data?.status === "SUCCESS";

  useEffect(() => {
    if (succeeded) posthog.capture("cross_chain_deposit_arrived", { chain: source.chain, symbol: source.symbol });
  }, [succeeded, source.chain, source.symbol]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy. Select the address and copy it by hand.");
    }
  }

  if (succeeded) {
    const tx = status.data?.swapDetails?.destinationChainTxHashes?.[0];
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-mint-surface text-success" aria-hidden>
          <Check className="size-6" />
        </span>
        <p className="font-display text-2xl tracking-[-0.015em]">{status.data?.swapDetails?.amountOutFormatted ?? quote.amountOutFormatted} USDC arrived</p>
        <p className="text-sm text-muted">It&apos;s in your account {shortAddress(recipient)} on Monad.</p>
        {tx?.explorerUrl && (
          <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-4">
            View transaction <ExternalLink aria-hidden className="size-3.5" />
          </a>
        )}
        <Button className="mt-2 w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[15px]">
        Send <strong className="tabular-nums">{send}</strong> on <strong>{source.chainName}</strong> to this address:
      </p>
      <div className="flex items-center gap-4 rounded-md border border-line p-3">
        {/* QR stays dark-on-white in both themes so any wallet camera can read it. */}
        <div className="shrink-0 rounded-sm bg-white p-2">
          <QRCodeSVG value={address} size={96} level="M" marginSize={0} title={`Deposit address on ${source.chainName}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs break-all">{address}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void copy()}>
            <Copy aria-hidden className="size-3.5" /> Copy address
          </Button>
        </div>
      </div>
      <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning" role="note">
        Only send {source.symbol} on {source.chainName}. Anything else sent here may be lost. If less than {send} arrives, it&apos;s
        refunded to {shortAddress(recipient)}.
      </p>
      <div className={cn("flex items-center gap-2 text-sm", s?.failed ? "text-danger" : "text-muted")} aria-live="polite">
        {!s?.done && <Spinner className="size-4" />}
        {s ? s.label : "Checking for your transfer…"}
      </div>
    </div>
  );
}
