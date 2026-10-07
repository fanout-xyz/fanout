import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getPayEmail } from "@/app/api/relay/pay-email/route";
import { GET } from "@/app/api/relay/send/route";
import { randomNonce } from "./erc3009";
import { ClaimRefused, relayEmailPayment, relayEmailPaymentConfigured, relaySend, relaySendConfigured, RelayUnavailable } from "./relayer";

const from = privateKeyToAccount(generatePrivateKey()).address;
const to = privateKeyToAccount(generatePrivateKey()).address;
const now = () => Math.floor(Date.now() / 1000);

/** A well-formed request: every check before the relayer itself passes. */
const valid = () => ({
  from,
  to,
  value: "25000000",
  validAfter: "0",
  validBefore: String(now() + 600),
  nonce: randomNonce(),
  signature: `0x${"ab".repeat(65)}`,
  accessToken: "token",
});

afterEach(() => vi.unstubAllEnvs());

/** A well-formed pay-by-email request (BatchPayout.depositAndCreateBatchFor). */
const validPayment = (): Record<string, unknown> => ({
  platform: from,
  claimSigners: [privateKeyToAccount(generatePrivateKey()).address],
  amounts: ["25000000"],
  emailHashes: [randomNonce()],
  claimWindow: "0",
  nonce: randomNonce(),
  deadline: String(now() + 600),
  signature: `0x${"ab".repeat(65)}`,
  deposit: { validAfter: "0", validBefore: String(now() + 600), nonce: randomNonce(), signature: `0x${"cd".repeat(65)}` },
});

describe("relayEmailPayment", () => {
  it.each([
    ["a bad payer address", { platform: "0x1234" }, /account isn't ready/],
    ["more than one person", { claimSigners: [from, to], amounts: ["1", "1"], emailHashes: [randomNonce(), randomNonce()] }, /Something's off/],
    ["no email", { emailHashes: [`0x${"00".repeat(32)}`] }, /Something's off/],
    ["a zero amount", { amounts: ["0"] }, /amount to send/],
    ["mismatched rows", { amounts: [] }, /Something's off/],
    ["a malformed payout signature", { signature: "0xabc" }, /Something's off/],
    ["a payout authorization valid for too long", { deadline: String(now() + 24 * 3600) }, /took too long/],
    ["an expired deposit authorization", { deposit: { validAfter: "0", validBefore: String(now() + 5), nonce: randomNonce(), signature: `0x${"cd".repeat(65)}` } }, /took too long/],
  ])("refuses %s before spending anything", async (_, override, message) => {
    const err = await relayEmailPayment({ body: { ...validPayment(), ...override }, accessToken: "token" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClaimRefused);
    expect((err as Error).message).toMatch(message);
  });

  it("needs a signed-in session", async () => {
    await expect(relayEmailPayment({ body: validPayment(), accessToken: null })).rejects.toThrow(/Sign in/);
  });

  it("says so, without trying, when it can't run here (relayer not set up, or contracts before v3)", async () => {
    vi.stubEnv("RELAYER_PRIVATE_KEY", "");
    expect(relayEmailPaymentConfigured()).toBe(false);
    await expect(relayEmailPayment({ body: validPayment(), accessToken: "token" })).rejects.toBeInstanceOf(RelayUnavailable);
    expect(await getPayEmail().json()).toEqual({ available: false });
  });
});

describe("relaySend", () => {
  it.each([
    ["a bad payee address", { from: "0x1234" }, /account isn't ready/],
    ["a bad recipient", { to: "nope" }, /address isn't valid/],
    ["the empty address", { to: "0x0000000000000000000000000000000000000000" }, /address isn't valid/],
    ["sending to yourself", { to: from }, /your own address/],
    ["a zero amount", { value: "0" }, /amount to send/],
    ["a non-integer amount", { value: "1.5" }, /amount to send/],
    ["a short nonce", { nonce: "0x1234" }, /Something's off/],
    ["a malformed signature", { signature: "0xabc" }, /Something's off/],
    ["no session", { accessToken: null }, /Sign in to send/],
    ["an expired authorization", { validBefore: String(now() + 5) }, /took too long/],
    ["an authorization valid for too long", { validBefore: String(now() + 24 * 3600) }, /took too long/],
    ["an authorization not valid yet", { validAfter: String(now() + 300) }, /Something's off/],
  ])("refuses %s before spending anything", async (_, override, message) => {
    const err = await relaySend({ ...valid(), ...override }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClaimRefused);
    expect((err as Error).message).toMatch(message);
  });

  it("says so, without trying, when the relayer isn't set up", async () => {
    vi.stubEnv("RELAYER_PRIVATE_KEY", "");
    await expect(relaySend(valid())).rejects.toBeInstanceOf(RelayUnavailable);
  });

  it("reports whether it can send, so the client knows before the payee signs", async () => {
    vi.stubEnv("RELAYER_PRIVATE_KEY", "");
    expect(relaySendConfigured()).toBe(false);
    expect(await GET().json()).toEqual({ available: false });
  });
});
