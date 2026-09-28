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
      <div
        data-theme="dark"
        className="relative isolate mx-auto flex max-w-[1280px] flex-col items-center overflow-hidden rounded-xl bg-cobalt px-6 py-20 text-center lg:py-28"
      >
        <m.div
          aria-hidden
          // 20% smaller than before (480px), offset right so it doesn't sit behind the headline.
          // Opacity comes from a token: 6% light, 5% dark.
          className="pointer-events-none absolute top-1/2 -right-40 -z-10 w-[480px] max-w-none -translate-y-1/2 opacity-(--cta-petals-opacity) md:right-[-4%]"
          style={reduced ? undefined : { rotate }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative brand SVG */}
          <img src="/brand/svg/mark/fanout-mark-cream.svg" alt="" width={480} height={379} className="w-full" />
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
          className="mt-10 bg-cream text-ink hover:bg-cream/90 focus-visible:ring-cream focus-visible:ring-offset-cobalt"
        >
          <Link href="/dashboard">Try the demo</Link>
        </Button>
      </div>
    </section>
  );
}
