"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Address, Hex, LocalAccount, WalletClient } from "viem";
import { useWalletClient } from "wagmi";
import { mockAccountForEmail } from "@/lib/auth/mock-account";
import { useAuth } from "@/lib/auth/provider";
import { config } from "@/lib/config";
import type { AgentPolicyJson, PolicyBreach } from "./policy";
import type { AgentActivity, RequestStatus } from "./store";

/** The dashboard's side of /api/agents (app/api/agents). */

export type AgentKeySummary = {
  keyId: Hex;
  label: string;
  tokenHint: string;
  status: "active" | "paused" | "expired" | "revoked";
  createdAt: number;
  lastUsedAt?: number;
  policy: AgentPolicyJson;
};

export type AgentRequestSummary = {
  id: string;
  keyId: Hex;
  agentLabel: string;
  status: RequestStatus;
  withinPolicy: boolean;
  total: string;
  people: number;
  createdAt: number;
  approveBy: number;
  batchId?: string;
};

export type AgentsOverview = {
  available: boolean;
  reason?: string;
  keys: AgentKeySummary[];
  requests: AgentRequestSummary[];
  activity: AgentActivity[];
};

export type ApprovalDetails = AgentRequestSummary & {
  breaches: PolicyBreach[];
  memo: string;
  claimWindowSeconds: number;
  rows: { email: string; amount: string; note: string }[];
  balance: string;
  keyStatus: AgentKeySummary["status"];
  txHash?: Hex;
};

export type PreparedApproval = {
  chainId: number;
  batchPayout: Address;
  platform: Address;
  claimSigners: Address[];
  amounts: string[];
  emailHashes: Hex[];
  claimWindow: string;
  nonce: Hex;
  deadline: string;
  claims: { claimSigner: Address; privateKey: Hex; email: string; note: string }[];
};

/** fetch for the agent routes, carrying the signed-in account (and, onchain, the session token). */
export function useAgentsFetch() {
  const { user, getAccessToken } = useAuth();
  const address = user?.address;
  const email = user?.email;
  return useCallback(
    async <T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (address) headers["x-fanout-account"] = address;
      if (config.useMock && email) headers["x-fanout-email"] = email;
      const token = await getAccessToken?.();
      if (token) headers.authorization = `Bearer ${token}`;
      let res: Response;
      try {
        res = await fetch(path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
      } catch {
        throw new Error("Can't reach the server. Check your connection and try again.");
      }
      const body = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Something went wrong. Try again.");
      return body;
    },
    [address, email, getAccessToken],
  );
}

export const agentKeys = { overview: (a?: string) => ["agents", a] as const, request: (id: string) => ["agents", "request", id] as const };

export function useAgentsOverview() {
  const { user } = useAuth();
  const api = useAgentsFetch();
  return useQuery({
    queryKey: agentKeys.overview(user?.address),
    queryFn: () => api<AgentsOverview>("/api/agents"),
    enabled: !!user?.address,
    refetchInterval: 15_000,
  });
}

export function useInvalidateAgents() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ["agents"] }), [qc]);
}

/**
 * What signs agent policies and payout approvals: the sign-in wallet onchain, the demo account in
 * the mock (lib/auth/mock-account.ts). Null until it's ready.
 */
export function usePlatformSigner(): LocalAccount | WalletClient | null {
  const { user } = useAuth();
  const { data: walletClient } = useWalletClient();
  if (config.useMock) return user?.email ? mockAccountForEmail(user.email) : null;
  return walletClient ?? null;
}
