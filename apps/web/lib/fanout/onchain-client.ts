import {
  createPublicClient,
  http,
  parseEventLogs,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { activeChain } from "@/lib/chains";
import { config } from "@/lib/config";
import { batchPayoutAbi, claimEscrowAbi, erc20Abi, treasuryAbi } from "./abis";
import type { FanoutClient, FanoutClientContext } from "./client";
import { NotFoundError, type PayoutStatus } from "./types";

/**
 * viem implementation against the deployed contracts (ABIs in ./abis).
 * Enable with NEXT_PUBLIC_USE_MOCK=false.
 */

const STATUS: readonly PayoutStatus[] = ["sent", "claimed", "refunded"];
/** How many of the newest batches listBatches scans (across all platforms) without an indexer. */
const LIST_SCAN_LIMIT = 200;

let publicClient: PublicClient | null = null;
function reader(): PublicClient {
  return (publicClient ??= createPublicClient({ chain: activeChain, transport: http() }));
}

function need<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`${name} is not configured. Set it in .env.local.`);
  return value;
}

export function createOnchainClient(ctx: FanoutClientContext): FanoutClient {
  const addr = {
    token: () => need(config.stablecoin.address, "NEXT_PUBLIC_AUSD_ADDRESS"),
    treasury: () => need(config.contracts.treasury, "NEXT_PUBLIC_TREASURY_ADDRESS"),
    batchPayout: () => need(config.contracts.batchPayout, "NEXT_PUBLIC_BATCH_PAYOUT_ADDRESS"),
    claimEscrow: () => need(config.contracts.claimEscrow, "NEXT_PUBLIC_CLAIM_ESCROW_ADDRESS"),
  };

  function writer() {
    const wc = ctx.walletClient;
    const account = wc?.account ?? ctx.account;
    if (!wc || !account) throw new Error("Sign in first.");
    return { wc, account };
  }

  async function write(
    request: Parameters<NonNullable<FanoutClientContext["walletClient"]>["writeContract"]>[0],
  ): Promise<Hex> {
    const { wc } = writer();
    const hash = await wc.writeContract(request);
    const receipt = await reader().waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Transaction failed.");
    return hash;
  }

  const client: FanoutClient = {
    async getTreasuryBalance(platform) {
      return reader().readContract({ address: addr.treasury(), abi: treasuryAbi, functionName: "balanceOf", args: [platform] });
    },

    async deposit(amount) {
      const { account } = writer();
      await write({ account, chain: activeChain, address: addr.token(), abi: erc20Abi, functionName: "approve", args: [addr.treasury(), amount] });
      const txHash = await write({ account, chain: activeChain, address: addr.treasury(), abi: treasuryAbi, functionName: "deposit", args: [amount] });
      return { txHash };
    },

    async createBatchPayout(rows) {
      const { wc, account } = writer();
      const hash = await wc.writeContract({
        account,
        chain: activeChain,
        address: addr.batchPayout(),
        abi: batchPayoutAbi,
        functionName: "createBatch",
        args: [rows.map((r) => r.claimSigner), rows.map((r) => r.amount), rows.map((r) => r.emailHash ?? zeroHash)],
      });
      const receipt = await reader().waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction failed.");
      const [event] = parseEventLogs({ abi: batchPayoutAbi, eventName: "BatchCreated", logs: receipt.logs });
      if (!event) throw new Error("Payout sent but no BatchCreated event found.");
      return { batchId: event.args.batchId.toString(), txHash: hash };
    },

    async getBatch(batchId) {
      const [platform, createdAt, total, signers] = await reader().readContract({
        address: addr.batchPayout(),
        abi: batchPayoutAbi,
        functionName: "getBatch",
        args: [BigInt(batchId)],
      });
      if (platform === zeroAddress) throw new NotFoundError(`Payout #${batchId} doesn't exist.`);
      const claims = await reader().multicall({
        allowFailure: false,
        contracts: signers.map((s) => ({ address: addr.claimEscrow(), abi: claimEscrowAbi, functionName: "getClaim" as const, args: [s] as const })),
      });
      // TODO(indexer): the creating tx hash isn't stored onchain; read it from BatchCreated via Envio.
      const txHash = zeroHash;
      return {
        id: batchId,
        createdAt: Number(createdAt) * 1000,
        total,
        txHash,
        rows: signers.map((claimSigner, i) => {
          const [amount, , status, emailHash] = claims[i];
          return { claimSigner, amount, status: STATUS[status], emailHash: emailHash === zeroHash ? undefined : emailHash };
        }),
      };
    },

    async getClaim(claimSigner) {
      const [amount, platform, status] = await reader().readContract({
        address: addr.claimEscrow(),
        abi: claimEscrowAbi,
        functionName: "getClaim",
        args: [claimSigner],
      });
      if (amount === 0n) throw new NotFoundError("This payment link isn't valid.");
      return { amount, platform, status: STATUS[status] };
    },

    async claim(claimSigner, recipient, signature) {
      // The payee's new wallet holds no MON, so our relayer submits the claim and pays the gas
      // (app/api/claim). It also checks the claimer's email via their session token before co-signing.
      const accessToken = await ctx.getAccessToken?.();
      if (!accessToken) throw new Error("Sign in to claim this payment.");
      let res: Response;
      try {
        res = await fetch("/api/claim", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ claimSigner, recipient, signature }),
        });
      } catch {
        throw new Error("Couldn't reach the server. Check your connection.");
      }
      const data = (await res.json().catch(() => ({}))) as { txHash?: Hex; error?: string };
      if (res.status === 404) throw new NotFoundError(data.error ?? "This payment link isn't valid.");
      if (!res.ok || !data.txHash) throw new Error(data.error ?? "Something went wrong and nothing was claimed.");
      return { txHash: data.txHash };
    },

    async getPayeeBalance(address) {
      return reader().readContract({ address: addr.token(), abi: erc20Abi, functionName: "balanceOf", args: [address] });
    },

    async send(to: Address, amount: bigint) {
      // TODO(gas): same gas problem as claim.
      const { account } = writer();
      const txHash = await write({ account, chain: activeChain, address: addr.token(), abi: erc20Abi, functionName: "transfer", args: [to, amount] });
      return { txHash };
    },

    // Stopgap until the indexer: scan the newest batches onchain and keep the platform's own.
    async listBatches(platform) {
      const next = await reader().readContract({ address: addr.batchPayout(), abi: batchPayoutAbi, functionName: "nextBatchId" });
      const ids: bigint[] = [];
      for (let id = next - 1n; id >= 1n && ids.length < LIST_SCAN_LIMIT; id--) ids.push(id);
      const headers = await reader().multicall({
        allowFailure: false,
        contracts: ids.map((id) => ({ address: addr.batchPayout(), abi: batchPayoutAbi, functionName: "getBatch" as const, args: [id] as const })),
      });
      const mine = ids.filter((_, i) => headers[i][0].toLowerCase() === platform.toLowerCase());
      const batches = await Promise.all(mine.map((id) => client.getBatch(id.toString())));
      return batches.map((b) => ({
        id: b.id,
        createdAt: b.createdAt,
        total: b.total,
        txHash: b.txHash,
        rowCount: b.rows.length,
        claimedCount: b.rows.filter((r) => r.status === "claimed").length,
      }));
    },

    async getPayeeHistory() {
      throw new Error("Wallet history isn't available onchain yet (needs the indexer).");
    },
  };
  return client;
}
