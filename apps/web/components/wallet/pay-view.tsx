"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { requestFromParams } from "@/lib/payment-request";
import { WalletView } from "./wallet-view";

/** A scanned or tapped pay link: sign in, then a send screen already filled in, then home. */
export function PayView({ to, amount, note }: { to: string | null; amount: string | null; note: string | null }) {
  const router = useRouter();
  const request = useMemo(() => {
    const params = new URLSearchParams();
    if (to) params.set("to", to);
    if (amount) params.set("amount", amount);
    if (note) params.set("note", note);
    return requestFromParams(params);
  }, [to, amount, note]);

  if (!request) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 pb-10 text-center" role="alert">
        <h1 className="font-display text-[28px] leading-tight tracking-[-0.02em]">This payment link isn&apos;t complete</h1>
        <p className="text-muted">Ask the person to share their pay link or code again.</p>
        <Button asChild size="lg" className="mt-4 h-14 w-full">
          <Link href="/balance">Go to your balance</Link>
        </Button>
      </div>
    );
  }

  return <WalletView request={request} onRequestDone={() => router.replace("/balance")} />;
}
