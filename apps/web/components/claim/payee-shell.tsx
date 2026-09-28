import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/** Payee pages: mobile-first single column, max 440px, 20px side padding, top bar with theme toggle. */
export function PayeeShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground [--petal-cut:var(--bg)]">
      <header className="mx-auto flex h-16 w-full max-w-[440px] items-center justify-between px-5">
        <Link
          href="/"
          className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Logo className="h-6 w-auto" width={117} height={24} />
        </Link>
        <ThemeToggle className="text-foreground" />
      </header>
      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col">{children}</main>
    </div>
  );
}
