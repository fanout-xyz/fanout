import { describe, expect, it, vi } from "vitest";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { memoryKv } from "@/lib/agents/kv";
import { randomNonce, signAuthorization } from "@/lib/fanout/erc3009";
import { feeCents, x402Config } from "./config";
import { mockFacilitator, type Facilitator } from "./facilitator";
import { handleX402Payout, requirementsFor, type PayoutAccount, type X402Deps } from "./payout";
import {
  decodeHeader,
  encodeHeader,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
} from "./protocol";

const payer = privateKeyToAccount(keccak256(toBytes("fanout-test:x402-payer")));
const operator = privateKeyToAccount(keccak256(toBytes("fanout-test:x402-operator"))).address as Address;
const cfg = x402Config({ X402_FACILITATOR: "" }, true);
const NOW = Date.UTC(2026, 9, 8, 12);

function setup(overrides: Partial<X402Deps> = {}, facilitator?: Facilitator) {
  const account: PayoutAccount & { pay: ReturnType<typeof vi.fn>; refund: ReturnType<typeof vi.fn> } = {
    address: operator,
    canCover: vi.fn(async () => true),
    pay: vi.fn(async () => ({ batchId: "77", txHash: "0xbeef" as Hex })),
    refund: vi.fn(async () => "0xfeed" as Hex),
  };
  const sent: string[] = [];
  const deps: X402Deps = {
    kv: memoryKv(),
    cfg,
    facilitator: facilitator ?? mockFacilitator(cfg.chainId),
    account,
    decimals: 6,
    resourceUrl: "https://fanout.test/api/x402/payout",
    origin: "https://fanout.test",
    emailer: async (_platform, requests) => {
      sent.push(...requests.map((r) => r.email));
      return { sent: requests.map(() => operator), failed: [] };
    },
    demo: false,
    now: () => NOW,
    ...overrides,
  };
  return { deps, account, sent };
}

const body = { rows: [{ email: "ana@example.com", amount: "20.00" }, { email: "bo@example.com", amount: "5.00", note: "thanks" }] };

function req(b: unknown = body, headers: Record<string, string> = {}) {
  return new Request("https://fanout.test/api/x402/payout", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "agent-run-0001", ...headers },
    body: JSON.stringify(b),
  });
}

async function pay(requirements: PaymentRequirements, overrides: Partial<{ value: bigint; validBefore: bigint }> = {}): Promise<string> {
  const now = BigInt(Math.floor(NOW / 1000));
  const auth = {
    from: payer.address,
    to: requirements.payTo,
    value: overrides.value ?? BigInt(requirements.amount),
    validAfter: now - 10n,
    validBefore: overrides.validBefore ?? now + 300n,
    nonce: randomNonce(),
  };
  const signature = await signAuthorization(
    payer,
    "TransferWithAuthorization",
    { name: requirements.extra.name, version: requirements.extra.version, chainId: cfg.chainId, verifyingContract: requirements.asset },
    auth,
  );
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: {
      signature,
      authorization: { ...auth, value: auth.value.toString(), validAfter: auth.validAfter.toString(), validBefore: auth.validBefore.toString() },
    },
  };
  return encodeHeader(payload);
}

async function quote(deps: X402Deps) {
  const res = await handleX402Payout(deps, req());
  return { res, required: decodeHeader<PaymentRequired>(res.headers.get(HEADER_PAYMENT_REQUIRED)!)! };
}

describe("x402 payout: the 402", () => {
  it("asks for the payout plus fee, in USDC on Monad testnet, paid to the operator", async () => {
    const { deps } = setup();
    const { res, required } = await quote(deps);
    expect(res.status).toBe(402);
    expect(required).toEqual({
      x402Version: 2,
      error: "Payment required",
      resource: { url: "https://fanout.test/api/x402/payout", description: "Pay 2 people by email: $25.00 plus a $0.13 fee.", mimeType: "application/json" },
      accepts: [
        {
          scheme: "exact",
          network: "eip155:10143",
          amount: "25130000", // $25.13 in USDC (6 decimals)
          asset: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
          payTo: operator,
          maxTimeoutSeconds: 300,
          extra: { name: "USDC", version: "2" },
        },
      ],
    });
    // The body repeats it, plus a plain quote.
    expect(await res.json()).toMatchObject({ x402Version: 2, quote: { payout_total: "25.00", fee: "0.13", total: "25.13", people: 2 } });
  });

  it("charges at least the minimum fee", () => {
    expect(feeCents(cfg, 100n)).toBe(10n); // $1.00 -> $0.10
    expect(feeCents(cfg, 100_000n)).toBe(500n); // $1,000 -> $5.00
  });

  it("validates rows, caps and the idempotency key before quoting", async () => {
    const { deps } = setup();
    expect((await handleX402Payout(deps, req(body, { "idempotency-key": "x" }))).status).toBe(400);
    const bad = await handleX402Payout(deps, req({ rows: [{ email: "a@example.com", amount: 5 }] }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).problems[0].row).toBe(1);
    const big = await handleX402Payout(deps, req({ rows: [{ email: "a@example.com", amount: "1000.01" }] }));
    expect(big.status).toBe(400);
    const many = await handleX402Payout(deps, req({ rows: Array.from({ length: 51 }, (_, i) => ({ email: `p${i}@example.com`, amount: "1.00" })) }));
    expect((await many.json()).error).toMatch(/up to 50/);
  });
});

describe("x402 payout: paying", () => {
  it("verifies, settles, pays the rows and emails the links", async () => {
    const { deps, account, sent } = setup();
    const { required } = await quote(deps);
    const res = await handleX402Payout(deps, req(body, { [HEADER_PAYMENT_SIGNATURE]: await pay(required.accepts[0]) }));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ payout_id: "77", status: "sent", paid: "25.13", status_url: "https://fanout.test/api/x402/payout/77", emailed: { sent: 2, failed: 0 } });
    expect(out.payment.payer).toBe(payer.address);
    expect(decodeHeader<{ success: boolean }>(res.headers.get(HEADER_PAYMENT_RESPONSE)!)).toMatchObject({ success: true, payer: payer.address });
    expect(account.pay).toHaveBeenCalledTimes(1);
    expect(account.pay.mock.calls[0][0].map((r: { amount: bigint }) => r.amount)).toEqual([20_000_000n, 5_000_000n]);
    expect(sent).toEqual(["ana@example.com", "bo@example.com"]);
  });

  it("never charges twice for the same Idempotency-Key", async () => {
    const settle = vi.fn();
    const inner = mockFacilitator(cfg.chainId);
    const facilitator: Facilitator = { verify: inner.verify, settle: (p, r) => (settle(), inner.settle(p, r)) };
    const { deps, account } = setup({}, facilitator);
    const { required } = await quote(deps);
    const header = await pay(required.accepts[0]);
    const first = await (await handleX402Payout(deps, req(body, { [HEADER_PAYMENT_SIGNATURE]: header }))).json();
    // A retry, with or without the payment, gets the first answer.
    const again = await handleX402Payout(deps, req(body, { [HEADER_PAYMENT_SIGNATURE]: await pay(required.accepts[0]) }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ payout_id: first.payout_id, replayed: true });
    expect((await handleX402Payout(deps, req())).status).toBe(200);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(account.pay).toHaveBeenCalledTimes(1);
    // The same key for a different payout is refused.
    const other = await handleX402Payout(deps, req({ rows: [{ email: "x@example.com", amount: "1.00" }] }));
    expect(other.status).toBe(409);
  });

  it("refuses a payment for the wrong amount, a bad signature or a reused authorization", async () => {
    const { deps, account } = setup();
    const { required } = await quote(deps);
    const short = { ...required.accepts[0], amount: "1" };
    const wrong = await handleX402Payout(deps, req(body, { [HEADER_PAYMENT_SIGNATURE]: await pay(short) }));
    expect(wrong.status).toBe(402);
    expect(decodeHeader<PaymentRequired>(wrong.headers.get(HEADER_PAYMENT_REQUIRED)!)!.error).toMatch(/doesn't match/);

    // Tamper with the value after signing: the signature no longer matches.
    const good = decodeHeader<PaymentPayload>(await pay(required.accepts[0]))!;
    const forged = encodeHeader({ ...good, payload: { ...good.payload, authorization: { ...good.payload.authorization, validBefore: String(BigInt(good.payload.authorization.validBefore) + 1n) } } });
    const bad = await handleX402Payout(deps, req(body, { [HEADER_PAYMENT_SIGNATURE]: forged }));
    expect(bad.status).toBe(402);
    expect(decodeHeader<PaymentRequired>(bad.headers.get(HEADER_PAYMENT_REQUIRED)!)!.error).toMatch(/signature/);

    // One signed authorization pays once, even under a new Idempotency-Key.
    const header = await pay(required.accepts[0]);
    expect((await handleX402Payout(deps, req(body, { [HEADER_PAYMENT_SIGNATURE]: header }))).status).toBe(200);
    const reused = await handleX402Payout(deps, req(body, { [HEADER_PAYMENT_SIGNATURE]: header, "idempotency-key": "agent-run-0002" }));
    expect(reused.status).toBe(402);
    expect(account.pay).toHaveBeenCalledTimes(1);
  });

  it("refuses an expired authorization", async () => {
    const { deps } = setup();
    const { required } = await quote(deps);
    const old = await pay(required.accepts[0], { validBefore: BigInt(Math.floor(NOW / 1000)) - 1n });
    const res = await handleX402Payout(deps, req(body, { [HEADER_PAYMENT_SIGNATURE]: old }));
    expect(res.status).toBe(402);
  });

  it("takes nothing when the payout can't be made or emailed", async () => {
    const settle = vi.fn();
    const facilitator: Facilitator = { verify: async () => ({ isValid: true, payer: payer.address }), settle: async () => (settle(), { success: false, errorReason: "x", network: cfg.network }) };
    const { deps, account } = setup({}, facilitator);
    account.canCover = async () => false;
    const { required } = await quote(deps);
    expect((await handleX402Payout(deps, req(body, { [HEADER_PAYMENT_SIGNATURE]: await pay(required.accepts[0]) }))).status).toBe(503);
    const noEmail = setup({ emailer: undefined }, facilitator);
    expect((await handleX402Payout(noEmail.deps, req(body, { [HEADER_PAYMENT_SIGNATURE]: await pay(required.accepts[0]) }))).status).toBe(503);
    expect(settle).not.toHaveBeenCalled();
  });

  it("sends the payment back if the payout fails after it settled", async () => {
    const { deps, account } = setup();
    account.pay.mockRejectedValueOnce(new Error("chain down"));
    const { required } = await quote(deps);
    const res = await handleX402Payout(deps, req(body, { [HEADER_PAYMENT_SIGNATURE]: await pay(required.accepts[0]) }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ refund: { status: "refunded", transaction: "0xfeed" } });
    expect(account.refund).toHaveBeenCalledWith(payer.address, 25_130_000n);
    // A retry with the same key reports the refund instead of charging again.
    const again = await handleX402Payout(deps, req());
    expect(again.status).toBe(502);
    expect(await again.json()).toMatchObject({ replayed: true, refund: { status: "refunded" } });
  });

  it("calls an HTTP facilitator with the x402 v2 body", async () => {
    const { httpFacilitator } = await import("./facilitator");
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json(url.endsWith("/verify") ? { isValid: true, payer: payer.address } : { success: true, payer: payer.address, transaction: "0xabc", network: "eip155:10143" });
    }) as unknown as typeof fetch;
    const { deps } = setup({}, httpFacilitator("https://facilitator.test", fetchImpl));
    const { required } = await quote(deps);
    const res = await handleX402Payout(deps, req(body, { [HEADER_PAYMENT_SIGNATURE]: await pay(required.accepts[0]) }));
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual(["https://facilitator.test/verify", "https://facilitator.test/settle"]);
    expect(calls[0].body).toMatchObject({ x402Version: 2, paymentRequirements: requirementsFor(deps, 2513n), paymentPayload: { x402Version: 2 } });
  });
});
