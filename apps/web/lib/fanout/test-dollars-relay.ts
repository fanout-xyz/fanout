import "server-only";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  parseEther,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { activeChain } from "@/lib/chains";
import { config } from "@/lib/config";
import { privyClient, verifiedUser } from "@/lib/auth/privy-server";
import { agoraFaucetAbi, transferEventAbi } from "./abis";
import { need } from "./onchain-client";
import { ClaimRefused, relayerAccount, RelayUnavailable } from "./relayer";
import { TEST_DOLLARS_CHAIN_ID, TEST_DOLLARS_COOLDOWN_MS } from "./test-dollars";

/**
 * Test dollars for the signed-in user's own account, from Agora's AUSD faucet on Monad testnet.
 *
 * The faucet's requestFunds(to) sends $10,000 to `to` (not to the caller), so the relayer only pays the
 * fee and never moves its own dollars. The faucet refuses an account that already holds $100,000 and
 * any request within a minute of the last one, from anyone.
 *
 * Guards, all before any fee is spent: test network only (our chain config AND what the RPC reports),
 * a signed-in session, the account must be one of the user's own (from Privy, never trusted from the
 * request), at most one request per account per day and a few per IP per hour. The limits live in
 * this server's memory, so they reset on a restart and each server instance keeps its own; the
 * faucet's own caps bound what that can cost.
 */

export const AGORA_AUSD_FAUCET: Address = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";

/** A request refused by a limit; retryAt (unix ms) is when asking again can work. */
export class TestDollarsLimited extends ClaimRefused {
  constructor(
    message: string,
    readonly retryAt: number,
  ) {
    super(message);
  }
}

const IP_MAX = 5;
const IP_WINDOW_MS = 60 * 60_000;
const BUSY_RETRY_MS = 60_000;

/** Per-instance memory: account -> when it last got test dollars; IP -> recent attempts. */
const accounts = new Map<string, number>();
const ips = new Map<string, number[]>();

/** Tests only. */
export function resetTestDollarLimits() {
  accounts.clear();
  ips.clear();
}

/** Counts this attempt; returns when the IP may try again if it's over the limit. */
function ipLimited(ip: string, now: number): number | null {
  const recent = (ips.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  recent.push(now);
  ips.set(ip, recent);
  return recent.length > IP_MAX ? recent[recent.length - 1 - IP_MAX] + IP_WINDOW_MS : null;
}

export type TestDollarsDeps = {
  /** Relayer key and Privy secret are set. */
  configured: () => boolean;
  /** The chain id the RPC actually serves. */
  rpcChainId: () => Promise<number>;
  /** The signed-in user's own account addresses. Throws SessionExpired. */
  ownAccounts: (accessToken: string) => Promise<Set<Address>>;
  /** Simulates, then submits requestFunds(to) from the relayer; resolves once it lands. */
  requestFunds: (to: Address) => Promise<{ txHash: Hex; amount: bigint }>;
  /** Best effort: enough MON for the account's own deposit and payout. */
  topUp: (to: Address) => Promise<boolean>;
};

export async function relayTestDollars(
  input: { address: unknown; accessToken: string | null; ip: string; now?: number },
  deps: TestDollarsDeps = liveDeps,
): Promise<{ txHash: Hex; amount: bigint; toppedUp: boolean }> {
  const now = input.now ?? Date.now();
  if (!config.testDollars || activeChain.id !== TEST_DOLLARS_CHAIN_ID) {
    throw new ClaimRefused("Test dollars aren't available here.");
  }
  if (!input.accessToken) throw new ClaimRefused("Sign in to get test dollars.");
  if (typeof input.address !== "string" || !isAddress(input.address)) throw new ClaimRefused("Your account isn't ready. Sign in again.");
  const retryIp = ipLimited(input.ip, now);
  if (retryIp) throw new TestDollarsLimited("Too many tries from here. Try again later.", retryIp);
  if (!deps.configured()) {
    console.error("[relay] RELAYER_PRIVATE_KEY or PRIVY_APP_SECRET is not set");
    throw new RelayUnavailable("Test dollars aren't available right now. Try again later.");
  }

  const address = getAddress(input.address);
  const own = await deps.ownAccounts(input.accessToken); // throws SessionExpired
  if (!own.has(address)) throw new ClaimRefused("Test dollars can only go to your own account. Sign in again.");

  const last = accounts.get(address);
  if (last !== undefined && now - last < TEST_DOLLARS_COOLDOWN_MS) {
    throw new TestDollarsLimited("You've had your test dollars for today. Try again tomorrow.", last + TEST_DOLLARS_COOLDOWN_MS);
  }

  // Never on mainnet, even if the RPC URL is pointed somewhere else by mistake.
  if ((await deps.rpcChainId()) !== TEST_DOLLARS_CHAIN_ID) throw new ClaimRefused("Test dollars aren't available here.");

  // Hold the account's slot while the request is in flight, so two taps can't both go through.
  accounts.set(address, now);
  try {
    const { txHash, amount } = await deps.requestFunds(address);
    return { txHash, amount, toppedUp: await deps.topUp(address) };
  } catch (err) {
    accounts.delete(address);
    throw err;
  }
}

const liveDeps: TestDollarsDeps = {
  configured: () => relayerAccount() !== null && privyClient() !== null,

  rpcChainId: () => createPublicClient({ chain: activeChain, transport: http() }).getChainId(),

  ownAccounts: async (accessToken) => (await verifiedUser(privyClient()!, accessToken)).wallets,

  requestFunds: async (to) => {
    const account = relayerAccount()!;
    const publicClient = createPublicClient({ chain: activeChain, transport: http() });
    const wallet = createWalletClient({ account, chain: activeChain, transport: http() });
    const ausd = need(config.stablecoin.address, "NEXT_PUBLIC_AUSD_ADDRESS");
    try {
      // Dry run first: the faucet's limits revert here for free.
      const { request } = await publicClient.simulateContract({
        account,
        address: AGORA_AUSD_FAUCET,
        abi: agoraFaucetAbi,
        functionName: "requestFunds",
        args: [to],
      });
      const txHash = await wallet.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("Getting test dollars failed. Nothing changed. Try again.");
      const sent = parseEventLogs({ abi: transferEventAbi, eventName: "Transfer", logs: receipt.logs }).find(
        (log) => log.address.toLowerCase() === ausd.toLowerCase() && log.args.to.toLowerCase() === to.toLowerCase(),
      );
      const amount =
        sent?.args.value ?? (await publicClient.readContract({ address: AGORA_AUSD_FAUCET, abi: agoraFaucetAbi, functionName: "faucetDripAmount" }));
      return { txHash, amount };
    } catch (err) {
      throw faucetError(err);
    }
  },

  topUp: async (to) => {
    try {
      const account = relayerAccount()!;
      const publicClient = createPublicClient({ chain: activeChain, transport: http() });
      const target = parseEther(process.env.RELAYER_FEE_TOPUP_MON || "0.06");
      const have = await publicClient.getBalance({ address: to });
      if (have >= target) return false;
      const wallet = createWalletClient({ account, chain: activeChain, transport: http() });
      const hash = await wallet.sendTransaction({ account, chain: activeChain, to, value: target - have });
      await publicClient.waitForTransactionReceipt({ hash });
      return true;
    } catch (err) {
      console.error("[relay] test dollars top-up failed", err instanceof Error ? err.message : err);
      return false;
    }
  },
};

/** The faucet's own refusals, in plain words. */
export function faucetError(err: unknown, now = Date.now()): Error {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    const name = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
    if (name === "MaxFrequencyExceeded") {
      return new TestDollarsLimited("Someone else just got test dollars. Try again in a minute.", now + BUSY_RETRY_MS);
    }
    if (name === "MaxAllowedExceeded") return new ClaimRefused("Your account already has plenty of test dollars.");
    console.error("[relay] test dollars failed", err.shortMessage);
    return new Error("Getting test dollars failed. Nothing changed. Try again.");
  }
  return err instanceof Error ? err : new Error("Getting test dollars failed. Nothing changed. Try again.");
}
