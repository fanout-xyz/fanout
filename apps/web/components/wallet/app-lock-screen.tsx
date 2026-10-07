"use client";

import { Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { PasskeyCancelled, PasskeyUnsupported, WrongPasskey } from "@/lib/payee/passkey-account";
import { usePayeeAccount } from "@/lib/payee/payee-account";

/**
 * Shown over the wallet until the payee passes their passkey (lib/payee/app-lock.ts). Passing it
 * calls payee.unlock(), which marks the app unlocked; the key it opens is zeroed straight away.
 */
export function AppLockScreen() {
  const payee = usePayeeAccount();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function unlock() {
    setBusy(true);
    setProblem(null);
    try {
      (await payee.unlock()).end();
    } catch (err) {
      if (err instanceof PasskeyCancelled) setProblem(null); // dismissed: the button stays for another go
      else if (err instanceof WrongPasskey) setProblem(err.message);
      else if (err instanceof PasskeyUnsupported) setProblem("This browser can't open your account. Try the browser you set it up in.");
      else {
        console.error("[app-lock]", err instanceof Error ? err.message : err);
        setProblem("Something went wrong. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  // Ask straight away when the app opens. Some browsers only allow the prompt after a tap; then
  // it's reported as cancelled and the button below does it.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 pb-10 text-center">
      <PetalsMark size={48} color="var(--primary)" cutColor="var(--bg)" />
      <h1 className="font-display text-[28px] leading-tight tracking-[-0.02em]">Fanout is locked</h1>
      <p className="text-muted">Unlock with Face ID, your fingerprint or your phone&apos;s screen lock.</p>

      <Button size="lg" className="mt-4 h-14 w-full" onClick={() => void unlock()} disabled={busy}>
        {busy ? <Spinner className="size-4" /> : <Lock className="size-4" aria-hidden />}
        Unlock
      </Button>

      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}

      <p className="mt-2 text-sm text-muted">
        Not {payee.email ?? "you"}?{" "}
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
