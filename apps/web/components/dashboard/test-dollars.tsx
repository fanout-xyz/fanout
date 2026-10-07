"use client";

import posthog from "posthog-js";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/provider";
import { config } from "@/lib/config";
import { useTestDollars } from "@/lib/fanout/queries";
import { TestDollarsCooldown, testDollarsEnabled, testDollarsRetryAt } from "@/lib/fanout/test-dollars";
import { formatUsd } from "@/lib/money";
import { cn } from "@/lib/utils";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

/** A short wait (someone else just asked), as opposed to the once-a-day limit. */
const soon = (at: number) => at - Date.now() < 5 * 60_000;

const dayAndTime = (at: number) => new Date(at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/**
 * "Get test dollars": free dollars with no real value, so anyone trying Fanout can fund a payout
 * without asking anyone for money. Shown in the mock, and onchain only on the test network. Once a day.
 */
export function TestDollars() {
  const address = useAuth().user?.address;
  const get = useTestDollars();
  // Server snapshot is null, so the first render matches SSR; this browser's memory applies after hydration.
  const retryAt = useSyncExternalStore(subscribe, () => testDollarsRetryAt(address), () => null);
  const cooldown = get.error instanceof TestDollarsCooldown ? get.error : null;
  const waitUntil = cooldown?.retryAt ?? retryAt;

  // After a short wait, offer the button again without a reload.
  const [, rerender] = useState(0);
  const { reset } = get;
  useEffect(() => {
    if (!waitUntil || !soon(waitUntil)) return;
    const t = setTimeout(() => {
      reset();
      rerender((n) => n + 1);
    }, Math.max(0, waitUntil - Date.now()) + 500);
    return () => clearTimeout(t);
  }, [waitUntil, reset]);

  if (!testDollarsEnabled()) return null;

  function start() {
    get.mutate(undefined, {
      onSuccess: ({ amount }) => {
        posthog.capture("test_dollars_received", {
          amount_usd: Number(amount) / 10 ** config.stablecoin.decimals,
          demo_mode: config.useMock,
        });
        toast.success(`${formatUsd(amount)} in test dollars added`);
      },
    });
  }

  let status: { tone: "success" | "danger" | "muted"; text: string } | null = null;
  if (get.isSuccess) {
    status = {
      tone: "success",
      text: config.useMock
        ? `${formatUsd(get.data.amount)} in test dollars added to your payout balance.`
        : `${formatUsd(get.data.amount)} in test dollars added to your account. Deposit them to fund a payout.`,
    };
  } else if (cooldown) {
    status = { tone: "muted", text: cooldown.message };
  } else if (get.isError) {
    status = { tone: "danger", text: get.error.message };
  } else if (retryAt) {
    status = {
      tone: "muted",
      text: soon(retryAt)
        ? "Lots of people are trying Fanout right now. Try again in a minute."
        : `You've had your test dollars for today. You can get more after ${dayAndTime(retryAt)}.`,
    };
  }

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-semibold">Trying Fanout?</p>
        <p className="mt-1 text-sm text-muted">Test dollars for trying Fanout. They have no real value.</p>
        {status && (
          <p
            role={status.tone === "danger" ? "alert" : "status"}
            className={cn(
              "mt-3 text-sm",
              status.tone === "success" && "rounded-md bg-mint-surface px-4 py-3 font-semibold text-on-mint",
              status.tone === "danger" && "rounded-md bg-danger/10 px-4 py-3 font-semibold text-danger",
              status.tone === "muted" && "text-muted",
            )}
          >
            {status.text}
          </p>
        )}
      </div>
      <Button variant="secondary" onClick={start} disabled={get.isPending || get.isSuccess || !!waitUntil} aria-busy={get.isPending}>
        {get.isPending ? (
          <>
            <Spinner className="size-4" /> Getting test dollars…
          </>
        ) : get.isSuccess ? (
          "Test dollars added"
        ) : (
          "Get test dollars"
        )}
      </Button>
    </div>
  );
}
