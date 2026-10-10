"use client";

import { useState, type FormEvent } from "react";
import { Spinner } from "@/components/tx-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { activeChain } from "@/lib/chains";
import { MAX_ROWS } from "@/lib/csv";
import { randomNonce } from "@/lib/fanout/erc3009";
import { parseUsd } from "@/lib/money";
import { toAmountString } from "@/lib/agents/rows";
import { normalizeAllowlistEntry, parsePolicy, PolicyInvalid, policyToJson, signAgentPolicy, type AgentPolicyJson } from "@/lib/agents/policy";
import type { Address, LocalAccount, WalletClient } from "viem";
import { config } from "@/lib/config";

const DURATIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
] as const;

const decimals = config.stablecoin.decimals;

/**
 * The agent's limits. Submitting signs them with the platform's account (one signature, no fee),
 * and hands { policy, signature } to `onSigned`. Editing bumps the version, so the server can tell
 * the new signed policy replaces the old one.
 */
export function PolicyForm({
  platform,
  signer,
  existing,
  submitLabel,
  onSigned,
}: {
  platform: Address;
  signer: LocalAccount | WalletClient | null;
  existing?: AgentPolicyJson;
  submitLabel: string;
  onSigned: (body: { policy: AgentPolicyJson; signature: `0x${string}` }) => Promise<void>;
}) {
  const [label, setLabel] = useState(existing?.label ?? "");
  const [perPayout, setPerPayout] = useState(existing ? toAmountString(BigInt(existing.perPayoutCap), decimals) : "100.00");
  const [daily, setDaily] = useState(existing ? toAmountString(BigInt(existing.dailyCap), decimals) : "500.00");
  const [maxPeople, setMaxPeople] = useState(String(existing?.maxPeople ?? 25));
  const [allowlist, setAllowlist] = useState(existing?.allowlist.join("\n") ?? "");
  const [days, setDays] = useState<number>(30);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const perPayoutCap = parseUsd(perPayout, decimals);
    const dailyCap = parseUsd(daily, decimals);
    if (perPayoutCap === null) return setError("Enter the most per payout in dollars, like 100.00.");
    if (dailyCap === null) return setError("Enter the most per day in dollars, like 500.00.");
    const entries = allowlist.split(/[\s,;]+/).filter(Boolean);
    const normalized: string[] = [];
    for (const entry of entries) {
      const n = normalizeAllowlistEntry(entry);
      if (!n) return setError(`"${entry}" isn't an email or a domain like @example.com.`);
      if (!normalized.includes(n)) normalized.push(n);
    }
    const now = BigInt(Math.floor(Date.now() / 1000));
    const json: AgentPolicyJson = {
      platform,
      keyId: existing?.keyId ?? randomNonce(),
      label: label.trim(),
      perPayoutCap: perPayoutCap.toString(),
      dailyCap: dailyCap.toString(),
      maxPeople: Number(maxPeople),
      allowlist: normalized,
      expiresAt: (now + BigInt(days) * 86_400n).toString(),
      version: (existing?.version ?? 0) + 1,
    };
    let policy;
    try {
      policy = parsePolicy(json, now);
    } catch (err) {
      return setError(err instanceof PolicyInvalid ? err.message : "Check the limits and try again.");
    }
    if (!signer) return setError("Your account isn't ready yet. Wait a moment and try again.");
    setBusy(true);
    try {
      const signature = await signAgentPolicy(signer, activeChain.id, policy);
      await onSigned({ policy: policyToJson(policy), signature });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(/reject|denied|cancel/i.test(message) ? "You cancelled the signature. Nothing was saved." : message || "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-label">Name</Label>
        <Input id="agent-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Support bot" maxLength={60} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-per-payout">Most per payout ($)</Label>
          <Input id="agent-per-payout" inputMode="decimal" value={perPayout} onChange={(e) => setPerPayout(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-daily">Most per day ($)</Label>
          <Input id="agent-daily" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-people">Most people per payout</Label>
          <Input id="agent-people" inputMode="numeric" value={maxPeople} onChange={(e) => setMaxPeople(e.target.value.replace(/\D/g, ""))} />
          <p className="text-xs text-muted">Up to {MAX_ROWS}.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-days">Key works for</Label>
          <select
            id="agent-days"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-11 rounded-sm border border-input bg-surface px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {DURATIONS.map((d) => (
              <option key={d.days} value={d.days}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-allowlist">Only pay these people (optional)</Label>
        <textarea
          id="agent-allowlist"
          value={allowlist}
          onChange={(e) => setAllowlist(e.target.value)}
          rows={3}
          placeholder={"ana@example.com\n@yourcompany.com"}
          className="rounded-sm border border-input bg-surface px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        <p className="text-xs text-muted">Emails or whole domains, one per line. Leave empty to allow anyone.</p>
      </div>
      <p className="text-sm text-muted">
        Within these limits, a payout the agent asks for is a one-tap approval. Over them, you&apos;ll see why and review it in full.
        Either way, nothing is paid until you approve.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="self-start">
        {busy && <Spinner />}
        {submitLabel}
      </Button>
    </form>
  );
}
