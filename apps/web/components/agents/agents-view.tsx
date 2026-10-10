"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgentsFetch, useAgentsOverview, useInvalidateAgents, usePlatformSigner, type AgentKeySummary, type AgentRequestSummary } from "@/lib/agents/client";
import type { AgentPolicyJson } from "@/lib/agents/policy";
import type { AgentActivity } from "@/lib/agents/store";
import { useAuth } from "@/lib/auth/provider";
import { formatUsd } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ConnectAgent, X402Example } from "./connect-agent";
import { PolicyForm } from "./policy-form";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const usd = (base: string) => formatUsd(BigInt(base));

function Section({ id, title, children, action }: { id: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-line bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const KEY_STATUS: Record<AgentKeySummary["status"], { label: string; className: string }> = {
  active: { label: "Active", className: "bg-mint-surface text-on-mint" },
  paused: { label: "Paused", className: "bg-tangerine/15 text-refunded-fg" },
  expired: { label: "Expired", className: "bg-line text-foreground" },
  revoked: { label: "Revoked", className: "bg-danger/10 text-danger" },
};

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold whitespace-nowrap", className)}>{children}</span>;
}

export function AgentsView() {
  const { user } = useAuth();
  const overview = useAgentsOverview();
  const api = useAgentsFetch();
  const invalidate = useInvalidateAgents();
  const signer = usePlatformSigner();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AgentKeySummary | null>(null);
  const [newToken, setNewToken] = useState<{ token: string; label: string } | null>(null);

  const platform = user?.address;
  const data = overview.data;
  const pending = data?.requests.filter((r) => r.status === "pending_approval") ?? [];
  const liveKeys = data?.keys.filter((k) => k.status !== "revoked") ?? [];

  async function create(body: { policy: AgentPolicyJson; signature: `0x${string}` }) {
    const r = await api<{ token: string; key: AgentKeySummary }>("/api/agents/keys", { method: "POST", body });
    setCreating(false);
    setNewToken({ token: r.token, label: r.key.label });
    await invalidate();
  }

  async function update(key: AgentKeySummary, body: { policy: AgentPolicyJson; signature: `0x${string}` }) {
    await api(`/api/agents/keys/${key.keyId}`, { method: "PATCH", body });
    setEditing(null);
    toast.success("Limits saved.");
    await invalidate();
  }

  async function act(key: AgentKeySummary, action: "pause" | "resume" | "revoke") {
    try {
      if (action === "revoke") {
        if (!window.confirm(`Revoke ${key.label}? Its key stops working at once and can't be turned back on.`)) return;
        await api(`/api/agents/keys/${key.keyId}`, { method: "DELETE" });
      } else {
        await api(`/api/agents/keys/${key.keyId}`, { method: "PATCH", body: { paused: action === "pause" } });
      }
      toast.success(action === "pause" ? `${key.label} is paused.` : action === "resume" ? `${key.label} is back on.` : `${key.label} is revoked.`);
      await invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change the key.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] leading-tight tracking-[-0.02em]">Agents</h1>
          <p className="mt-1 max-w-2xl text-muted">
            Let an AI agent pay people for you. It can ask for payouts within the limits you set; nothing is paid until you approve.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={!data?.available}>
          New agent key
        </Button>
      </div>

      {overview.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : overview.isError ? (
        <div role="alert" className="flex items-center gap-3">
          <p className="text-danger">Couldn&apos;t load your agents.</p>
          <Button variant="secondary" size="sm" onClick={() => void overview.refetch()}>
            Retry
          </Button>
        </div>
      ) : !data?.available ? (
        <p className="rounded-lg border border-line bg-surface p-6 text-muted">Agents aren&apos;t set up on this server yet. {data?.reason}</p>
      ) : (
        <>
          <Section id="pending-title" title={`Waiting for you${pending.length ? ` (${pending.length})` : ""}`}>
            {pending.length === 0 ? (
              <p className="text-muted">Nothing to approve. When an agent asks to pay people, it shows up here.</p>
            ) : (
              <ul className="divide-y divide-line">
                {pending.map((r) => (
                  <PendingRow key={r.id} r={r} />
                ))}
              </ul>
            )}
          </Section>

          <Section id="keys-title" title="Agent keys">
            {liveKeys.length === 0 ? (
              <p className="text-muted">No agent keys yet. Create one, then add it to your agent.</p>
            ) : (
              <ul className="divide-y divide-line">
                {liveKeys.map((k) => (
                  <li key={k.keyId} className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{k.label}</p>
                        <Pill className={KEY_STATUS[k.status].className}>{KEY_STATUS[k.status].label}</Pill>
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        Up to {usd(k.policy.perPayoutCap)} a payout, {usd(k.policy.dailyCap)} a day, {k.policy.maxPeople}{" "}
                        {k.policy.maxPeople === 1 ? "person" : "people"} a payout.{" "}
                        {k.policy.allowlist.length ? `Only ${k.policy.allowlist.length} allowed ${k.policy.allowlist.length === 1 ? "entry" : "entries"}.` : "Anyone."}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        Key ends in …{k.tokenHint} · works until {dayFormat.format(Number(k.policy.expiresAt) * 1000)}
                        {k.lastUsedAt ? ` · last used ${dateFormat.format(k.lastUsedAt)}` : " · not used yet"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {k.status === "paused" ? (
                        <Button size="sm" onClick={() => void act(k, "resume")}>
                          Turn back on
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => void act(k, "pause")}>
                          Pause
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setEditing(k)}>
                        Edit limits
                      </Button>
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => void act(k, "revoke")}>
                        Revoke
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="connect-title" title="Connect your agent">
            <p className="mb-4 text-sm text-muted">
              Fanout is an MCP server. Add it to your agent app with the agent key, and it can check its limits and balance, ask for payouts, and follow up on them.
            </p>
            <ConnectAgent />
          </Section>

          <Section id="x402-title" title="Agents without an account">
            <X402Example />
          </Section>

          <Section id="activity-title" title="Activity">
            {data.activity.length === 0 ? (
              <p className="text-muted">Nothing yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.activity.map((a, i) => (
                  <li key={`${a.at}-${i}`} className="flex flex-wrap justify-between gap-2 text-sm">
                    <span>{describeActivity(a)}</span>
                    <span className="text-muted">{dateFormat.format(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>New agent key</DialogTitle>
            <DialogDescription>Set what the agent may ask for. You sign these limits once with your account; it costs nothing.</DialogDescription>
          </DialogHeader>
          {platform && <PolicyForm platform={platform} signer={signer} submitLabel="Sign and create key" onSigned={create} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>Edit {editing?.label}</DialogTitle>
            <DialogDescription>New limits apply from the next payout the agent asks for.</DialogDescription>
          </DialogHeader>
          {platform && editing && (
            <PolicyForm platform={platform} signer={signer} existing={editing.policy} submitLabel="Sign and save" onSigned={(body) => update(editing, body)} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!newToken} onOpenChange={(open) => !open && setNewToken(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>Save {newToken?.label}&apos;s key</DialogTitle>
            <DialogDescription>This is the only time it&apos;s shown. Fanout keeps only a fingerprint of it; if you lose it, revoke it and make a new one.</DialogDescription>
          </DialogHeader>
          {newToken && (
            <div className="flex flex-col gap-4">
              <pre className="rounded-sm border border-line bg-background p-3 font-mono text-sm break-all whitespace-pre-wrap">{newToken.token}</pre>
              <ConnectAgent token={newToken.token} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PendingRow({ r }: { r: AgentRequestSummary }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div>
        <p className="font-semibold">
          {r.agentLabel} wants to pay {usd(r.total)} to {r.people} {r.people === 1 ? "person" : "people"}
        </p>
        <p className="text-sm text-muted">
          {r.withinPolicy ? "Within its limits." : "Over its limits."} Asked {dateFormat.format(r.createdAt)}.
        </p>
      </div>
      <Button asChild size="sm" variant={r.withinPolicy ? "default" : "secondary"}>
        <Link href={`/dashboard/agents/approvals/${r.id}`}>Review</Link>
      </Button>
    </li>
  );
}

function describeActivity(a: AgentActivity): string {
  const amount = a.total ? ` ${usd(a.total)}` : "";
  switch (a.kind) {
    case "requested":
      return `${a.agentLabel} asked to pay${amount}.`;
    case "approved":
      return `You approved${amount} from ${a.agentLabel}${a.batchId ? ` (payout #${a.batchId})` : ""}.`;
    case "declined":
      return `You declined${amount} from ${a.agentLabel}.`;
    case "reminded":
      return `${a.agentLabel} sent reminders for payout #${a.batchId}.`;
    case "returned":
      return `${a.agentLabel} returned${amount} unclaimed from payout #${a.batchId}.`;
    case "key_created":
      return `You created ${a.agentLabel}'s key.`;
    case "key_paused":
      return `You paused ${a.agentLabel}${a.detail ? ` (${a.detail})` : ""}.`;
    case "key_resumed":
      return `You turned ${a.agentLabel} back on.`;
    case "key_revoked":
      return `You revoked ${a.agentLabel}'s key.`;
    case "policy_updated":
      return `You changed ${a.agentLabel}'s limits.`;
    default:
      return `${a.agentLabel}: ${a.kind}`;
  }
}
