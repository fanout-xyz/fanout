import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import type { PayeeHistoryItem } from "@/lib/fanout/types";
import { encodePassport, linkMessage, statementMessage, type Passport, type PassportStatement } from "./passport";
import {
  badgeModel,
  badgeResponseHeaders,
  badgeSnippets,
  badgeSvg,
  parseBadgeRequest,
  resolveBadge,
  UNVERIFIED,
} from "./passport-badge";
import { DEFAULT_FIELDS } from "./passport-share";

const accountKey = privateKeyToAccount(`0x${"11".repeat(32)}`);
const passportKey = privateKeyToAccount(`0x${"22".repeat(32)}`);
const platform = "0x00000000000000000000000000000000000000aa" as Address;
const now = Date.UTC(2026, 9, 15);
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

const history: PayeeHistoryItem[] = [
  { kind: "received", amount: 612_340_000n, counterparty: platform, txHash: tx(1), timestamp: Date.UTC(2026, 8, 3), payout: true },
  { kind: "received", amount: 587_000_000n, counterparty: platform, txHash: tx(2), timestamp: Date.UTC(2026, 9, 2), payout: true },
];

async function issue(over: Partial<PassportStatement> = {}): Promise<Passport> {
  const statement: PassportStatement = {
    v: 1,
    account: accountKey.address,
    passportKey: passportKey.address,
    months: ["2026-09", "2026-10"],
    minMonthlyUsd: 550,
    platforms: 1,
    issuedAt: now,
    ...over,
  };
  return {
    statement,
    link: await accountKey.signMessage({ message: linkMessage(statement.account, statement.passportKey) }),
    sig: await passportKey.signMessage({ message: statementMessage(statement) }),
  };
}

const params = (o: Record<string, string>) => new URLSearchParams(o);
const lookup = async () => history;

describe("badge request validation", () => {
  it("reads a well-formed request", async () => {
    const p = await issue();
    const { theme, request } = parseBadgeRequest(params({ p: encodePassport(p), show: "ap", theme: "dark" }));
    expect(theme).toBe("dark");
    expect(request?.passport).toEqual(p);
    expect(request?.fields).toEqual({ amount: true, platforms: true, total: false });
  });

  it.each([
    ["no passport", {}],
    ["garbage passport", { p: "not-a-passport" }],
    ["oversized passport", { p: "a".repeat(5_000) }],
    ["unknown field codes", { p: "x", show: "apz" }],
  ])("refuses %s", async (_, o) => {
    const fixed = "p" in o && o.p === "x" ? { ...o, p: encodePassport(await issue()) } : o;
    expect(parseBadgeRequest(params(fixed as Record<string, string>)).request).toBeNull();
  });

  it("falls back to the light theme", () => {
    expect(parseBadgeRequest(params({ theme: "neon" })).theme).toBe("light");
  });
});

describe("badge privacy and verification", () => {
  it("shows only what the signed statement says, never the total or payments", async () => {
    const p = await issue();
    const model = await resolveBadge({ passport: p, fields: { ...DEFAULT_FIELDS, total: true }, theme: "light" }, lookup, now);
    expect(model).toEqual({ verified: true, label: "Verified", message: "at least $550/mo · 2 months · 1 platform" });
    const svg = badgeSvg(model, "light");
    for (const leak of ["612", "587", "1,199", "1199", p.statement.account.slice(2, 10), "total"]) expect(svg).not.toContain(leak);
  });

  it("follows the payee's hidden fields", async () => {
    const p = await issue();
    expect(badgeModel(p, { amount: false, platforms: false, total: false }).message).toBe("paid every month · 2 months");
  });

  it("is neutral when the payouts don't back the claim", async () => {
    const p = await issue({ minMonthlyUsd: 600 });
    expect(await resolveBadge({ passport: p, fields: DEFAULT_FIELDS, theme: "light" }, lookup, now)).toEqual(UNVERIFIED);
  });

  it("is neutral when the statement was edited after signing", async () => {
    const p = await issue();
    const edited = { ...p, statement: { ...p.statement, minMonthlyUsd: 500 } };
    expect(await resolveBadge({ passport: edited, fields: DEFAULT_FIELDS, theme: "light" }, lookup, now)).toEqual(UNVERIFIED);
  });

  it("is neutral when records can't be read", async () => {
    const p = await issue();
    const req = { passport: p, fields: DEFAULT_FIELDS, theme: "light" as const };
    expect(await resolveBadge(req, async () => null, now)).toEqual(UNVERIFIED);
    expect(await resolveBadge(req, async () => Promise.reject(new Error("down")), now)).toEqual(UNVERIFIED);
    expect(await resolveBadge(null, lookup, now)).toEqual(UNVERIFIED);
  });

  it("caches verified badges longer than neutral ones and can't run scripts", () => {
    expect(badgeResponseHeaders({ verified: true, label: "", message: "" })["Cache-Control"]).toContain("s-maxage=86400");
    const neutral = badgeResponseHeaders(UNVERIFIED);
    expect(neutral["Cache-Control"]).toBe("public, max-age=300, s-maxage=300");
    expect(neutral["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(neutral["Content-Type"]).toContain("image/svg+xml");
  });

  it("escapes snippet attributes", () => {
    const s = badgeSnippets("https://x.test/b?p=1&show=a", "https://x.test/verify?m=1#p=2&show=a", 'Verified "earnings"');
    expect(s.html).toBe(
      '<a href="https://x.test/verify?m=1#p=2&amp;show=a"><img src="https://x.test/b?p=1&amp;show=a" alt="Verified &quot;earnings&quot;" height="28"></a>',
    );
    expect(s.markdown).toBe('[![Verified "earnings"](https://x.test/b?p=1&show=a)](https://x.test/verify?m=1#p=2&show=a)');
  });
});
