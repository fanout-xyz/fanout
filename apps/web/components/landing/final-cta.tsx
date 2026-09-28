"use client";

import { m, useReducedMotion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { Button } from "@/components/ui/button";

export function FinalCta() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const rotate = useTransform(scrollYProgress, [0, 1], [-4, 4]); // 8° of travel across the band

  return (
    <section ref={ref} aria-labelledby="cta-title" className="px-6 py-6">
      <div className="relative isolate mx-auto flex max-w-[1280px] flex-col items-center overflow-hidden rounded-xl bg-cobalt px-6 py-24 text-center lg:py-36">
        <m.div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 -z-10 w-[600px] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[0.08]"
          style={reduced ? undefined : { rotate }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative brand SVG */}
          <img src="/brand/svg/mark/fanout-mark-cream.svg" alt="" width={600} height={474} className="w-full" />
        </m.div>
        <h2
          id="cta-title"
          className="max-w-[14ch] font-display text-[clamp(44px,7vw,80px)] leading-[1.02] tracking-[-0.03em] text-balance text-cream"
        >
          One deposit. Everyone paid.
        </h2>
        <Button
          asChild
          size="lg"
          className="mt-10 bg-cream text-ink hover:bg-surface active:bg-surface focus-visible:ring-cream focus-visible:ring-offset-cobalt"
        >
          <Link href="/dashboard">Try the demo</Link>
        </Button>
      </div>
    </section>
  );
}
