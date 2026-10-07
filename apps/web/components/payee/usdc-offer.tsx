"use client";

import posthog from "posthog-js";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/provider";
import { config, usdcSettleEnabled } from "@/lib/config";
import { useReceiveAsUsdc } from "@/lib/fanout/queries";
import { formatUsd } from "@/lib/money";
import { PasskeyCancelled } from "@/lib/payee/passkey-account";
import { usePayeeAccount } from "@/lib/payee/payee-account";
import { cn } from "@/lib/utils";

/**
 * "Get it as USDC": changes `amount` of the payee's dollars to USDC in one step, no fee (our relayer
 * submits it). Shown after a claim and on the balance page. Hidden when USDC isn't set up, and when
 * there's nothing to change (except to confirm one that just went through).
 */
export function UsdcOffer({ amount, source, className }: { amount: bigint; source: "claim" | "balance"; className?: string }) {
  const payee = usePayeeAccount();
  const { login } = useAuth();
  const receive = useReceiveAsUsdc();

  if (!usdcSettleEnabled()) return null;

  if (receive.isSuccess) {
    return (
      <p role="status" className={cn("rounded-md bg-mint-surface px-4 py-3 text-center text-sm font-semibold text-on-mint", className)}>
        Done. {formatUsd(receive.data.amountOut, config.usdc.decimals)} is now in USDC.
      </p>
    );
  }
  if (amount <= 0n) return null;

  function start() {
    receive.mutate(amount, {
      onSuccess: () => {
        posthog.capture("usdc_settled", {
          amount_usd: Number(amount) / 10 ** config.stablecoin.decimals,
          // Right after a claim, or later from the balance page.
          source,
          demo_mode: config.useMock,
          $set: { has_usdc: true },
        });
      },
    });
  }

  const label = source === "claim" ? "Get it as USDC" : `Get ${formatUsd(amount)} as USDC`;
  const failed = receive.isError && !(receive.error instanceof PasskeyCancelled);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {failed && (
        <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-center text-sm font-semibold text-danger">
          {humanUsdcError(receive.error)}
        </p>
      )}
      {payee.signedIn ? (
        <Button size="lg" variant="secondary" className="h-14 w-full" onClick={start} disabled={receive.isPending} aria-busy={receive.isPending}>
          {receive.isPending ? (
            <>
              <Spinner className="size-5" /> Changing to USDC…
            </>
          ) : (
            label
          )}
        </Button>
      ) : (
        <Button size="lg" variant="secondary" className="h-14 w-full" onClick={login}>
          Sign in to get it as USDC
        </Button>
      )}
      <p className="text-center text-sm text-muted">Same dollars, as USDC. Takes about a second, no fee.</p>
    </div>
  );
}

/** Payee-facing wording; the relayer's messages are already plain, the rest is generic. */
function humanUsdcError(err: Error): string {
  const msg = err.message;
  if (/reach the server|connection/i.test(msg)) return "You seem to be offline. Nothing changed. Try again.";
  if (/session|sign in/i.test(msg)) return "Your session ended. Sign in again, then try again.";
  if (/not enough|less than|rate moved|took too long|isn't available|smaller amount/i.test(msg)) return msg;
  return "Something went wrong and nothing changed. Try again in a moment.";
}
