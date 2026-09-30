import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { hashEmail } from "@/lib/email-hash";
import { generateClaimKey } from "./claim-keys";
import { EmailRefused, parseRequests, sendClaimEmails } from "./claim-emailer";
import { emptyState, engine } from "./mock-engine";

// Runs in mock mode (NEXT_PUBLIC_USE_MOCK unset): claims are read from the in-memory mock state.
const g = globalThis as typeof globalThis & { __fanoutMock?: ReturnType<typeof emptyState> };
const platform = privateKeyToAccount("0x" + "11".repeat(32) as `0x${string}`).address;
const other = privateKeyToAccount("0x" + "22".repeat(32) as `0x${string}`).address;

let sentBodies: { to: string[]; html: string; text: string }[][] = [];

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

  it("refuses when email isn't configured, and rejects malformed requests", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendClaimEmails({ requests: [], accessToken: null, mockAccount: platform })).rejects.toThrow(EmailRefused);
    expect(() => parseRequests({ links: [] })).toThrow(EmailRefused);
    expect(() => parseRequests({ links: [{ key: "0x12", email: "a@b.co" }] })).toThrow(EmailRefused);
  });
});
