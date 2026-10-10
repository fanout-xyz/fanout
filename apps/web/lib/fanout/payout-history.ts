"use client";

import { useQueries } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { payeeTypicals, type PastPayout } from "@/lib/payout-risk";
import { loadAllClaims, subscribeClaims } from "./claim-link-store";
import { fanoutKeys, useBatches } from "./queries";
import { useFanoutClient } from "./use-fanout-client";

/** How many recent payouts the unusual-payout checks look at. */
const RECENT = 10;

/**
 * This platform's recent payouts (from the indexer or the mock) and who it paid in them (joined with
 * the claim links this browser saved), for the unusual-payout checks. ready is false until loaded.
 */
export function usePayoutHistory(): { ready: boolean; history: PastPayout[] | null; payees: Map<string, bigint> } {
  const client = useFanoutClient();
  const batches = useBatches();
  const recent = useMemo(
    () => [...(batches.data ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, RECENT),
    [batches.data],
  );
  const details = useQueries({
    queries: recent.map((b) => ({ queryKey: fanoutKeys.batch(b.id), queryFn: () => client.getBatch(b.id), staleTime: 60_000 })),
  });
  const claims = useSyncExternalStore(subscribeClaims, loadAllClaims, () => null);

  const loaded = details.filter((d) => d.data).map((d) => d.data!);
  const loadedKey = loaded.map((b) => b.id).join(",");
  const payees = useMemo(
    () => payeeTypicals(loaded, (signer) => claims?.[signer]?.email),
    // loaded is rebuilt every render; its ids say when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadedKey, claims],
  );
  const history = useMemo(() => recent.map((b) => ({ total: b.total, rowCount: b.rowCount, createdAt: b.createdAt })), [recent]);
  // If past payouts can't be loaded, history is null (unknown): the checks that need it are skipped, never blocking.
  return { ready: !batches.isPending && details.every((d) => !d.isPending), history: batches.isError ? null : history, payees };
}
