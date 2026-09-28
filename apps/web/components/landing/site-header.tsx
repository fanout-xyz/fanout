"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Logo } from "@/components/brand/logo";
import { SignInCta } from "@/components/sign-in-cta";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { useHeaderSurface } from "./use-header-surface";

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function SiteHeader() {
  const surface = useHeaderSurface();
  const { resolvedTheme } = useTheme();
  // Section-based switching only applies in light mode; dark mode always uses the dark header.
  const onDarkBand = surface === "dark" && resolvedTheme !== "dark";

  const navLink = cn(
    "hidden rounded-sm px-2 py-1 text-[15px] font-semibold transition-colors duration-150 sm:inline-block",
    focusRing,
    onDarkBand ? "text-cream hover:text-cream/75" : "text-foreground hover:text-primary",
  );

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-[background-color,border-color] duration-200",
        // Dark mode: always the translucent dark bar.
        "dark:border-line dark:bg-background/85 dark:backdrop-blur-md",
        surface === "top" && "border-transparent bg-transparent",
        surface === "light" && "border-line bg-background/85 backdrop-blur-md",
        surface === "dark" && "border-cream/8 bg-ink/85 backdrop-blur-md",
      )}
    >
      <div className="mx-auto flex h-18 w-full max-w-[1280px] items-center justify-between px-6">
        <Link href="/" className={cn("rounded-sm", focusRing)}>
          <Logo onDark={onDarkBand} />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2 sm:gap-3">
          <a href="#how-it-works" className={navLink}>
            How it works
          </a>
          <Link href="/dashboard" className={navLink}>
            Demo
          </Link>
          <ThemeToggle className={onDarkBand ? "border-cream/20 text-cream hover:bg-cream/10" : "text-foreground"} />
          <SignInCta variant="secondary" size="sm" />
        </nav>
      </div>
    </header>
  );
}
