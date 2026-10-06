import { ContractFunctionRevertedError, getAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/relay/test-dollars/route";
import { SessionExpired } from "@/lib/auth/privy-server";
import { agoraFaucetAbi } from "./abis";
import { ClaimRefused, RelayUnavailable } from "./relayer";
import { TEST_DOLLARS_CHAIN_ID, TEST_DOLLARS_COOLDOWN_MS } from "./test-dollars";
import { faucetError, relayTestDollars, resetTestDollarLimits, TestDollarsLimited, type TestDollarsDeps } from "./test-dollars-relay";

// Route handlers flush logs after responding; tests have no request scope for that.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));

const me = privateKeyToAccount(generatePrivateKey()).address;
const someoneElse = privateKeyToAccount(generatePrivateKey()).address;
const T0 = 1_800_000_000_000;
const DRIP = 10_000_000_000n; // $10,000, what Agora's faucet sends per request

function fakeDeps(over: Partial<TestDollarsDeps> = {}) {
  const deps = {
    configured: () => true,
    rpcChainId: vi.fn(async () => TEST_DOLLARS_CHAIN_ID),
    ownAccounts: vi.fn(async () => new Set<Address>([me])),
    requestFunds: vi.fn(async () => ({ txHash: `0x${"12".repeat(32)}` as const, amount: DRIP })),
    topUp: vi.fn(async () => true),
    ...over,
  };
  return deps;
}

const ask = (deps: TestDollarsDeps, over: { address?: unknown; accessToken?: string | null; ip?: string; now?: number } = {}) =>
  relayTestDollars({ address: me, accessToken: "token", ip: "203.0.113.1", now: T0, ...over }, deps);

beforeEach(() => resetTestDollarLimits());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/chains");
  vi.resetModules();
});

describe("relayTestDollars", () => {
  it("asks the faucet for the signed-in user's own account and tops up fees", async () => {
    const deps = fakeDeps();
    const result = await ask(deps, { address: me.toLowerCase() });
    expect(result).toEqual({ txHash: `0x${"12".repeat(32)}`, amount: DRIP, toppedUp: true });
    expect(deps.requestFunds).toHaveBeenCalledWith(getAddress(me));
    expect(deps.topUp).toHaveBeenCalledWith(getAddress(me));
  });

  it("refuses without a session, before looking anyone up", async () => {
    const deps = fakeDeps();
    await expect(ask(deps, { accessToken: null })).rejects.toThrow(/Sign in/);
    expect(deps.ownAccounts).not.toHaveBeenCalled();
    expect(deps.requestFunds).not.toHaveBeenCalled();
  });

  it("refuses a malformed address", async () => {
    await expect(ask(fakeDeps(), { address: "0x1234" })).rejects.toBeInstanceOf(ClaimRefused);
  });

  it("only sends to an account the signed-in user owns", async () => {
    const deps = fakeDeps();
    const err = await ask(deps, { address: someoneElse }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClaimRefused);
    expect((err as Error).message).toMatch(/your own account/);
    expect(deps.requestFunds).not.toHaveBeenCalled();
  });

  it("passes on an expired session", async () => {
    const deps = fakeDeps({ ownAccounts: vi.fn(async () => Promise.reject(new SessionExpired("Your session has expired."))) });
    await expect(ask(deps)).rejects.toBeInstanceOf(SessionExpired);
    expect(deps.requestFunds).not.toHaveBeenCalled();
  });

  it("gives each account test dollars once per day", async () => {
    const deps = fakeDeps();
    await ask(deps);
    const err = await ask(deps, { now: T0 + TEST_DOLLARS_COOLDOWN_MS - 1, ip: "203.0.113.2" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TestDollarsLimited);
    expect((err as TestDollarsLimited).retryAt).toBe(T0 + TEST_DOLLARS_COOLDOWN_MS);
    expect(deps.requestFunds).toHaveBeenCalledTimes(1);

    await ask(deps, { now: T0 + TEST_DOLLARS_COOLDOWN_MS, ip: "203.0.113.3" });
    expect(deps.requestFunds).toHaveBeenCalledTimes(2);
  });

  it("holds the account's slot while a request is in flight, and frees it if the request fails", async () => {
    let finish: () => void = () => {};
    const slow = fakeDeps({
      requestFunds: vi.fn(
        () => new Promise<{ txHash: `0x${string}`; amount: bigint }>((resolve, reject) => (finish = () => reject(new Error("Getting test dollars failed.")))),
      ),
    });
    const first = ask(slow);
    await vi.waitFor(() => expect(slow.requestFunds).toHaveBeenCalled());
    await expect(ask(slow)).rejects.toBeInstanceOf(TestDollarsLimited);
    finish();
    await expect(first).rejects.toThrow(/failed/);

    const deps = fakeDeps();
    await expect(ask(deps)).resolves.toMatchObject({ amount: DRIP });
  });

  it("limits attempts per IP, whichever account they're for", async () => {
    const deps = fakeDeps({ ownAccounts: vi.fn(async () => new Set<Address>()) });
    for (let i = 0; i < 5; i++) await expect(ask(deps, { ip: "198.51.100.7", now: T0 + i })).rejects.toThrow(/your own account/);
    const err = await ask(deps, { ip: "198.51.100.7", now: T0 + 10 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TestDollarsLimited);
    expect((err as TestDollarsLimited).retryAt).toBe(T0 + 60 * 60_000);
    // A different IP is unaffected, and the window slides.
    await expect(ask(fakeDeps(), { ip: "198.51.100.8" })).resolves.toMatchObject({ amount: DRIP });
    const other = fakeDeps({ ownAccounts: vi.fn(async () => new Set<Address>([someoneElse])) });
    await expect(ask(other, { ip: "198.51.100.7", now: T0 + 60 * 60_000 + 11, address: someoneElse })).resolves.toMatchObject({ amount: DRIP });
  });

  it("never runs if the RPC isn't Monad testnet", async () => {
    const deps = fakeDeps({ rpcChainId: vi.fn(async () => 143) });
    await expect(ask(deps)).rejects.toThrow(/aren't available here/);
    expect(deps.requestFunds).not.toHaveBeenCalled();
    // A refused attempt doesn't use up the account's day.
    await expect(ask(fakeDeps())).resolves.toMatchObject({ amount: DRIP });
  });

  it("never runs when the app is set up for another chain", async () => {
    vi.resetModules();
    vi.doMock("@/lib/chains", async (orig) => ({ ...(await orig<typeof import("@/lib/chains")>()), activeChain: { id: 143 } }));
    const { relayTestDollars: onMainnet } = await import("./test-dollars-relay");
    const deps = fakeDeps();
    await expect(onMainnet({ address: me, accessToken: "token", ip: "203.0.113.9" }, deps)).rejects.toThrow(/aren't available here/);
    expect(deps.ownAccounts).not.toHaveBeenCalled();
    expect(deps.requestFunds).not.toHaveBeenCalled();
  });

  it("says so, without trying, when the relayer isn't set up", async () => {
    const deps = fakeDeps({ configured: () => false });
    await expect(ask(deps)).rejects.toBeInstanceOf(RelayUnavailable);
    expect(deps.requestFunds).not.toHaveBeenCalled();
  });
});

describe("faucetError", () => {
  const revert = (data: `0x${string}`) => new ContractFunctionRevertedError({ abi: agoraFaucetAbi, data, functionName: "requestFunds" });

  it("turns the faucet's one-a-minute limit into a short wait", () => {
    const err = faucetError(revert("0x20e5bc67"), T0); // MaxFrequencyExceeded()
    expect(err).toBeInstanceOf(TestDollarsLimited);
    expect((err as TestDollarsLimited).retryAt).toBe(T0 + 60_000);
  });

  it("explains an account that already holds the most the faucet allows", () => {
    const err = faucetError(revert("0x0949dab9")); // MaxAllowedExceeded()
    expect(err).toBeInstanceOf(ClaimRefused);
    expect(err.message).toMatch(/plenty of test dollars/);
  });
});

describe("POST /api/relay/test-dollars", () => {
  it("wants a session", async () => {
    const res = await POST(new Request("http://localhost/api/relay/test-dollars", { method: "POST", body: JSON.stringify({ address: me }) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Sign in to get test dollars." });
  });

  it("rejects a body that isn't JSON", async () => {
    const res = await POST(new Request("http://localhost/api/relay/test-dollars", { method: "POST", body: "nope" }));
    expect(res.status).toBe(400);
  });
});
