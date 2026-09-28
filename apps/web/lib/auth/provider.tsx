"use client";

import type { ReactNode } from "react";
import { config } from "@/lib/config";
import { MockAuthProvider } from "./mock";
import { PrivyAuthProvider } from "./privy";

/** Picks Privy when an app ID is configured, otherwise the local mock sign-in. */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (config.privyAppId) {
    return <PrivyAuthProvider appId={config.privyAppId}>{children}</PrivyAuthProvider>;
  }
  if (!config.useMock) {
    throw new Error("NEXT_PUBLIC_USE_MOCK=false needs NEXT_PUBLIC_PRIVY_APP_ID for a real wallet.");
  }
  return <MockAuthProvider>{children}</MockAuthProvider>;
}

export { useAuth } from "./context";
export type { AuthContextValue, AuthUser } from "./types";
