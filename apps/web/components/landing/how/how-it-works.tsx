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
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-18 bg-background py-20 lg:py-28">
      <div className="mx-auto w-full max-w-[1280px] px-6">
        <h2
          id="how-title"
          className="max-w-[18ch] font-display text-[clamp(36px,5vw,56px)] leading-[1.08] tracking-[-0.03em] text-balance text-foreground"
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

function StepNumber({ n, active = true }: { n: number; active?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-cobalt text-sm font-bold transition-colors duration-200",
        active ? "bg-cobalt text-cream" : "bg-transparent text-primary",
      )}
    >
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
    <div className="mt-6 hidden grid-cols-[minmax(0,1fr)_minmax(560px,1.1fr)] items-stretch gap-16 lg:grid">
      <ol>
        {STEPS.map((step, i) => (
          <li key={step.title} ref={(el) => void (stepRefs.current[i] = el)} data-step={i} className="flex min-h-[50vh] items-center">
            <button
              type="button"
              onClick={() => setActive(i)}
              aria-current={active === i ? "step" : undefined}
              className={cn(
                "-m-4 flex w-full items-start gap-5 rounded-lg p-4 text-left outline-none transition-opacity duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active === i ? "opacity-100" : "opacity-40 hover:opacity-75 dark:opacity-45",
              )}
            >
              <StepNumber n={i + 1} active={active === i} />
              <span>
                <span className="block font-display text-2xl tracking-[-0.015em] text-foreground">{step.title}</span>
                <span className="mt-2 block max-w-[40ch] text-base font-medium text-muted">{step.body}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="relative">
        {/* Sticky at the viewport's vertical centre, where the active step sits. */}
        <div
          ref={cardRef}
          aria-hidden
          className="sticky top-[calc(50vh-220px)] h-[440px] w-full min-w-[560px] overflow-hidden rounded-lg border border-line bg-surface"
        >
          {/* Crossfade: the outgoing scene fades out on top while the new one fades in. */}
          <AnimatePresence initial={false}>
            <m.div
              key={active}
              className="absolute inset-7"
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: EASE_OUT }}
            >
              <Scene play={cardInView} reduced={reduced} large />
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
          <h3 className="text-lg leading-snug font-bold tracking-[-0.01em] text-foreground">{step.title}</h3>
          <p className="mt-1 text-base font-medium text-muted">{step.body}</p>
        </div>
      </div>
      <div aria-hidden className="mt-5">
        <Scene play={inView} reduced={reduced} />
      </div>
    </li>
  );
}
