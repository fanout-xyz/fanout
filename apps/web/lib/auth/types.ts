import type { Address } from "viem";

/**
 * Auth boundary. Pages only use this, never Privy directly, so the provider
 * can be swapped (e.g. for Dynamic) without touching the UI.
 */
export type AuthUser = {
  email?: string;
  /** The user's embedded wallet address. Never shown in payee UI. */
  address?: Address;
};

export type AuthContextValue = {
  provider: "privy" | "mock";
  /** False until the provider has restored any existing session. */
  ready: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  /** Opens the sign-in flow. */
  login: () => void;
  logout: () => Promise<void>;
};
