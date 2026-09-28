"use client";

import { useMotionValueEvent, useScroll } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { SignInCta } from "@/components/sign-in-cta";
import { cn } from "@/lib/utils";

const navLink =
  "hidden rounded-sm px-2 py-1 text-[15px] font-semibold text-ink outline-none transition-colors duration-150 hover:text-cobalt focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2 focus-visible:ring-offset-cream sm:inline-block";

export function SiteHeader() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-[background-color,border-color] duration-200",
        scrolled ? "border-line bg-cream/80 backdrop-blur-md" : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-18 w-full max-w-[1280px] items-center justify-between px-6">
        <Link
          href="/"
          className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- logo SVG from the brand kit */}
          <img src="/brand/svg/lockup/fanout-lockup-primary.svg" alt="Fanout" width={136} height={28} className="h-7 w-auto" />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2 sm:gap-4">
          <a href="#how-it-works" className={navLink}>
            How it works
          </a>
          <Link href="/dashboard" className={navLink}>
            Demo
          </Link>
          <SignInCta variant="secondary" size="sm" />
        </nav>
      </div>
    </header>
  );
}
