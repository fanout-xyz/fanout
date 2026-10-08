"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAuth } from "@/lib/auth/provider";
import type { AiMode } from "./provider";

/** Whether AI features are on: "live" (a provider key is set), "demo" (mock mode stand-in) or "off". */
export function useAiStatus(): { mode: AiMode; on: boolean; demo: boolean } {
  const status = useQuery({
    queryKey: ["ai", "status"],
    queryFn: async (): Promise<AiMode> => {
      const res = await fetch("/api/ai/status");
      const body = (await res.json().catch(() => ({}))) as { mode?: AiMode };
      return res.ok && body.mode ? body.mode : "off";
    },
    staleTime: Infinity,
    retry: 1,
  });
  const mode = status.data ?? "off";
  return { mode, on: mode !== "off", demo: mode === "demo" };
}

/** POSTs to an /api/ai route as the signed-in user. Throws an Error with a message safe to show. */
export function useAiPost() {
  const { getAccessToken, user } = useAuth();
  const account = user?.address;
  return useCallback(
    async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
      const token = (await getAccessToken?.()) ?? null;
      let res: Response;
      try {
        res = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ ...body, account }),
        });
      } catch {
        throw new Error("Couldn't reach the server. Check your connection and try again.");
      }
      const json = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Our assistant couldn't help with that. Try again.");
      return json;
    },
    [getAccessToken, account],
  );
}
