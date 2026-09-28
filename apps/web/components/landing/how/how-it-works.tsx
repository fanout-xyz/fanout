"use client";

import { AnimatePresence, m, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { SCENES } from "./scenes";
import { STEPS } from "./steps";
import { useActiveStep } from "./use-active-step";

const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-18 bg-cream py-18 lg:py-36">
      <div className="mx-auto w-full max-w-[1280px] px-6">
        <h2
          id="how-title"
          className="max-w-[18ch] font-display text-[clamp(36px,5vw,56px)] leading-[1.08] tracking-[-0.03em] text-balance text-ink"
        >
          Three steps. No crypto knowledge needed.
        </h2>
        <DesktopSteps />
        <MobileSteps />
        <p className="mt-6 text-xs tracking-[0.01em] text-muted">Illustrative example</p>
      </div>
    </section>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-cobalt text-sm font-bold text-cream">
      {n}
    </span>
  );
}

function DesktopSteps() {
  const stepRefs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useActiveStep(stepRefs, STEPS.length);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardInView = useInView(cardRef, { amount: 0.5 });
  const reduced = useReducedMotion() ?? false;
  const Scene = SCENES[active];

  return (
    <div className="mt-6 hidden grid-cols-2 gap-16 lg:grid">
      <ol>
        {STEPS.map((step, i) => (
          <li key={step.title} ref={(el) => void (stepRefs.current[i] = el)} data-step={i} className="flex min-h-[60vh] items-center">
            <button
              type="button"
              onClick={() => setActive(i)}
              aria-current={active === i ? "step" : undefined}
              className={cn(
                "flex w-full items-start gap-5 rounded-lg p-4 -m-4 text-left outline-none transition-opacity duration-200 focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
                active === i ? "opacity-100" : "opacity-45 hover:opacity-75",
              )}
            >
              <StepNumber n={i + 1} />
              <span>
                <span className="block font-display text-2xl tracking-[-0.015em] text-ink">{step.title}</span>
                <span className="mt-2 block max-w-[40ch] text-base font-medium text-muted">{step.body}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="relative">
        <div
          ref={cardRef}
          aria-hidden
          className="sticky top-[calc(50vh-200px)] h-[400px] w-full max-w-[520px] overflow-hidden rounded-lg border border-line bg-surface"
        >
          {/* Crossfade: the outgoing scene fades out on top while the new one fades in. */}
          <AnimatePresence initial={false}>
            <m.div
              key={active}
              className="absolute inset-6"
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: EASE_OUT }}
            >
              <Scene play={cardInView} reduced={reduced} />
            </m.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function MobileSteps() {
  return (
    <ol className="mt-10 flex flex-col gap-6 lg:hidden">
      {STEPS.map((step, i) => (
        <MobileStep key={step.title} index={i} />
      ))}
    </ol>
  );
}

function MobileStep({ index }: { index: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const reduced = useReducedMotion() ?? false;
  const step = STEPS[index];
  const Scene = SCENES[index];
  return (
    <li ref={ref} className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-start gap-4">
        <StepNumber n={index + 1} />
        <div>
          <h3 className="text-lg leading-snug font-bold tracking-[-0.01em] text-ink">{step.title}</h3>
          <p className="mt-1 text-base font-medium text-muted">{step.body}</p>
        </div>
      </div>
      <div aria-hidden className="mt-5">
        <Scene play={inView} reduced={reduced} />
      </div>
    </li>
  );
}
