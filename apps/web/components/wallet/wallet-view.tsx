"use client";

import { ArrowDownLeft, ArrowUpRight, HandCoins, ScanLine, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LocalAmount } from "@/components/payee/local-amount";
import { InstallPrompt } from "@/components/payee/install-prompt";
import { usePayeeBalance } from "@/lib/fanout/queries";
import { formatUsd, toCents } from "@/lib/money";
import { usePayeeAccount } from "@/lib/payee/payee-account";
import type { PaymentRequest } from "@/lib/payment-request";
import { shortAddress } from "@/lib/send-validation";
import { HistoryList } from "./history-list";
import { PassportCard } from "./passport-card";
import { PayeeAuthGate } from "./payee-auth-gate";
import { ReceiveView } from "./receive-view";
import { ScanView } from "./scan-view";
import { SendFlow } from "./send-flow";

type View =
  | { kind: "home" }
  | { kind: "send"; request?: PaymentRequest }
  | { kind: "receive" }
  | { kind: "request" }
  | { kind: "scan" };

/** The payee's account: balance card, the four ways to move money, then activity. */
export function WalletView({ request, onRequestDone }: { request?: PaymentRequest; onRequestDone?: () => void }) {
  return (
    <PayeeAuthGate>
      <Wallet request={request} onRequestDone={onRequestDone} />
    </PayeeAuthGate>
  );
}

function Wallet({ request, onRequestDone }: { request?: PaymentRequest; onRequestDone?: () => void }) {
  const payee = usePayeeAccount();
  const address = payee.address;
  const balance = usePayeeBalance();
  // A pay link (/pay?to=…) opens straight on a pre-filled send.
  const [view, setView] = useState<View>(request ? { kind: "send", request } : { kind: "home" });
  const home = () => {
    if (view.kind === "send" && view.request) onRequestDone?.();
    setView({ kind: "home" });
  };

  if (view.kind === "send" && balance.data !== undefined) {
    return (
      <SendFlow
        key={view.request?.to ?? "blank"}
        balance={balance.data}
        request={view.request}
        onClose={home}
        onScan={() => setView({ kind: "scan" })}
      />
    );
  }
  if ((view.kind === "receive" || view.kind === "request") && address) {
    return <ReceiveView address={address} onClose={home} startWithRequest={view.kind === "request"} />;
  }
  if (view.kind === "scan") {
    return <ScanView onClose={home} onResult={(req) => setView({ kind: "send", request: req })} />;
  }

  const empty = balance.data === 0n;
  const actions: { label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean }[] = [
    { label: "Send", icon: ArrowUpRight, onClick: () => setView({ kind: "send" }), disabled: balance.data === undefined || empty },
    { label: "Receive", icon: ArrowDownLeft, onClick: () => setView({ kind: "receive" }), disabled: !address },
    { label: "Scan", icon: ScanLine, onClick: () => setView({ kind: "scan" }), disabled: balance.data === undefined || empty },
    { label: "Request", icon: HandCoins, onClick: () => setView({ kind: "request" }), disabled: !address },
  ];

  return (
    <div className="flex flex-col gap-7 px-5 pt-4 pb-10">
      <section
        aria-labelledby="balance-label"
        className="relative isolate overflow-hidden rounded-xl border border-band-dark-border bg-band-dark px-6 pt-6 pb-5 text-cream shadow-[var(--shadow-float)]"
      >
        {/* The card: dark like a bank card in both themes, with the petals as its watermark. */}
        <PetalsMark size={180} color="var(--color-cobalt)" cutColor="var(--band-dark)" className="pointer-events-none absolute -top-10 -right-12 -z-10 opacity-40" />
        <div className="flex items-center justify-between">
          <h1 id="balance-label" className="text-sm font-semibold text-cream/70">
            Your balance
          </h1>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">USD</span>
        </div>
        {balance.isPending ? (
          <Skeleton className="mt-4 h-14 w-48 bg-white/10" />
        ) : balance.isError ? (
          <div className="mt-4 flex items-center gap-3" role="alert">
            <p>Couldn&apos;t load your balance.</p>
            <Button variant="secondary" size="sm" onClick={() => void balance.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            <p className="mt-3 font-display text-[clamp(44px,13vw,60px)] leading-none tracking-[-0.03em] tabular-nums">{formatUsd(balance.data)}</p>
            {balance.data > 0n && <LocalAmount cents={toCents(balance.data)} className="mt-2 text-cream/70" />}
          </>
        )}
        <div className="mt-6 flex items-end justify-between text-xs text-cream/60">
          <span className="font-mono tracking-wider">{address ? shortAddress(address) : "····"}</span>
          <span className="font-semibold tracking-wide">fanout</span>
        </div>
      </section>

      <nav aria-label="Move money" className="grid grid-cols-4 gap-2">
        {actions.map(({ label, icon: Icon, onClick, disabled }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="group flex flex-col items-center gap-2 rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-primary-solid text-primary-solid-fg transition-transform group-enabled:group-active:scale-95 group-enabled:group-hover:bg-primary-solid-hover">
              <Icon className="size-6" aria-hidden />
            </span>
            <span className="text-sm font-semibold">{label}</span>
          </button>
        ))}
      </nav>
      {empty && <p className="-mt-3 text-center text-sm text-muted">Nothing to send yet. Use Receive or Request to get paid.</p>}

      <PassportCard />

      <InstallPrompt />

      <HistoryList />

      <p className="text-center text-sm text-muted">Cash-out to local banks is on the roadmap.</p>
      <p className="-mt-4 text-center text-sm text-muted">
        {payee.signedIn ? "Signed in" : "Opened with your passkey"} as {payee.email ?? "you"}.{" "}
        <button
          type="button"
          onClick={() => void payee.signOut()}
          className="rounded-sm font-semibold text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Sign out
        </button>
      </p>
    </div>
  );
}
