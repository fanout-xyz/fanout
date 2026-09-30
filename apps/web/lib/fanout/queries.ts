"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createWalletClient, http } from "viem";
import { useAuth } from "@/lib/auth/provider";
import { activeChain } from "@/lib/chains";
import { usePayeeAccount } from "@/lib/payee/payee-account";
import { hashEmail } from "@/lib/email-hash";
import { emailClaimLinks } from "./claim-email-client";
import { generateClaimKey } from "./claim-keys";
import { saveClaims, type StoredClaim } from "./claim-link-store";
import { mockRefundUnclaimed } from "./mock-client";
import { NotFoundError } from "./types";
import { config } from "@/lib/config";
import { erc20Abi } from "./abis";
import { need, reader } from "./onchain-client";
import { createFanoutClient } from "./client";
import { useFanoutClient } from "./use-fanout-client";

/** Query keys, scoped by address so switching accounts never shows stale data. */
export const fanoutKeys = {
  treasury: (platform?: string) => ["fanout", "treasury", platform?.toLowerCase()] as const,
  batches: (platform?: string) => ["fanout", "batches", platform?.toLowerCase()] as const,
  batch: (id: string) => ["fanout", "batch", id] as const,
  payeeBalance: (address?: string) => ["fanout", "payee-balance", address?.toLowerCase()] as const,
  payeeHistory: (address?: string) => ["fanout", "payee-history", address?.toLowerCase()] as const,
  accountFunds: (address?: string) => ["fanout", "account-funds", address?.toLowerCase()] as const,
};

/** Onchain mode: what the signed-in account holds itself (not the payout balance): AUSD to deposit, MON for fees. */
export function useAccountFunds() {
  const address = useAuth().user?.address;
  return useQuery({
    queryKey: fanoutKeys.accountFunds(address),
    queryFn: async () => {
      const [ausd, mon] = await Promise.all([
        reader().readContract({ address: need(config.stablecoin.address, "NEXT_PUBLIC_AUSD_ADDRESS"), abi: erc20Abi, functionName: "balanceOf", args: [address!] }),
        reader().getBalance({ address: address! }),
      ]);
      return { ausd, mon };
    },
    enabled: !!address && !config.useMock,
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
  const auth = useAuth();
  const address = auth.user?.address;
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
      const created = await client.createBatchPayout(
        keyed.map(({ row, key }) => ({ claimSigner: key.claimSigner, amount: row.amount, emailHash: hashEmail(row.email) })),
      );
      // The money is out; emailing is a separate step whose failure the caller reports, not throws.
      const emailed = await emailClaimLinks(
        keyed.map(({ row, key }) => ({ key: key.privateKey, claimSigner: key.claimSigner, email: row.email, note: row.note })),
        { accessToken: (await auth.getAccessToken?.()) ?? null, account: address },
      );
      return { ...created, emailed };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.treasury(address) });
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.batches(address) });
    },
  });
}

/** Emails (or re-emails) claim links. Resolves with what was sent; the caller shows failures. */
export function useEmailClaimLinks() {
  const auth = useAuth();
  return useMutation({
    mutationFn: async ({ claims, reminder }: { claims: StoredClaim[]; reminder?: boolean }) => {
      const result = await emailClaimLinks(
        claims.map((c) => ({ key: c.privateKey, claimSigner: c.claimSigner, email: c.email, note: c.note })),
        { accessToken: (await auth.getAccessToken?.()) ?? null, account: auth.user?.address },
        { reminder },
      );
      if ("error" in result) throw new Error(result.error);
      return result;
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

export function usePayeeBalance() {
  const client = useFanoutClient();
  const address = usePayeeAccount().address;
  return useQuery({
    queryKey: fanoutKeys.payeeBalance(address),
    queryFn: () => client.getPayeeBalance(address!),
    enabled: !!address,
  });
}

export function usePayeeHistory() {
  const client = useFanoutClient();
  const address = usePayeeAccount().address;
  return useQuery({
    queryKey: fanoutKeys.payeeHistory(address),
    queryFn: () => client.getPayeeHistory(address!),
    enabled: !!address,
  });
}

/**
 * Sends from the payee's account. A passkey account is opened for this one send (Face ID / Touch
 * ID) and its key is zeroed right after; the email-account fallback signs with the sign-in wallet.
 */
export function useSend() {
  const signInClient = useFanoutClient();
  const payee = usePayeeAccount();
  const address = payee.address;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ to, amount }: { to: `0x${string}`; amount: bigint }) => {
      if (payee.kind !== "passkey") return signInClient.send(to, amount);
      const unlocked = await payee.unlock();
      try {
        const walletClient = createWalletClient({ account: unlocked.account, chain: activeChain, transport: http() });
        return await createFanoutClient({ account: unlocked.address, walletClient }).send(to, amount);
      } finally {
        unlocked.end();
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.payeeBalance(address) });
      void queryClient.invalidateQueries({ queryKey: fanoutKeys.payeeHistory(address) });
    },
  });
}
