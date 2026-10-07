/**
 * End-to-end test of the onchain client + relayer against the v3 payout contracts and the real
 * Agora AUSD, on a local fork of Monad testnet (no real funds). The v3 contracts are deployed to
 * the fork from smart-contract/artifacts (run `pnpm --filter smart-contract build` first).
 * Skipped unless FANOUT_FORK_RPC is set:
 *
 *   anvil --fork-url https://testnet-rpc.monad.xyz --chain-id 10143 --port 8545
 *   FANOUT_FORK_RPC=http://127.0.0.1:8545 pnpm --filter web test onchain-v3.int
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeFunctionData, http, numberToHex, parseEther, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it, vi } from "vitest";

const RPC = process.env.FANOUT_FORK_RPC;
const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as Address;
const VERIFIER = "0x5A115F0E14232D658763b8683B6c0da9fBBe5549" as Address;
const usd = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n; // 6 decimals

// The relayer checks the Privy session; here any token is a signed-in user.
vi.mock("@/lib/auth/privy-server", () => ({
  SessionExpired: class SessionExpired extends Error {},
  privyClient: () => ({}),
  verifiedUser: async () => ({ wallets: new Set(), emailHashes: new Set() }),
}));

// Route handlers run outside a Next request here, where `after` (log flushing) isn't available.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => {} }));

const artifact = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../../smart-contract/artifacts/contracts/${name}.sol/${name}.json`, import.meta.url), "utf8")) as {
    abi: Abi;
    bytecode: Hex;
  };

describe.skipIf(!RPC)("onchain client with the v3 contracts on a Monad testnet fork", () => {
  const platformKey = generatePrivateKey();
  const payerKey = generatePrivateKey();
  const relayerKey = generatePrivateKey();
  const platform = privateKeyToAccount(platformKey);
  const payer = privateKeyToAccount(payerKey);

  let mod: {
    chain: typeof import("@/lib/chains");
    client: typeof import("./onchain-client");
    payEmail: typeof import("@/app/api/relay/pay-email/route");
    config: typeof import("@/lib/config");
  };
  const pub = createPublicClient({ transport: http(RPC ?? "http://127.0.0.1:8545") });
  const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });

  /** Gives `who` AUSD by writing its balance slot (found by tracing balanceOf; value is packed << 8). */
  async function dealAusd(who: Address, amount: bigint) {
    const data = encodeFunctionData({ abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [who] });
    const trace = (await rpc("debug_traceCall", [{ to: AUSD, data }, "latest", {}])) as { structLogs: { op: string; stack: string[] }[] };
    const slots = trace.structLogs.filter((l) => l.op === "SLOAD").map((l) => l.stack[l.stack.length - 1]);
    await rpc("anvil_setStorageAt", [AUSD, slots[slots.length - 1], numberToHex(amount << 8n, { size: 32 })]);
  }

  beforeAll(async () => {
    // Deploy and wire Treasury, ClaimEscrow and BatchPayout v3 on the fork, as Ignition's Fanout module does.
    const deployer = createWalletClient({ account: platform, transport: http(RPC) });
    await rpc("anvil_setBalance", [platform.address, numberToHex(parseEther("10"))]);
    await rpc("anvil_setBalance", [privateKeyToAccount(relayerKey).address, numberToHex(parseEther("10"))]);
    const deploy = async (name: string, args: unknown[]) => {
      const { abi, bytecode } = artifact(name);
      const hash = await deployer.deployContract({ abi, bytecode, args, chain: null });
      return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
    };
    const send = async (address: Address, name: string, fn: string, args: unknown[]) =>
      pub.waitForTransactionReceipt({ hash: await deployer.writeContract({ address, abi: artifact(name).abi, functionName: fn, args, chain: null }) });
    const treasury = await deploy("Treasury", [AUSD]);
    const escrow = await deploy("ClaimEscrow", [AUSD, treasury, VERIFIER]);
    const batchPayout = await deploy("BatchPayout", [treasury, escrow, 1001n]);
    await send(treasury, "Treasury", "wire", [batchPayout, escrow]);
    await send(escrow, "ClaimEscrow", "wire", [batchPayout]);

    process.env.NEXT_PUBLIC_RPC_URL = RPC;
    process.env.NEXT_PUBLIC_INDEXER_URL = "off";
    process.env.NEXT_PUBLIC_TREASURY_ADDRESS = treasury;
    process.env.NEXT_PUBLIC_BATCH_PAYOUT_ADDRESS = batchPayout;
    process.env.NEXT_PUBLIC_CLAIM_ESCROW_ADDRESS = escrow;
    process.env.NEXT_PUBLIC_PAYOUT_CONTRACTS = "v3";
    process.env.RELAYER_PRIVATE_KEY = relayerKey;
    mod = {
      chain: await import("@/lib/chains"),
      client: await import("./onchain-client"),
      payEmail: await import("@/app/api/relay/pay-email/route"),
      config: await import("@/lib/config"),
    };
    await dealAusd(platform.address, usd(1000));
    await dealAusd(payer.address, usd(100));

    // The client calls /api/relay/pay-email; route that to the real handler.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/relay/pay-email") {
        return init?.method === "POST" ? mod.payEmail.POST(new Request("http://localhost/api/relay/pay-email", init)) : mod.payEmail.GET();
      }
      return realFetch(input, init);
    }) as typeof fetch;
  }, 120_000);

  const clientFor = (key: Hex) => {
    const account = privateKeyToAccount(key);
    const walletClient = createWalletClient({ account, chain: mod.chain.activeChain, transport: http(RPC) });
    return mod.client.createOnchainClient({ account: account.address, walletClient, getAccessToken: async () => "token" });
  };
  const claimSigner = () => privateKeyToAccount(generatePrivateKey()).address;
  const emailHash = `0x${"e1".repeat(32)}` as Hex;

  it("is in v3 mode", () => {
    expect(mod.config.config.payoutsV3).toBe(true);
  });

  it("pays by email from an account with no MON: the relayer submits one transaction", async () => {
    expect(await pub.getBalance({ address: payer.address })).toBe(0n);
    const c = clientFor(payerKey);
    const res = await c.payFromAccount([{ claimSigner: claimSigner(), amount: usd(30), emailHash }], { claimWindowSeconds: 600 });
    expect(res.gasless).toBe(true);
    expect(Number(res.batchId)).toBeGreaterThanOrEqual(1001);
    expect(await pub.getBalance({ address: payer.address })).toBe(0n);
    expect(await c.getPayeeBalance(payer.address)).toBe(usd(70));
    expect(await c.getTreasuryBalance(payer.address)).toBe(0n);

    const batch = await c.getBatch(res.batchId);
    expect(batch.total).toBe(usd(30));
    const now = Number((await pub.getBlock()).timestamp) * 1000;
    expect(batch.expiresAt).toBeGreaterThan(now + 590_000);
    expect(batch.expiresAt).toBeLessThanOrEqual(now + 600_000);
  }, 120_000);

  it("a platform picks a short claim window, and returns the unclaimed money once it passes", async () => {
    const c = clientFor(platformKey);
    await c.deposit(usd(500));
    const { batchId } = await c.createBatchPayout(
      [
        { claimSigner: claimSigner(), amount: usd(100) },
        { claimSigner: claimSigner(), amount: usd(50) },
      ],
      { claimWindowSeconds: 300 },
    );
    expect(await c.getTreasuryBalance(platform.address)).toBe(usd(350));
    await expect(c.refundExpired(batchId)).rejects.toThrow(/still work/);

    await rpc("evm_increaseTime", [301]);
    await rpc("evm_mine", []);
    const { refunded } = await c.refundExpired(batchId);
    expect(refunded).toBe(2);
    expect(await c.getTreasuryBalance(platform.address)).toBe(usd(500));
    expect((await c.getBatch(batchId)).rows.map((r) => r.status)).toEqual(["refunded", "refunded"]);
  }, 120_000);

  it("rejects a claim window the contract doesn't allow, in plain words", async () => {
    const c = clientFor(platformKey);
    await expect(c.createBatchPayout([{ claimSigner: claimSigner(), amount: usd(1) }], { claimWindowSeconds: 60 })).rejects.toThrow(/5 minutes/);
  }, 120_000);
});
