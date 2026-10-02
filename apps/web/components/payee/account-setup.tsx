"use client";

import posthog from "posthog-js";
import { useState } from "react";
import type { Address } from "viem";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { PasskeyCancelled, PasskeyUnsupported, WrongPasskey } from "@/lib/payee/passkey-account";
import { usePayeeAccount } from "@/lib/payee/payee-account";

/**
 * One step between email sign-in and the money: the payee makes (or opens) their account with a
 * passkey. Payee copy only: no wallet, key or chain words.
 *
 * - "create": first claim on this device. Makes a new passkey account.
 * - "open": a returning payee on a new device. Their synced passkey reproduces the same account.
 */
export function AccountSetup({ mode: initialMode, onReady }: { mode: "create" | "open"; onReady?: (address: Address) => void }) {
  const payee = usePayeeAccount();
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; unsupported?: boolean } | null>(null);

  async function run() {
    setBusy(true);
    setProblem(null);
    try {
      if (mode === "create") {
        const address = await payee.create();
        posthog.capture("payee_account_ready", { kind: "passkey", via: "create" });
        onReady?.(address);
      } else {
        const unlocked = await payee.unlock();
        unlocked.end();
        posthog.capture("payee_account_ready", { kind: "passkey", via: "open" });
        onReady?.(unlocked.address);
      }
    } catch (err) {
      if (err instanceof PasskeyUnsupported) setProblem({ message: "This phone or browser can't do this step.", unsupported: true });
      else if (err instanceof PasskeyCancelled) {
        setProblem({
          message:
            mode === "open"
              ? "Nothing was opened. If this device has no account yet, choose Set up your account below."
              : "That was cancelled. Try again when you're ready.",
        });
      }
      else if (err instanceof WrongPasskey) setProblem({ message: err.message });
      else {
        console.error("[account-setup]", err instanceof Error ? err.message : err);
        setProblem({ message: "Something went wrong. Try again." });
      }
    } finally {
      setBusy(false);
    }
  }

  const canUse = payee.passkeysAvailable && !problem?.unsupported;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 pb-10 text-center">
      <PetalsMark size={48} color="var(--primary)" cutColor="var(--bg)" />
      <h1 className="font-display text-[28px] leading-tight tracking-[-0.02em]">
        {mode === "create" ? "Set up your account" : "Open your account"}
      </h1>
      <p className="text-muted">
        {mode === "create"
          ? "Your money goes to an account only you can open, with Face ID, your fingerprint or your phone's screen lock. No password to remember."
          : "Use the Face ID, fingerprint or screen lock you set up when you claimed."}
      </p>

      {canUse && (
        <Button size="lg" className="mt-4 h-14 w-full" onClick={() => void run()} disabled={busy}>
          {busy ? <Spinner className="size-4" /> : null}
          {mode === "create" ? "Continue" : "Open my account"}
        </Button>
      )}

      {canUse && (
        <button
          type="button"
          onClick={() => {
            setProblem(null);
            setMode(mode === "create" ? "open" : "create");
          }}
          className="rounded-sm text-sm font-semibold underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* Opening only finds a passkey this device already has; with none, the browser just offers
              a phone QR code. Setting up is what offers Touch ID, Face ID or the password manager. */}
          {mode === "create" ? "Already set up on another phone?" : "New here, or nothing to open? Set up your account"}
        </button>
      )}

      {problem && (
        <p role="alert" className={problem.unsupported ? "text-sm text-muted" : "text-sm text-danger"}>
          {problem.message}
        </p>
      )}

      {(!canUse || problem) && (
        <>
          {!payee.passkeysAvailable && <p className="text-sm text-muted">This browser can&apos;t do this step.</p>}
          <Button
            size="lg"
            variant={canUse ? "secondary" : "default"}
            className="h-14 w-full"
            onClick={() => {
              posthog.capture("payee_account_ready", { kind: "email", reason: problem?.unsupported || !payee.passkeysAvailable ? "unsupported" : "chosen" });
              payee.chooseEmailAccount();
            }}
          >
            Use my email account instead
          </Button>
          <p className="text-xs text-muted">Your money stays tied to the email you signed in with.</p>
        </>
      )}
    </div>
  );
}
