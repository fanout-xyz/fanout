import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { hashEmail } from "@/lib/email-hash";
import { generateClaimKey } from "./claim-keys";
import { claimEmailProofMessage } from "./claim-email-proof";
import { EmailRefused, parseRequests, sendClaimEmails } from "./claim-emailer";
import { emptyState, engine } from "./mock-engine";

// Runs in mock mode (NEXT_PUBLIC_USE_MOCK unset): claims are read from the in-memory mock state.
const g = globalThis as typeof globalThis & { __fanoutMock?: ReturnType<typeof emptyState> };
const platformAccount = privateKeyToAccount("0x" + "11".repeat(32) as `0x${string}`);
const platform = platformAccount.address;
const other = privateKeyToAccount("0x" + "22".repeat(32) as `0x${string}`).address;

let sentBodies: { from: string; to: string[]; html: string; text: string }[][] = [];

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.CLAIM_EMAIL_FROM = "Fanout <pay@fanout.test>";
  process.env.NEXT_PUBLIC_SITE_URL = "https://fanout.test";
  g.__fanoutMock = emptyState();
  g.__fanoutMock.treasury[platform.toLowerCase() as `0x${string}`] = 1_000_000_000n;
  sentBodies = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    sentBodies.push(JSON.parse(String(init.body)));
    return new Response("{}", { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pay(email: string) {
  const key = generateClaimKey();
  engine.createBatchPayout(g.__fanoutMock!, platform, [{ claimSigner: key.claimSigner, amount: 50_000_000n, emailHash: hashEmail(email) }]);
  return key;
}

describe("sendClaimEmails", () => {
  it("emails the payee a link on our origin with the amount from the payout", async () => {
    const key = pay("ana@example.com");
    const res = await sendClaimEmails({ requests: [{ key: key.privateKey, email: "Ana@Example.com " }], accessToken: null, mockAccount: platform });
    expect(res.sent).toEqual([key.claimSigner]);
    expect(res.failed).toEqual([]);
    const [email] = sentBodies[0];
    expect(email.to).toEqual(["Ana@Example.com"]);
    expect(email.text).toContain(`https://fanout.test/claim#k=${key.privateKey.slice(2)}`);
    expect(email.text).toContain("$50.00");
  });

  it("refuses links for another email, another platform, or no payout, and sends nothing for them", async () => {
    const key = pay("ana@example.com");
    const unknown = generateClaimKey();
    const res = await sendClaimEmails({
      requests: [
        { key: key.privateKey, email: "mallory@example.com" },
        { key: unknown.privateKey, email: "ana@example.com" },
      ],
      accessToken: null,
      mockAccount: platform,
    });
    expect(res.sent).toEqual([]);
    expect(res.failed.map((f) => f.reason)).toEqual([
      "The email doesn't match the one this payout was made to.",
      "This payout doesn't exist.",
    ]);
    const asOther = await sendClaimEmails({ requests: [{ key: key.privateKey, email: "ana@example.com" }], accessToken: null, mockAccount: other });
    expect(asOther.failed[0].reason).toBe("This payout wasn't sent from your account.");
    expect(sentBodies).toEqual([]);
  });

  it("sends from pay@fanout.tech when CLAIM_EMAIL_FROM isn't set", async () => {
    delete process.env.CLAIM_EMAIL_FROM;
    const key = pay("ana@example.com");
    const res = await sendClaimEmails({ requests: [{ key: key.privateKey, email: "ana@example.com" }], accessToken: null, mockAccount: platform });
    expect(res.sent).toEqual([key.claimSigner]);
    expect(sentBodies[0][0].from).toBe("Fanout <pay@fanout.tech>");
  });

  it("emails a payee's own payment when their account signs for it (paying by email)", async () => {
    const key = pay("ana@example.com");
    const signature = await platformAccount.signMessage({ message: claimEmailProofMessage(platform, [key.claimSigner]) });
    // Signed in as someone else entirely: the proof is what shows the payout is theirs.
    const res = await sendClaimEmails({
      requests: [{ key: key.privateKey, email: "ana@example.com" }],
      accessToken: null,
      mockAccount: other,
      proof: { address: platform, signature },
    });
    expect(res.sent).toEqual([key.claimSigner]);
  });

  it("refuses a proof signed for different payouts or by another account", async () => {
    const key = pay("ana@example.com");
    const otherKey = pay("bo@example.com");
    const forOther = await platformAccount.signMessage({ message: claimEmailProofMessage(platform, [otherKey.claimSigner]) });
    await expect(
      sendClaimEmails({ requests: [{ key: key.privateKey, email: "ana@example.com" }], accessToken: null, mockAccount: other, proof: { address: platform, signature: forOther } }),
    ).rejects.toThrow(EmailRefused);
    const byOther = await privateKeyToAccount("0x" + "22".repeat(32) as `0x${string}`).signMessage({
      message: claimEmailProofMessage(platform, [key.claimSigner]),
    });
    await expect(
      sendClaimEmails({ requests: [{ key: key.privateKey, email: "ana@example.com" }], accessToken: null, mockAccount: other, proof: { address: platform, signature: byOther } }),
    ).rejects.toThrow(EmailRefused);
    expect(sentBodies).toEqual([]);
  });

  it("emails a full 150-person payout in two batch calls", async () => {
    g.__fanoutMock!.treasury[platform.toLowerCase() as `0x${string}`] = 150n * 50_000_000n;
    const requests = Array.from({ length: 150 }, (_, i) => ({ key: pay(`p${i}@fanout.tech`).privateKey, email: `p${i}@fanout.tech` }));
    expect(parseRequests({ links: requests })).toHaveLength(150);
    const res = await sendClaimEmails({ requests, accessToken: null, mockAccount: platform });
    expect(res.sent).toHaveLength(150);
    expect(res.failed).toEqual([]);
    expect(sentBodies.map((b) => b.length)).toEqual([100, 50]);
  });

  it("waits and retries when Resend rate-limits, but not when the daily quota is used up", async () => {
    const key = pay("ana@example.com");
    const replies = [
      new Response(JSON.stringify({ name: "rate_limit_exceeded" }), { status: 429, headers: { "retry-after": "0.01" } }),
      new Response("{}", { status: 200 }),
    ];
    const fetchMock = vi.fn(async () => replies.shift()!);
    vi.stubGlobal("fetch", fetchMock);
    const ok = await sendClaimEmails({ requests: [{ key: key.privateKey, email: "ana@example.com" }], accessToken: null, mockAccount: platform });
    expect(ok.sent).toEqual([key.claimSigner]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const quota = vi.fn(async () => new Response(JSON.stringify({ name: "daily_quota_exceeded" }), { status: 429 }));
    vi.stubGlobal("fetch", quota);
    const res = await sendClaimEmails({ requests: [{ key: key.privateKey, email: "ana@example.com" }], accessToken: null, mockAccount: platform });
    expect(res.sent).toEqual([]);
    expect(res.failed[0].reason).toMatch(/daily email limit/);
    expect(quota).toHaveBeenCalledTimes(1);
  });

  it("refuses when email isn't configured, and rejects malformed requests", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendClaimEmails({ requests: [], accessToken: null, mockAccount: platform })).rejects.toThrow(EmailRefused);
    expect(() => parseRequests({ links: [] })).toThrow(EmailRefused);
    expect(() => parseRequests({ links: [{ key: "0x12", email: "a@b.co" }] })).toThrow(EmailRefused);
  });

  it("hands the paid notifications off after the emails, without affecting them", async () => {
    const key = pay("ana@example.com");
    const schedule = vi.fn();
    const res = await sendClaimEmails({ requests: [{ key: key.privateKey, email: "ana@example.com" }], accessToken: null, mockAccount: platform, schedule });
    expect(res).toEqual({ sent: [key.claimSigner], failed: [] });
    expect(schedule).toHaveBeenCalledTimes(1);
    // Push isn't configured here: the task is a no-op and never throws.
    await expect(schedule.mock.calls[0][0]()).resolves.toBeUndefined();
  });

  it("doesn't notify for reminders or for emails that didn't go out", async () => {
    const key = pay("ana@example.com");
    const schedule = vi.fn();
    await sendClaimEmails({ requests: [{ key: key.privateKey, email: "ana@example.com" }], accessToken: null, mockAccount: platform, reminder: true, schedule });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await sendClaimEmails({ requests: [{ key: key.privateKey, email: "ana@example.com" }], accessToken: null, mockAccount: platform, schedule });
    expect(schedule).not.toHaveBeenCalled();
  });
});
