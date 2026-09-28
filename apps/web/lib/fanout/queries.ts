"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/provider";
import { useFanoutClient } from "./use-fanout-client";

/** Query keys, scoped by address so switching accounts never shows stale data. */
export const fanoutKeys = {
  treasury: (platform?: string) => ["fanout", "treasury", platform?.toLowerCase()] as const,
  batches: (platform?: string) => ["fanout", "batches", platform?.toLowerCase()] as const,
  batch: (id: string) => ["fanout", "batch", id] as const,
};

export function useTreasuryBalance() {
  const client = useFanoutClient();
  const address = useAuth().user?.address;
  return useQuery({
    queryKey: fanoutKeys.treasury(address),
    queryFn: () => client.getTreasuryBalance(address!),
    enabled: !!address,
  });
}

export function useBatches() {
  const client = useFanoutClient();
  const address = useAuth().user?.address;
  return useQuery({
    queryKey: fanoutKeys.batches(address),
    queryFn: () => client.listBatches(address!),
    enabled: !!address,
  });
}

export function useDeposit() {
  const client = useFanoutClient();
  const address = useAuth().user?.address;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (amount: bigint) => client.deposit(amount),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fanoutKeys.treasury(address) }),
  });
}
