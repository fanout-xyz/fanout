"use client";

import { useMemo } from "react";
import { useWalletClient } from "wagmi";
import { useAuth } from "@/lib/auth/provider";
import { createFanoutClient, type FanoutClient } from "./client";

/** FanoutClient bound to the signed-in user. */
export function useFanoutClient(): FanoutClient {
  const { user, getAccessToken } = useAuth();
  const { data: walletClient } = useWalletClient();
  const account = user?.address;
  return useMemo(() => createFanoutClient({ account, walletClient, getAccessToken }), [account, walletClient, getAccessToken]);
}
