import { keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { memoryKv } from "@/lib/agents/kv";
import { mockLedger } from "@/lib/agents/ledger";
import { policyToJson, signAgentPolicy, type AgentPolicy } from "@/lib/agents/policy";
import type { AgentDeps } from "@/lib/agents/service";
import { agentStore } from "@/lib/agents/store";
import { activeChain } from "@/lib/chains";
import { emptyState, engine, type MockState } from "@/lib/fanout/mock-engine";

/** Shared fixtures for the agent tests: a platform account that really signs, and an in-memory world. */

export const platformAccount = privateKeyToAccount(keccak256(toBytes("fanout-test:platform")));
export const otherAccount = privateKeyToAccount(keccak256(toBytes("fanout-test:other")));
export const usd = (s: string) => BigInt(Math.round(Number(s) * 100)) * 10_000n; // 6 decimals

export function world(opts: { now?: number; balance?: string } = {}) {
  let now = opts.now ?? Date.now();
  const state: MockState = emptyState();
  if (opts.balance) engine.deposit(state, platformAccount.address, usd(opts.balance));
  const kv = memoryKv();
  const sent: { platform: string; emails: string[]; reminder: boolean }[] = [];
  const deps: AgentDeps = {
    store: agentStore(kv),
    ledger: mockLedger({ state: () => state, save: () => {}, now: () => now }),
    secret: "test-secret-test-secret-test-secret",
    origin: "https://fanout.test",
    decimals: 6,
    now: () => now,
    emailer: {
      async send(platform, requests, reminder) {
        sent.push({ platform, emails: requests.map((r) => r.email), reminder });
        return { sent: requests.map(() => platformAccount.address), failed: [] };
      },
    },
  };
  return {
    deps,
    state,
    sent,
    advance: (ms: number) => (now += ms),
    nowSeconds: () => BigInt(Math.floor(now / 1000)),
  };
}

export function policy(overrides: Partial<AgentPolicy> = {}, nowSeconds = BigInt(Math.floor(Date.UTC(2026, 9, 1, 12) / 1000))): AgentPolicy {
  return {
    platform: platformAccount.address,
    keyId: keccak256(toBytes(`key:${Math.random()}`)) as Hex,
    label: "Support bot",
    perPayoutCap: usd("100"),
    dailyCap: usd("250"),
    maxPeople: 5,
    allowlist: [],
    expiresAt: nowSeconds + 30n * 86_400n,
    version: 1,
    ...overrides,
  };
}

export async function signedPolicyBody(p: AgentPolicy, signer = platformAccount) {
  return { policy: policyToJson(p), signature: await signAgentPolicy(signer, activeChain.id, p) };
}
