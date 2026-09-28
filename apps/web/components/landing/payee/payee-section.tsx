"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { ClaimScreen, type ClaimScreenState } from "@/components/claim/claim-screen";
import { PhoneFrame } from "./phone-frame";

const POINTS = ["Claim with email and a passkey", "Hold it in dollars", "Send it on anytime"] as const;
const CLAIMING_MS = 900;

export function PayeeSection() {
  const reduced = useReducedMotion() ?? false;
  const [state, setState] = useState<ClaimScreenState>("ready");

  useEffect(() => {
    if (state !== "claiming") return;
    const t = setTimeout(() => setState("success"), reduced ? 0 : CLAIMING_MS);
    return () => clearTimeout(t);
  }, [state, reduced]);

  return (
    <section aria-labelledby="payee-title" className="bg-mint-surface py-20 lg:py-28">
      <div className="mx-auto grid w-full max-w-[1280px] items-center gap-14 px-6 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2
            id="payee-title"
            className="max-w-[14ch] font-display text-[clamp(40px,5vw,64px)] leading-[1.05] tracking-[-0.03em] text-balance text-foreground"
          >
            No app. No wallet. Just a link.
          </h2>
          <ul className="mt-10 flex flex-col gap-5">
            {POINTS.map((point) => (
              <li key={point} className="flex items-center gap-4 text-lg font-semibold text-foreground">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface">
                  <PetalsMark size={22} color="var(--on-mint-icon)" cutColor="var(--card)" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col items-center gap-4">
          <PhoneFrame>
            <ClaimScreen
              state={state}
              amountCents={8_000}
              platform="Studio Norte"
              note="Weekly earnings"
              onClaim={() => setState("claiming")}
              reduced={reduced}
            />
          </PhoneFrame>
          <div className="h-6">
            {state === "success" ? (
              <button
                type="button"
                onClick={() => setState("ready")}
                className="rounded-sm text-sm font-bold text-foreground underline underline-offset-4 outline-none hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-mint-surface"
              >
                Replay
              </button>
            ) : (
              <p className="text-sm text-muted">Try it: tap the button</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
