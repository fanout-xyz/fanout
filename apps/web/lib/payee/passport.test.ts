import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import type { PayeeHistoryItem } from "@/lib/fanout/types";
import {
  bestClaim,
  decodePassport,
  encodePassport,
  linkMessage,
  monthlyIncome,
  niceFloor,
  recentMonths,
  statementMessage,
  verifyPassport,
  type Passport,
  type PassportStatement,
} from "./passport";

const accountKey = privateKeyToAccount(`0x${"11".repeat(32)}`);
const passportKey = privateKeyToAccount(`0x${"22".repeat(32)}`);
const platformA = "0x00000000000000000000000000000000000000aa" as Address;
const platformB = "0x00000000000000000000000000000000000000bb" as Address;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const now = Date.UTC(2026, 9, 15); // 15 Oct 2026

const paid = (usd: number, platform: Address, iso: string, n: number, payout = true): PayeeHistoryItem => ({
  kind: "received",
  amount: BigInt(usd) * 1_000_000n,
  counterparty: platform,
  txHash: tx(n),
  timestamp: Date.parse(iso),
  payout,
});

const history: PayeeHistoryItem[] = [
  paid(300, platformA, "2026-09-05T00:00:00Z", 1),
  paid(250, platformB, "2026-09-20T00:00:00Z", 2),
  paid(520, platformA, "2026-10-03T00:00:00Z", 3),
  paid(900, platformB, "2026-10-04T00:00:00Z", 4, false), // a transfer, not income
  { kind: "sent", amount: 100_000_000n, counterparty: platformB, txHash: tx(5), timestamp: Date.parse("2026-10-05T00:00:00Z") },
];

async function issue(over: Partial<PassportStatement> = {}): Promise<Passport> {
  const statement: PassportStatement = {
    v: 1,
    account: accountKey.address,
    passportKey: passportKey.address,
    months: ["2026-09", "2026-10"],
    minMonthlyUsd: 500,
    platforms: 2,
    issuedAt: now,
    ...over,
  };
  return {
    statement,
    link: await accountKey.signMessage({ message: linkMessage(statement.account, statement.passportKey) }),
    sig: await passportKey.signMessage({ message: statementMessage(statement) }),
  };
}

describe("earnings passport", () => {
  it("counts only claimed payouts, per month and per platform", () => {
    const income = monthlyIncome(history, ["2026-09", "2026-10"]);
    expect(income.months).toEqual([
      { month: "2026-09", cents: 55_000 },
      { month: "2026-10", cents: 52_000 },
    ]);
    expect(income.platforms).toBe(2);
    expect(bestClaim(income)).toEqual({ minMonthlyUsd: 500, platforms: 2 });
  });

  it("rounds claims down to a natural number", () => {
    expect([niceFloor(9), niceFloor(86), niceFloor(437), niceFloor(1260)]).toEqual([0, 80, 400, 1200]);
    expect(bestClaim(monthlyIncome([], ["2026-10"]))).toBeNull();
  });

  it("lists recent months oldest first, across a year boundary", () => {
    expect(recentMonths(3, Date.UTC(2026, 0, 10))).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("verifies a true claim and survives the share link", async () => {
    const p = decodePassport(encodePassport(await issue()))!;
    expect(p).not.toBeNull();
    expect((await verifyPassport(p, history, now)).ok).toBe(true);
  });

  it("refuses a claim the payouts don't support", async () => {
    const tooHigh = await verifyPassport(await issue({ minMonthlyUsd: 600 }), history, now);
    expect(tooHigh).toMatchObject({ ok: false, reason: "short-month", detail: "2026-09" });
    const tooMany = await verifyPassport(await issue({ platforms: 3 }), history, now);
    expect(tooMany).toMatchObject({ ok: false, reason: "few-platforms" });
  });

  it("refuses edited statements and keys that the account didn't vouch for", async () => {
    const p = await issue();
    const edited = { ...p, statement: { ...p.statement, minMonthlyUsd: 50 } };
    expect(await verifyPassport(edited, history, now)).toMatchObject({ ok: false, reason: "signature" });

    const stranger = privateKeyToAccount(`0x${"33".repeat(32)}`);
    const forged = { ...p, link: await stranger.signMessage({ message: linkMessage(p.statement.account, p.statement.passportKey) }) };
    expect(await verifyPassport(forged, history, now)).toMatchObject({ ok: false, reason: "signature" });
  });

  it("refuses months that haven't happened", async () => {
    expect(await verifyPassport(await issue({ months: ["2026-10", "2026-11"] }), history, now)).toMatchObject({ ok: false, reason: "future" });
  });

  it("rejects malformed links", () => {
    expect(decodePassport("not-base64!")).toBeNull();
    expect(decodePassport(encodePassport({ statement: { v: 2 } } as unknown as Passport))).toBeNull();
  });
});
