"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/provider";
import { hashEmail } from "@/lib/email-hash";
import { generateClaimKey } from "./claim-keys";
import { saveClaims } from "./claim-link-store";
import { NotFoundError } from "./types";
import { erc20Abi } from "./abis";
import { mockRefundUnclaimed } from "./mock-client";
import { reader } from "./onchain-client";
import { useFanoutClient } from "./use-fanout-client";
import { config } from "@/lib/config";

/** Query keys, scoped by address so switching accounts never shows stale data. */
export const fanoutKeys = {
  treasury: (platform?: string) => ["fanout", "treasury", platform?.toLowerCase()] as const,
  batches: (platform?: string) => ["fanout", "batches", platform?.toLowerCase()] as const,
  batch: (id: string) => ["fanout", "batch", id] as const,
  payeeBalance: (address?: string) => ["fanout", "payee-balance", address?.toLowerCase()] as const,
  payeeHistory: (address?: string) => ["fanout", "payee-history", address?.toLowerCase()] as const,
  accountFunds: (address?: string) => ["fanout", "account-funds", address?.toLowerCase()] as const,
};

/** What the signed-in account holds itself (not the payout balance): AUSD to deposit, MON for fees. */
export function useAccountFunds() {
  const address = useAuth().user?.address;
  return useQuery({
    queryKey: fanoutKeys.accountFunds(address),
    queryFn: async () => {
      const [ausd, mon] = await Promise.all([
        reader().readContract({ address: config.stablecoin.address, abi: erc20Abi, functionName: "balanceOf", args: [address!] }),
        reader().getBalance({ address: address! }),
      ]);
      return { ausd, mon };
    },
    enabled: !!address,
    refetchInterval: 15_000,
  });
}

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.treasury(address) });
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.accountFunds(address) });
    },
  });
}

export type NewPayoutRow = { email: string; amount: bigint; note: string };

/**
 * Creates a batch: one fresh claim key per row (only the address goes onchain),
 * email hash as metadata. Keys are saved in this browser BEFORE submitting; if that
 * fails, nothing is sent (demo storage, see claim-link-store).
 */
export function useCreatePayout() {
  const client = useFanoutClient();
  const address = useAuth().user?.address;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: NewPayoutRow[]) => {
      const keyed = rows.map((row) => ({ row, key: generateClaimKey() }));
      const saved = saveClaims(
        keyed.map(({ row, key }) => ({ claimSigner: key.claimSigner, privateKey: key.privateKey, email: row.email, note: row.note })),
      );
      if (!saved) {
        throw new Error("Couldn't save the claim links in this browser, so nothing was sent. Allow site storage and try again.");
      }
      return client.createBatchPayout(
        keyed.map(({ row, key }) => ({ claimSigner: key.claimSigner, amount: row.amount, emailHash: hashEmail(row.email) })),
      );
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

/** Demo only (mock mode): simulates claim expiry so unclaimed rows return to the balance. */
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

export function usePayeeBalance() {
  const client = useFanoutClient();
  const address = useAuth().user?.address;
  return useQuery({
    queryKey: fanoutKeys.payeeBalance(address),
    queryFn: () => client.getPayeeBalance(address!),
    enabled: !!address,
  });
}

export function usePayeeHistory() {
  const client = useFanoutClient();
  const address = useAuth().user?.address;
  return useQuery({
    queryKey: fanoutKeys.payeeHistory(address),
    queryFn: () => client.getPayeeHistory(address!),
    enabled: !!address,
  });
}

export function useSend() {
  const client = useFanoutClient();
  const address = useAuth().user?.address;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ to, amount }: { to: `0x${string}`; amount: bigint }) => client.send(to, amount),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.payeeBalance(address) });
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.payeeHistory(address) });
    },
  });
}
