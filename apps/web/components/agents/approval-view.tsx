"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { getAddress } from "viem";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { agentKeys, useAgentsFetch, useInvalidateAgents, usePlatformSigner, type ApprovalDetails, type PreparedApproval } from "@/lib/agents/client";
import { useAuth } from "@/lib/auth/provider";
import { hashEmail } from "@/lib/email-hash";
import { signCreateBatch } from "@/lib/fanout/batch-authorization";
import { claimSignerFromKey } from "@/lib/fanout/claim-keys";
import { markEmailed, saveClaims } from "@/lib/fanout/claim-link-store";
import { formatUsd } from "@/lib/money";
import { useQueryClient } from "@tanstack/react-query";

const usd = (base: string) => formatUsd(BigInt(base));

const STATUS_TEXT: Record<string, string> = {
  sent: "Approved and sent.",
  declined: "You declined this payout. Nothing was sent.",
  expired: "Nobody approved this in time. Nothing was sent.",
  cancelled: "The agent key was paused or revoked, so this was cancelled. Nothing was sent.",
};

/**
 * Reviewing an agent's payout. Approving fetches the CreateBatch, checks every field against the
 * rows shown here (amounts, email hashes, claim signers, this account), keeps the claim links in
 * this browser like any payout, then signs it. Fanout's relayer submits it; it can't change a row.
 */
export function ApprovalView({ id }: { id: string }) {
  const { user } = useAuth();
  const api = useAgentsFetch();
  const signer = usePlatformSigner();
  const invalidate = useInvalidateAgents();
  const qc = useQueryClient();
  const details = useQuery({
    queryKey: agentKeys.request(id),
    queryFn: () => api<ApprovalDetails>(`/api/agents/requests/${id}`),
    enabled: !!user?.address,
  });
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [done, setDone] = useState<{ batchId: string; emailed: { sent: number; configured: boolean } } | null>(null);

  if (details.isPending) return <Skeleton className="h-64 w-full" />;
  if (details.isError) return <p role="alert" className="text-danger">{details.error.message}</p>;
  const d = details.data;
  const total = BigInt(d.total);
  const short = BigInt(d.balance) < total;
  const pending = d.status === "pending_approval";

  async function approve() {
    setError(null);
    if (!signer || !user?.address) return setError("Your account isn't ready yet. Wait a moment and try again.");
    setBusy("approve");
    try {
      const a = await api<PreparedApproval>(`/api/agents/requests/${id}/authorize`, { method: "POST" });
      // Sign only what's on this page.
      const ok =
        getAddress(a.platform) === getAddress(user.address) &&
        a.amounts.length === d.rows.length &&
        d.rows.every((row, i) => a.amounts[i] === row.amount && a.emailHashes[i] === hashEmail(row.email)) &&
        a.claims.every((c, i) => claimSignerFromKey(c.privateKey) === getAddress(a.claimSigners[i])) &&
        a.claimWindow === String(d.claimWindowSeconds);
      if (!ok) throw new Error("The payout to sign doesn't match what's shown. Nothing was sent. Reload and try again.");
      if (!saveClaims(a.claims.map((c) => ({ claimSigner: c.claimSigner, privateKey: c.privateKey, email: c.email, note: c.note })))) {
        throw new Error("This browser couldn't save the claim links. Nothing was sent.");
      }
      const signature = await signCreateBatch(signer, a.batchPayout, a.chainId, {
        platform: a.platform,
        claimSigners: a.claimSigners,
        amounts: a.amounts.map(BigInt),
        emailHashes: a.emailHashes,
        claimWindow: BigInt(a.claimWindow),
        nonce: a.nonce,
        deadline: BigInt(a.deadline),
      });
      const r = await api<{ batchId: string; emailed: { sent: number; failed: number; configured: boolean } }>(`/api/agents/requests/${id}/approve`, {
        method: "POST",
        body: { signature },
      });
      if (r.emailed.sent > 0) markEmailed(a.claimSigners);
      setDone(r);
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ["fanout"] })]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(/reject|denied|cancel/i.test(message) ? "You cancelled the signature. Nothing was sent." : message || "Couldn't send. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    setError(null);
    setBusy("decline");
    try {
      await api(`/api/agents/requests/${id}/decline`, { method: "POST" });
      await Promise.all([invalidate(), details.refetch()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't decline. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/agents" className="text-sm font-semibold text-primary hover:underline">
        ← Agents
      </Link>
      <div>
        <h1 className="font-display text-[32px] leading-tight tracking-[-0.02em]">
          {d.agentLabel} wants to pay {usd(d.total)}
        </h1>
        <p className="mt-1 text-muted">
          {d.people} {d.people === 1 ? "person" : "people"} · claim links work for {Math.round(d.claimWindowSeconds / 86_400)} days
        </p>
      </div>

      {d.memo && (
        <blockquote className="rounded-lg border border-line bg-surface p-4">
          <p className="text-xs font-semibold text-muted">The agent says</p>
          <p className="mt-1 whitespace-pre-wrap">{d.memo}</p>
        </blockquote>
      )}

      {pending &&
        (d.withinPolicy ? (
          <p className="rounded-lg bg-mint-surface p-4 text-on-mint">Within {d.agentLabel}&apos;s limits.</p>
        ) : (
          <div role="alert" className="rounded-lg border border-tangerine/40 bg-tangerine/10 p-4">
            <p className="font-semibold">Over {d.agentLabel}&apos;s limits. Review every row before approving.</p>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {d.breaches.map((b) => (
                <li key={b.code}>
                  {b.message}
                  {b.emails?.length ? ` (${b.emails.slice(0, 5).join(", ")}${b.emails.length > 5 ? "…" : ""})` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr>
              <th className="px-4 py-2 font-semibold">#</th>
              <th className="px-4 py-2 font-semibold">Email</th>
              <th className="px-4 py-2 text-right font-semibold">Amount</th>
              <th className="px-4 py-2 font-semibold">Note</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((row, i) => (
              <tr key={row.email} className="border-b border-line last:border-0">
                <td className="px-4 py-2 text-muted tabular-nums">{i + 1}</td>
                <td className="px-4 py-2 break-all">{row.email}</td>
                <td className="px-4 py-2 text-right tabular-nums">{usd(row.amount)}</td>
                <td className="px-4 py-2 text-muted">{row.note}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="px-4 py-2 font-semibold">
                Total
              </td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">{usd(d.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {done ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <p className="font-semibold">
            Sent. {done.emailed.sent > 0 ? `${done.emailed.sent} ${done.emailed.sent === 1 ? "person was" : "people were"} emailed their claim link.` : "Copy the claim links from the payout page."}
          </p>
          <Button asChild className="self-start">
            <Link href={`/dashboard/payouts/${done.batchId}`}>Open payout #{done.batchId}</Link>
          </Button>
        </div>
      ) : pending ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Paid from your payout balance ({usd(d.balance)}). You sign once; Fanout pays the network fee.
          </p>
          {short && <p className="text-sm text-danger">Your payout balance is short. Add money on the Overview page first.</p>}
          {!d.withinPolicy && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              I checked every row.
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void approve()} disabled={!!busy || short || (!d.withinPolicy && !reviewed)}>
              {busy === "approve" && <Spinner />}
              Approve and send {usd(d.total)}
            </Button>
            <Button variant="secondary" onClick={() => void decline()} disabled={!!busy}>
              {busy === "decline" && <Spinner />}
              Decline
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p>{STATUS_TEXT[d.status] ?? d.status}</p>
          {d.batchId && (
            <Button asChild variant="secondary" className="self-start">
              <Link href={`/dashboard/payouts/${d.batchId}`}>Open payout #{d.batchId}</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
