import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/relay/send/route";
import { randomNonce } from "./erc3009";
import { ClaimRefused, relaySend, relaySendConfigured, RelayUnavailable } from "./relayer";

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
