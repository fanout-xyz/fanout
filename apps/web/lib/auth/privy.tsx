"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { useMemo, type ReactNode } from "react";
import { getAddress } from "viem";
import { http } from "wagmi";
import { activeChain } from "@/lib/chains";
import { AuthContext } from "./context";
import type { AuthContextValue } from "./types";

const wagmiConfig = createConfig({
  chains: [activeChain],
  transports: { [activeChain.id]: http() },
  ssr: true,
});

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();

  const value = useMemo<AuthContextValue>(
    () => ({
      provider: "privy",
      ready,
      authenticated,
      user: user
        ? {
            email: user.email?.address,
            address: user.wallet?.address ? getAddress(user.wallet.address) : undefined,
          }
        : null,
      login: () => login(),
      logout,
    }),
    [ready, authenticated, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Must sit inside QueryClientProvider. */
export function PrivyAuthProvider({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "passkey"],
        defaultChain: activeChain,
        supportedChains: [activeChain],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          // Keep Privy's wallet/transaction modals out of the payee experience.
          showWalletUIs: false,
        },
        appearance: { walletChainType: "ethereum-only", landingHeader: "Sign in to Fanout" },
      }}
    >
      <WagmiProvider config={wagmiConfig}>
        <PrivyBridge>{children}</PrivyBridge>
      </WagmiProvider>
    </PrivyProvider>
  );
}
