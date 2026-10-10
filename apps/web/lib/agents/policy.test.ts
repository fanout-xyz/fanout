import { describe, expect, it } from "vitest";
import { activeChain } from "@/lib/chains";
import { formatUsd } from "@/lib/money";
import { otherAccount, platformAccount, policy, usd } from "@/test/agents";
import {
  allowedByList,
  keyBlocked,
  normalizeAllowlistEntry,
  parsePolicy,
  PolicyInvalid,
  policyBreaches,
  policyToJson,
  signAgentPolicy,
  verifyAgentPolicy,
} from "./policy";

const now = BigInt(Math.floor(Date.UTC(2026, 9, 1, 12) / 1000));
const fmt = (a: bigint) => formatUsd(a, 6);

describe("agent policy signature", () => {
  it("verifies the platform's signature and nothing else", async () => {
    const p = policy();
    const sig = await signAgentPolicy(platformAccount, activeChain.id, p);
    expect(await verifyAgentPolicy(activeChain.id, p, sig)).toBe(true);
    // Any change to the signed fields breaks it.
    expect(await verifyAgentPolicy(activeChain.id, { ...p, perPayoutCap: p.perPayoutCap + 1n }, sig)).toBe(false);
    expect(await verifyAgentPolicy(activeChain.id, { ...p, allowlist: ["@evil.com"] }, sig)).toBe(false);
    expect(await verifyAgentPolicy(activeChain.id, { ...p, version: 2 }, sig)).toBe(false);
    expect(await verifyAgentPolicy(activeChain.id + 1, p, sig)).toBe(false);
    // Someone else's signature over the platform's policy doesn't count.
    expect(await verifyAgentPolicy(activeChain.id, p, await signAgentPolicy(otherAccount, activeChain.id, p))).toBe(false);
  });

  it("round-trips through JSON", () => {
    const p = policy({ allowlist: ["ana@example.com", "@team.dev"] });
    expect(parsePolicy(JSON.parse(JSON.stringify(policyToJson(p))), now)).toEqual(p);
  });
});

describe("parsePolicy", () => {
  const base = () => policyToJson(policy());
  const bad = (patch: Record<string, unknown>, msg: RegExp | typeof PolicyInvalid) => expect(() => parsePolicy({ ...base(), ...patch }, now)).toThrow(msg);

  it("refuses limits that make no sense", () => {
    bad({ perPayoutCap: "0" }, /limit per payout/);
    bad({ dailyCap: "1", perPayoutCap: "2" }, /daily limit can't be lower/);
    bad({ perPayoutCap: 5 }, /limit per payout/); // numbers, not strings
    bad({ maxPeople: 0 }, /between 1 and 150/);
    bad({ maxPeople: 151 }, /between 1 and 150/);
    bad({ label: "" }, /name/);
  });

  it("refuses an expiry in the past or more than a year out", () => {
    bad({ expiresAt: (now - 1n).toString() }, /expire in the future/);
    bad({ expiresAt: (now + 400n * 86_400n).toString() }, /within a year/);
    expect(() => parsePolicy({ ...base(), expiresAt: (now - 1n).toString() }, null)).not.toThrow(); // loading a stored one
  });

  it("only takes normalized allowlist entries", () => {
    bad({ allowlist: ["Ana@Example.com"] }, PolicyInvalid);
    bad({ allowlist: ["not an email"] }, /isn't an email or a domain/);
    bad({ allowlist: ["@a.com", "@a.com"] }, PolicyInvalid);
    expect(normalizeAllowlistEntry(" Ana@Example.com ")).toBe("ana@example.com");
    expect(normalizeAllowlistEntry("Example.com")).toBe("@example.com");
    expect(normalizeAllowlistEntry("@sub.example.co.uk")).toBe("@sub.example.co.uk");
    expect(normalizeAllowlistEntry("nope")).toBeNull();
  });
});

describe("policy checks", () => {
  const p = policy({ perPayoutCap: usd("100"), dailyCap: usd("250"), maxPeople: 2, allowlist: ["boss@corp.com", "@team.dev"] });

  it("passes a payout within every limit", () => {
    expect(policyBreaches(p, { total: usd("100"), emails: ["a@team.dev", "boss@corp.com"], spentLast24h: usd("150") }, fmt)).toEqual([]);
  });

  it("flags the per-payout cap", () => {
    const b = policyBreaches(p, { total: usd("100.01"), emails: ["a@team.dev"], spentLast24h: 0n }, fmt);
    expect(b.map((x) => x.code)).toEqual(["per_payout_cap"]);
    expect(b[0].message).toBe("$100.01 is over the $100.00 limit per payout.");
  });

  it("flags the daily cap, counting what was already spent", () => {
    const b = policyBreaches(p, { total: usd("60"), emails: ["a@team.dev"], spentLast24h: usd("200") }, fmt);
    expect(b.map((x) => x.code)).toEqual(["daily_cap"]);
    expect(b[0].message).toBe("Only $50.00 of the $250.00 daily limit is left.");
  });

  it("flags too many people", () => {
    const b = policyBreaches(p, { total: usd("3"), emails: ["a@team.dev", "b@team.dev", "c@team.dev"], spentLast24h: 0n }, fmt);
    expect(b.map((x) => x.code)).toEqual(["max_people"]);
  });

  it("flags people outside the allowlist, by email", () => {
    const b = policyBreaches(p, { total: usd("3"), emails: ["a@team.dev", "x@corp.com"], spentLast24h: 0n }, fmt);
    expect(b).toEqual([{ code: "allowlist", message: "1 person isn't on the allowlist.", emails: ["x@corp.com"] }]);
    // Domains match exactly: a subdomain or a lookalike isn't the same domain.
    expect(allowedByList(p.allowlist, "a@evil.team.dev")).toBe(false);
    expect(allowedByList(p.allowlist, "a@team.dev.evil.com")).toBe(false);
    expect(allowedByList(p.allowlist, "BOSS@corp.com")).toBe(true);
    expect(allowedByList([], "anyone@anywhere.io")).toBe(true);
  });
});

describe("keyBlocked (kill switch, revoke, expiry)", () => {
  const p = policy({ expiresAt: now + 10n });
  it("lets an active key through", () => expect(keyBlocked({ paused: false }, p, now)).toBeNull());
  it("stops a paused key", () => expect(keyBlocked({ paused: true }, p, now)).toMatch(/paused/));
  it("stops a revoked key", () => expect(keyBlocked({ paused: false, revokedAt: 1 }, p, now)).toMatch(/revoked/));
  it("stops an expired key", () => expect(keyBlocked({ paused: false }, p, now + 10n)).toMatch(/expired/));
});
