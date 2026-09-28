/**
 * End-to-end test of the onchain client + relayer against the DEPLOYED contracts, on a local
 * fork of Monad testnet (no real funds). Skipped unless FANOUT_FORK_RPC is set:
 *
 *   anvil --fork-url https://testnet-rpc.monad.xyz --chain-id 10143 --port 8545
 *   FANOUT_FORK_RPC=http://127.0.0.1:8545 pnpm --filter web test onchain.int
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  numberToHex,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";

const RPC = process.env.FANOUT_FORK_RPC;
const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as Address;
const usd = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n; // 6 decimals

describe.skipIf(!RPC)("onchain client on a Monad testnet fork", () => {
  const platformKey = generatePrivateKey();
  const payeeKey = generatePrivateKey();
  const relayerKey = generatePrivateKey();
  const platform = privateKeyToAccount(platformKey);
  const payee = privateKeyToAccount(payeeKey);
  const friend = privateKeyToAccount(generatePrivateKey()).address;

  let mod: {
    chain: typeof import("@/lib/chains");
    client: typeof import("./onchain-client");
    keys: typeof import("./claim-keys");
    route: typeof import("@/app/api/relay/claim/route");
    config: typeof import("@/lib/config");
  };
  // Placeholder URL only so the module loads when the suite is skipped (no fork running).
  const pub = createPublicClient({ transport: http(RPC ?? "http://127.0.0.1:8545") });
  const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });

  /** Gives `who` AUSD by writing its balance slot (found by tracing balanceOf; value is packed << 8). */
  async function dealAusd(who: Address, amount: bigint) {
    const data = encodeFunctionData({ abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [who] });
    const trace = (await rpc("debug_traceCall", [{ to: AUSD, data }, "latest", {}])) as { structLogs: { op: string; stack: string[] }[] };
    const slots = trace.structLogs.filter((l) => l.op === "SLOAD").map((l) => l.stack[l.stack.length - 1]);
    const slot = slots[slots.length - 1];
    await rpc("anvil_setStorageAt", [AUSD, slot, numberToHex(amount << 8n, { size: 32 })]);
  }

  const ausdOf = async (who: Address) =>
    pub.readContract({ address: AUSD, abi: (await import("./abis")).erc20Abi, functionName: "balanceOf", args: [who] });

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_RPC_URL = RPC;
    process.env.RELAYER_PRIVATE_KEY = relayerKey;
    mod = {
      chain: await import("@/lib/chains"),
      client: await import("./onchain-client"),
      keys: await import("./claim-keys"),
      route: await import("@/app/api/relay/claim/route"),
      config: await import("@/lib/config"),
    };
    await rpc("anvil_setBalance", [platform.address, numberToHex(parseEther("10"))]);
    await rpc("anvil_setBalance", [privateKeyToAccount(relayerKey).address, numberToHex(parseEther("10"))]);
    await dealAusd(platform.address, usd(1000));

    // The client posts claims to /api/relay/claim; route that to the real handler.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/relay/claim") return mod.route.POST(new Request("http://localhost/api/relay/claim", init));
      return realFetch(input, init);
    }) as typeof fetch;
  }, 60_000);

  const clientFor = (key: Hex) => {
    const account = privateKeyToAccount(key);
    const walletClient = createWalletClient({ account, chain: mod.chain.activeChain, transport: http(RPC) });
    return mod.client.createOnchainClient({ account: account.address, walletClient });
  };

  let batchId = "";
  const claimKeys = Array.from({ length: 3 }, generateKey);
  function generateKey() {
    const privateKey = generatePrivateKey();
    return { privateKey, claimSigner: privateKeyToAccount(privateKey).address };
  }

  it("deposits AUSD into the payout balance (approve + deposit)", async () => {
    const c = clientFor(platformKey);
    const before = await c.getTreasuryBalance(platform.address);
    await c.deposit(usd(500));
    expect(await c.getTreasuryBalance(platform.address)).toBe(before + usd(500));
    expect(await ausdOf(platform.address)).toBe(usd(500));
  }, 60_000);

  it("creates a batch in one transaction and reads it back", async () => {
    const c = clientFor(platformKey);
    const amounts = [usd(100), usd(150), usd(50)];
    const res = await c.createBatchPayout(claimKeys.map((k, i) => ({ claimSigner: k.claimSigner, amount: amounts[i] })));
    batchId = res.batchId;
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const batch = await c.getBatch(batchId);
    expect(batch.total).toBe(usd(300));
    expect(batch.rows.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
    const listed = (await c.listBatches(platform.address)).find((b) => b.id === batchId);
    expect(listed).toMatchObject({ rowCount: 3, claimedCount: 0, total: usd(300) });
    expect(await c.getTreasuryBalance(platform.address)).toBe(usd(200));
    expect(await c.getClaim(claimKeys[0].claimSigner)).toMatchObject({ amount: usd(100), status: "sent" });
  }, 60_000);

  it("claims through the relayer: payee gets AUSD and a MON top-up, pays no gas", async () => {
    const c = clientFor(payeeKey);
    const escrow = mod.config.config.contracts.claimEscrow;
    const sig = await mod.keys.signClaim(claimKeys[0].privateKey, { recipient: payee.address, claimContract: escrow, chainId: 10143 });
    await c.claim(claimKeys[0].claimSigner, payee.address, sig);
    expect(await c.getPayeeBalance(payee.address)).toBe(usd(100));
    expect(await pub.getBalance({ address: payee.address })).toBe(parseEther("0.02"));
    expect((await c.getBatch(batchId)).rows[0].status).toBe("claimed");
  }, 60_000);

  it("refuses a second claim and a front-run (signature for someone else)", async () => {
    const c = clientFor(payeeKey);
    const escrow = mod.config.config.contracts.claimEscrow;
    const again = await mod.keys.signClaim(claimKeys[0].privateKey, { recipient: payee.address, claimContract: escrow, chainId: 10143 });
    await expect(c.claim(claimKeys[0].claimSigner, payee.address, again)).rejects.toThrow(/already been claimed or returned/);
    const forFriend = await mod.keys.signClaim(claimKeys[1].privateKey, { recipient: friend, claimContract: escrow, chainId: 10143 });
    await expect(c.claim(claimKeys[1].claimSigner, payee.address, forFriend)).rejects.toThrow(/isn't valid/);
    expect((await c.getBatch(batchId)).rows[1].status).toBe("sent");
  }, 60_000);

  it("lets the payee send on with the topped-up MON", async () => {
    const c = clientFor(payeeKey);
    await c.send(friend, usd(40));
    expect(await c.getPayeeBalance(payee.address)).toBe(usd(60));
    expect(await c.getPayeeBalance(friend)).toBe(usd(40));
  }, 60_000);

  it("explains shortfalls in plain words", async () => {
    const c = clientFor(platformKey);
    await expect(c.deposit(usd(10_000))).rejects.toThrow(/Your account holds \$500\.00 in AUSD/);
    await expect(c.createBatchPayout([{ claimSigner: generateKey().claimSigner, amount: usd(5000) }])).rejects.toThrow(/Not enough in your payout balance/);
    await expect(c.getBatch("999999")).rejects.toThrow(/doesn't exist/);
  }, 60_000);
});
