"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/provider";
import { config } from "@/lib/config";
import { cn } from "@/lib/utils";
import { RequireAuth } from "./require-auth";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/payouts/new", label: "New payout" },
] as const;

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { authenticated, user, logout } = useAuth();

  const navLinks = NAV.map((item) => {
    const active = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "rounded-sm px-3 py-2 text-[15px] font-semibold transition-colors duration-150",
          focusRing,
          active ? "bg-primary/10 text-primary" : "text-muted hover:bg-foreground/5 hover:text-foreground",
        )}
      >
        {item.label}
      </Link>
    );
  });

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-line px-4 py-6 lg:flex">
        <Link href="/" className={cn("w-fit rounded-sm px-2", focusRing)}>
          <Logo />
        </Link>
        <nav aria-label="Dashboard" className="mt-10 flex flex-col gap-1">
          {navLinks}
        </nav>
        <div className="mt-auto flex flex-col gap-3 px-2">
          {config.useMock && (
            <p className="text-xs text-muted">Demo mode. Balances and transactions are simulated.</p>
          )}
          {authenticated && (
            <>
              <p className="truncate text-sm font-semibold" title={user?.email}>
                {user?.email ?? "Signed in"}
              </p>
              <Button variant="secondary" size="sm" onClick={() => void logout()} className="w-full">
                Sign out
              </Button>
            </>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-background/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-4 px-6">
            <Link href="/" className={cn("rounded-sm lg:hidden", focusRing)}>
              <Logo className="h-6 w-auto" />
            </Link>
            <nav aria-label="Dashboard" className="hidden gap-1 sm:flex lg:hidden">
              {navLinks}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle className="text-foreground" />
              {authenticated && (
                <Button variant="ghost" size="sm" onClick={() => void logout()} className="lg:hidden">
                  Sign out
                </Button>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-8 lg:py-10">
          <RequireAuth>{children}</RequireAuth>
        </main>
      </div>
    </div>
  );
}
