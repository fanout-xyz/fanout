import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  formatUnits,
  http,
  parseEventLogs,
  UserRejectedRequestError,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { activeChain, monFaucetUrl } from "@/lib/chains";
import { config } from "@/lib/config";
import { MAX_ROWS } from "@/lib/csv";
import { agoraPairAbi, batchPayoutAbi, claimEscrowAbi, eip712DomainAbi, erc20Abi, treasuryAbi } from "./abis";
import type { FanoutClient, FanoutClientContext } from "./client";
import { indexedBatches, indexedBatchTx, indexedPayeeHistory, indexerEnabled, mergeHistory } from "./indexer";
import { recallActivity, recallBatchTx, rememberActivity, rememberBatchTx } from "./local-records";
import { NotFoundError, type BatchSummary, type PayoutStatus } from "./types";
import { AUTHORIZATION_WINDOW_SECONDS, randomNonce, signAuthorization, type TokenDomain } from "./erc3009";
import { minOutFor, randomSalt, SETTLE_WINDOW_SECONDS, signSettle } from "./usdc-settle";

/**
 * FanoutClient against the deployed contracts (Treasury, BatchPayout, ClaimEscrow on Monad testnet).
 * Platform writes are signed by the signed-in account (Privy embedded wallet, via wagmi).
 * Claims go through our relayer (/api/relay/claim), which pays gas: the signature binds the
 * recipient, so anyone may submit it.
 */

const STATUS: readonly PayoutStatus[] = ["sent", "claimed", "refunded"];

/**
 * Every custom error from all three contracts. They call into each other (BatchPayout ->
 * Treasury.debit, ClaimEscrow.open), so a revert can come from a contract other than the one
 * called; adding all errors to each simulation lets viem decode it by name.
 */
export const ALL_CONTRACT_ERRORS = [...treasuryAbi, ...batchPayoutAbi, ...claimEscrowAbi].filter((x) => x.type === "error");
/** How many recent batches the dashboard scans when the indexer is unavailable (there's no per-platform view onchain). */
const LIST_SCAN_LIMIT = 200;

let publicClient: PublicClient | null = null;
export function reader(): PublicClient {
  return (publicClient ??= createPublicClient({ chain: activeChain, transport: http() }));
}

const usd = (amount: bigint) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(formatUnits(amount, config.stablecoin.decimals)));

/** Contract error name -> what to tell the person. */
const REVERT_MESSAGES: Record<string, string> = {
  InsufficientBalance: "Not enough in your payout balance for this.",
  TooManyRows: `A payout can have at most ${MAX_ROWS} people. Split the file.`,
  EmptyBatch: "A payout needs at least one person.",
  LengthMismatch: "Something's off with this payout's rows. Re-upload the file.",
  ClaimSignerUsed: "One of these claim links was already used. Start the payout again.",
  ZeroAmount: "Every amount must be more than $0.00.",
  ZeroAddress: "An address in this request is empty.",
  UnknownClaim: "This payment link isn't valid.",
  NotClaimable: "This payment has already been claimed or returned.",
  BadSignature: "This payment link isn't valid.",
  NotExpired: "This payment hasn't expired yet.",
  Unauthorized: "This account isn't allowed to do that.",
  // Agora's stable-swap pair, when changing dollars to USDC. Nothing moves when these happen.
  InsufficientOutputAmount: "The USDC rate moved. Nothing changed. Try again.",
  Expired: "That took too long. Nothing changed. Try again.",
  PriceExpired: "USDC isn't available right now. Nothing changed. Try again later.",
  PairIsPaused: "USDC isn't available right now. Nothing changed. Try again later.",
  InsufficientLiquidity: "There isn't enough USDC available right now. Try a smaller amount.",
  AddressIsNotRole: "USDC isn't available right now. Nothing changed. Try again later.",
  // AUSD, when a signed send or change to USDC is submitted for the payee. Nothing moves when these happen.
  UsedOrCanceledAuthorization: "This was already sent. Check your activity before trying again.",
  ExpiredAuthorization: "That took too long. Nothing was sent. Try again.",
  InvalidAuthorization: "Something's off with this request. Nothing was sent. Try again.",
  InvalidSignature: "Something's off with this request. Nothing was sent. Try again.",
  ERC20InsufficientBalance: "You don't have enough for that. Nothing was sent.",
};

/** Turns wallet/chain errors into plain sentences; keeps NotFoundError as is. */
export function friendlyChainError(err: unknown): Error {
  if (err instanceof NotFoundError) return err;
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return new Error("You cancelled the request. Nothing was sent.");
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "";
      if (name === "UnknownClaim" || name === "BadSignature") return new NotFoundError(REVERT_MESSAGES[name]);
      if (REVERT_MESSAGES[name]) return new Error(REVERT_MESSAGES[name]);
    }
    if (/insufficient funds/i.test(err.message)) {
      return new Error(`Your account needs a little MON for network fees. Get test MON at ${monFaucetUrl}.`);
    }
    return new Error(err.shortMessage || "The network request failed. Try again.");
  }
  return err instanceof Error ? err : new Error("Something went wrong. Try again.");
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw friendlyChainError(err);
  }
}

/** Config addresses are optional overrides; fail clearly if one is missing. */
export function need(value: Address | undefined, name: string): Address {
  if (!value) throw new Error(`${name} is not configured. Set it in apps/web/.env.local (see .env.example).`);
  return value;
}

/** Whether this server's relayer can send for payees (GET /api/relay/send). Asked once per page load. */
let relaySendCheck: Promise<boolean> | null = null;
function relaySendAvailable(): Promise<boolean> {
  return (relaySendCheck ??= fetch("/api/relay/send")
    .then(async (res) => res.ok && ((await res.json()) as { available?: boolean }).available === true)
    .catch(() => {
      relaySendCheck = null; // offline: ask again next time
      return false;
    }));
}

/** A token's EIP-712 domain, read from the token itself (ERC-5267). Agora AUSD: "Agora Dollar", "1". */
async function tokenDomain(token: Address): Promise<TokenDomain> {
  const [, name, version, chainId, verifyingContract] = await reader().readContract({ address: token, abi: eip712DomainAbi, functionName: "eip712Domain" });
  return { name, version, chainId: Number(chainId), verifyingContract };
}

export function createOnchainClient(ctx: FanoutClientContext): FanoutClient {
  const c = {
    get treasury() {
      return need(config.contracts.treasury, "NEXT_PUBLIC_TREASURY_ADDRESS");
    },
    get batchPayout() {
      return need(config.contracts.batchPayout, "NEXT_PUBLIC_BATCH_PAYOUT_ADDRESS");
    },
    get claimEscrow() {
      return need(config.contracts.claimEscrow, "NEXT_PUBLIC_CLAIM_ESCROW_ADDRESS");
    },
  };
  const tokenAddress = () => need(config.stablecoin.address, "NEXT_PUBLIC_AUSD_ADDRESS");
  const usdcAddress = () => need(config.usdc.address, "NEXT_PUBLIC_USDC_ADDRESS");

  async function signer(): Promise<{ wc: WalletClient; account: Address }> {
    const wc = ctx.walletClient;
    const account = (wc?.account?.address ?? ctx.account) as Address | undefined;
    if (!wc || !account) throw new Error("Sign in first.");
    if ((await wc.getChainId()) !== activeChain.id) await wc.switchChain({ id: activeChain.id });
    return { wc, account };
  }

  /** Simulate (to surface revert reasons before paying gas), send, wait for the receipt. */
  async function write(params: Parameters<PublicClient["simulateContract"]>[0]) {
    const { wc, account } = await signer();
    const { request } = await reader().simulateContract({
      ...params,
      abi: [...(params.abi as readonly unknown[]), ...ALL_CONTRACT_ERRORS],
      account,
    } as Parameters<PublicClient["simulateContract"]>[0]);
    // Pass the wallet's own account object: works for Privy (JSON-RPC) and local keys alike.
    const hash = await wc.writeContract({ ...request, account: wc.account ?? account, chain: activeChain } as Parameters<WalletClient["writeContract"]>[0]);
    const receipt = await reader().waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The transaction failed onchain. Nothing changed.");
    return receipt;
  }

  /** An AUSD transfer from the signed-in account itself, which pays its own fee in MON. */
  async function transfer(to: Address, amount: bigint) {
    const { account } = await signer();
    const receipt = await write({ address: tokenAddress(), abi: erc20Abi, functionName: "transfer", args: [to, amount] });
    rememberActivity(activeChain.id, account, {
      kind: "sent",
      amount,
      counterparty: to,
      txHash: receipt.transactionHash,
      timestamp: Date.now(),
    });
    return { txHash: receipt.transactionHash };
  }

  async function statusesOf(signers: readonly Address[]) {
    if (signers.length === 0) return [];
    return reader().multicall({
      allowFailure: false,
      contracts: signers.map((s) => ({ address: c.claimEscrow, abi: claimEscrowAbi, functionName: "claims" as const, args: [s] as const })),
    });
  }

  /** Batches first..last (newest first) that belong to `platform`, read from the contracts. */
  async function scanBatches(first: number, last: number, platform: Address): Promise<BatchSummary[]> {
    if (last < first) return [];
    const ids = Array.from({ length: last - first + 1 }, (_, i) => BigInt(last - i));
    const batches = await reader().multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ address: c.batchPayout, abi: batchPayoutAbi, functionName: "getBatch" as const, args: [id] as const })),
    });
    const mine = batches
      .map(([p, createdAt, total, signers], i) => ({ id: ids[i].toString(), p, createdAt, total, signers }))
      .filter((b) => b.p.toLowerCase() === platform.toLowerCase());
    const claims = await statusesOf(mine.flatMap((b) => b.signers));
    let offset = 0;
    return mine.map((b): BatchSummary => {
      const slice = claims.slice(offset, (offset += b.signers.length));
      return {
        id: b.id,
        createdAt: Number(b.createdAt) * 1000,
        total: b.total,
        txHash: recallBatchTx(activeChain.id, c.batchPayout, b.id) ?? zeroHash,
        rowCount: b.signers.length,
        claimedCount: slice.filter(([, , status]) => status === 1).length,
      };
    });
  }

  return {
    getTreasuryBalance: (platform) =>
      guard(() => reader().readContract({ address: c.treasury, abi: treasuryAbi, functionName: "balanceOf", args: [platform] })),

    deposit: (amount) =>
      guard(async () => {
        const { account } = await signer();
        const [held, allowance] = await Promise.all([
          reader().readContract({ address: tokenAddress(), abi: erc20Abi, functionName: "balanceOf", args: [account] }),
          reader().readContract({ address: tokenAddress(), abi: erc20Abi, functionName: "allowance", args: [account, c.treasury] }),
        ]);
        if (held < amount) throw new Error(`Your account holds ${usd(held)} in AUSD, less than ${usd(amount)}. Add AUSD to your account first.`);
        if (allowance < amount) {
          await write({ address: tokenAddress(), abi: erc20Abi, functionName: "approve", args: [c.treasury, amount] });
        }
        const receipt = await write({ address: c.treasury, abi: treasuryAbi, functionName: "deposit", args: [amount] });
        return { txHash: receipt.transactionHash };
      }),

    createBatchPayout: (rows) =>
      guard(async () => {
        if (rows.length > MAX_ROWS) throw new Error(REVERT_MESSAGES.TooManyRows);
        const receipt = await write({
          address: c.batchPayout,
          abi: batchPayoutAbi,
          functionName: "createBatch",
          args: [rows.map((r) => r.claimSigner), rows.map((r) => r.amount), rows.map((r) => r.emailHash ?? zeroHash)],
        });
        const [event] = parseEventLogs({ abi: batchPayoutAbi, eventName: "BatchCreated", logs: receipt.logs });
        if (!event) throw new Error("The payout went through, but its number couldn't be read. Check your payouts list.");
        const batchId = event.args.batchId.toString();
        rememberBatchTx(activeChain.id, c.batchPayout, batchId, receipt.transactionHash);
        return { batchId, txHash: receipt.transactionHash };
      }),

    getBatch: (batchId) =>
      guard(async () => {
        if (!/^\d+$/.test(batchId)) throw new NotFoundError(`Payout #${batchId} doesn't exist.`);
        const [platform, createdAt, total, signers] = await reader().readContract({
          address: c.batchPayout,
          abi: batchPayoutAbi,
          functionName: "getBatch",
          args: [BigInt(batchId)],
        });
        if (platform === zeroAddress) throw new NotFoundError(`Payout #${batchId} doesn't exist.`);
        const claims = await statusesOf(signers);
        return {
          id: batchId,
          createdAt: Number(createdAt) * 1000,
          total,
          txHash: recallBatchTx(activeChain.id, c.batchPayout, batchId) ?? (await indexedBatchTx(batchId).catch(() => undefined)) ?? zeroHash,
          rows: signers.map((claimSigner, i) => {
            const [amount, , status, , emailHash] = claims[i];
            return { claimSigner, amount, status: STATUS[status], emailHash: emailHash === zeroHash ? undefined : emailHash };
          }),
        };
      }),

    getClaim: (claimSigner) =>
      guard(async () => {
        const [amount, platform, status] = await reader().readContract({
          address: c.claimEscrow,
          abi: claimEscrowAbi,
          functionName: "getClaim",
          args: [claimSigner],
        });
        if (amount === 0n) throw new NotFoundError("This payment link isn't valid.");
        return { amount, platform, status: STATUS[status] };
      }),

    claim: (claimSigner, recipient, signature) =>
      guard(async () => {
        // The relayer checks who is claiming (their verified email) before co-signing, so send the session.
        const accessToken = await ctx.getAccessToken?.();
        if (!accessToken) throw new Error("Sign in to claim this payment.");
        let res: Response;
        try {
          res = await fetch("/api/relay/claim", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ claimSigner, recipient, signature }),
          });
        } catch {
          throw new Error("Can't reach the server. Check your connection and try again.");
        }
        const body = (await res.json().catch(() => ({}))) as { txHash?: Hex; amount?: string; error?: string; notFound?: boolean };
        if (!res.ok || !body.txHash) {
          const message = body.error ?? "Something went wrong and nothing was claimed. Try again.";
          throw body.notFound ? new NotFoundError(message) : new Error(message);
        }
        rememberActivity(activeChain.id, recipient, {
          kind: "received",
          amount: BigInt(body.amount ?? "0"),
          counterparty: zeroAddress,
          txHash: body.txHash,
          timestamp: Date.now(),
          payout: true,
        });
        return { txHash: body.txHash };
      }),

    getPayeeBalance: (address) =>
      guard(() => reader().readContract({ address: tokenAddress(), abi: erc20Abi, functionName: "balanceOf", args: [address] })),

    send: (to, amount) => guard(() => transfer(to, amount)),

    sendGasless: (to, amount) =>
      guard(async () => {
        // The relayer pays the fee, so like claiming it wants a signed-in session. Without one, send the old way.
        const accessToken = await ctx.getAccessToken?.();
        // Ask before signing, so a signature is never made that nobody will submit.
        if (!accessToken || !(await relaySendAvailable())) return { ...(await transfer(to, amount)), gasless: false };
        const { wc, account } = await signer();
        const [held, domain] = await Promise.all([
          reader().readContract({ address: tokenAddress(), abi: erc20Abi, functionName: "balanceOf", args: [account] }),
          tokenDomain(tokenAddress()),
        ]);
        if (held < amount) throw new Error(`Not enough: your balance is ${usd(held)}, less than ${usd(amount)}.`);

        // One signature: exactly this amount, to exactly this address, once (lib/fanout/erc3009.ts).
        const auth = {
          from: account,
          to,
          value: amount,
          validAfter: 0n,
          validBefore: BigInt(Math.floor(Date.now() / 1000)) + AUTHORIZATION_WINDOW_SECONDS,
          nonce: randomNonce(),
        };
        const signature = await signAuthorization(wc, "TransferWithAuthorization", domain, auth);

        let res: Response;
        try {
          res = await fetch("/api/relay/send", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              from: auth.from,
              to: auth.to,
              value: auth.value.toString(),
              validAfter: auth.validAfter.toString(),
              validBefore: auth.validBefore.toString(),
              nonce: auth.nonce,
              signature,
            }),
          });
        } catch {
          throw new Error("Can't reach the server. Check your connection and try again.");
        }
        const body = (await res.json().catch(() => ({}))) as { txHash?: Hex; error?: string };
        if (!res.ok || !body.txHash) throw new Error(body.error ?? "Something went wrong and nothing was sent. Try again.");
        rememberActivity(activeChain.id, account, { kind: "sent", amount, counterparty: to, txHash: body.txHash, timestamp: Date.now() });
        return { txHash: body.txHash, gasless: true };
      }),

    receiveAsUsdc: (amount) =>
      guard(async () => {
        const settle = need(config.usdc.settle, "NEXT_PUBLIC_SETTLE_ADDRESS");
        // The relayer pays the gas, so like claiming it wants a signed-in session.
        const accessToken = await ctx.getAccessToken?.();
        if (!accessToken) throw new Error("Sign in to change dollars to USDC.");
        const { wc, account } = await signer();
        const [held, [, quote], domain] = await Promise.all([
          reader().readContract({ address: tokenAddress(), abi: erc20Abi, functionName: "balanceOf", args: [account] }),
          reader().readContract({
            address: need(config.usdc.pair, "NEXT_PUBLIC_AGORA_PAIR_ADDRESS"),
            abi: agoraPairAbi,
            functionName: "getAmountsOut",
            args: [amount, [tokenAddress(), usdcAddress()]],
          }),
          tokenDomain(tokenAddress()),
        ]);
        if (held < amount) throw new Error(`Your balance is ${usd(held)}, less than ${usd(amount)}.`);

        // One signature: AUSD to SettleToUsdc, at least minOut USDC back (lib/fanout/usdc-settle.ts).
        const auth = {
          from: account,
          value: amount,
          validAfter: 0n,
          validBefore: BigInt(Math.floor(Date.now() / 1000)) + SETTLE_WINDOW_SECONDS,
          salt: randomSalt(),
          minOut: minOutFor(quote),
        };
        const signature = await signSettle(wc, domain, settle, auth);

        let res: Response;
        try {
          res = await fetch("/api/relay/settle", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              from: auth.from,
              value: auth.value.toString(),
              validAfter: auth.validAfter.toString(),
              validBefore: auth.validBefore.toString(),
              salt: auth.salt,
              minOut: auth.minOut.toString(),
              signature,
            }),
          });
        } catch {
          throw new Error("Can't reach the server. Check your connection and try again.");
        }
        const body = (await res.json().catch(() => ({}))) as { txHash?: Hex; amountOut?: string; error?: string };
        if (!res.ok || !body.txHash) throw new Error(body.error ?? "Something went wrong and nothing changed. Try again.");
        rememberActivity(activeChain.id, account, {
          kind: "sent",
          amount,
          counterparty: settle,
          txHash: body.txHash,
          timestamp: Date.now(),
          toUsdc: true,
        });
        return { txHash: body.txHash, amountOut: BigInt(body.amountOut ?? "0") };
      }),

    getPayeeUsdcBalance: (address) =>
      guard(() => reader().readContract({ address: usdcAddress(), abi: erc20Abi, functionName: "balanceOf", args: [address] })),

    listBatches: (platform) =>
      guard(async () => {
        const next = Number(await reader().readContract({ address: c.batchPayout, abi: batchPayoutAbi, functionName: "nextBatchId" }));
        const last = next - 1;
        if (last < 1) return [];
        if (indexerEnabled()) {
          try {
            const { batches, latestId } = await indexedBatches(platform);
            // The indexer trails the chain by a few seconds: read anything newer straight from the contract.
            const fresh = await scanBatches(Math.max(latestId + 1, last - LIST_SCAN_LIMIT + 1), last, platform);
            return [...fresh, ...batches];
          } catch {
            // Indexer down or unreachable: fall through to the chain scan.
          }
        }
        return scanBatches(Math.max(1, last - LIST_SCAN_LIMIT + 1), last, platform);
      }),

    // Indexed history (any device), plus what this device did that the indexer hasn't caught up to.
    getPayeeHistory: async (address) => {
      const local = recallActivity(activeChain.id, address);
      if (!indexerEnabled()) return local;
      try {
        return mergeHistory(await indexedPayeeHistory(address), local);
      } catch {
        return local;
      }
    },
  };

}
