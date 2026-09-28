"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/provider";
import { hashEmail } from "@/lib/email-hash";
import { generateClaimKey } from "./claim-keys";
import { saveClaims } from "./claim-link-store";
import { mockRefundUnclaimed } from "./mock-client";
import { NotFoundError } from "./types";
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

export type NewPayoutRow = { email: string; amount: bigint; note: string };

/**
 * Creates a batch: one fresh claim key per row (only the address goes onchain),
 * email hash as metadata. Keys are saved locally for the batch page (demo only).
 */
export function useCreatePayout() {
  const client = useFanoutClient();
  const address = useAuth().user?.address;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: NewPayoutRow[]) => {
      const keyed = rows.map((row) => ({ row, key: generateClaimKey() }));
      const { batchId, txHash } = await client.createBatchPayout(
        keyed.map(({ row, key }) => ({ claimSigner: key.claimSigner, amount: row.amount, emailHash: hashEmail(row.email) })),
      );
      const saved = saveClaims(
        batchId,
        keyed.map(({ row, key }) => ({ claimSigner: key.claimSigner, privateKey: key.privateKey, email: row.email, note: row.note })),
      );
      return { batchId, txHash, linksSaved: saved };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.treasury(address) });
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.batches(address) });
    },
  });
}

/** One batch. Polls so claims made on a phone show up without a reload. */
export function useBatch(batchId: string) {
  const client = useFanoutClient();
  return useQuery({
    queryKey: fanoutKeys.batch(batchId),
    queryFn: () => client.getBatch(batchId),
    retry: (count, error) => !(error instanceof NotFoundError) && count < 1,
    // Poll for claims, but stop once we know the payout doesn't exist.
    refetchInterval: (query) => (query.state.error instanceof NotFoundError ? false : 5_000),
  });
}

/** Demo only: simulates claim expiry so unclaimed rows return to the balance. */
export function useMockExpireUnclaimed(batchId: string) {
  const address = useAuth().user?.address;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => mockRefundUnclaimed(address, batchId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.batch(batchId) });
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.treasury(address) });
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.batches(address) });
    },
  });
}
