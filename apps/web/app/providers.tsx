"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, type ReactNode } from "react";
import { ThemeColorSync } from "@/components/theme-color-sync";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth/provider";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } }),
  );

  return (
    // next-themes injects a blocking script that sets data-theme before first paint (no flash).
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
      <ThemeColorSync />
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <AuthProvider>{children}</AuthProvider>
        </TooltipProvider>
        <Toaster richColors position="top-center" />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
