import "server-only";
import { createPublicClient, createWalletClient, http, isAddress, isHex, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain } from "@/lib/chains";
import { privyClient, SessionExpired, verifiedUser } from "@/lib/auth/privy-server";
import { config } from "@/lib/config";
import { claimEscrowAbi, erc20Abi } from "./abis";
import { recoverClaimSigner, signVerification } from "./claim-keys";
import { ALL_CONTRACT_ERRORS, friendlyChainError, need } from "./onchain-client";
import { NotFoundError } from "./types";

/**
 * Server-side relayer: submits ClaimEscrow.claim() and pays its gas, so payees with
 * brand-new accounts (no MON) can claim. After a claim it tops the recipient up with a little
 * MON (only if they're nearly empty) so they can send from their account later.
 *
 * It is also the claim verifier. ClaimEscrow refuses any claim without a co-signature from
 * VERIFIER_PRIVATE_KEY, and we only give one after checking the claimer's Privy session: one of
 * their verified emails must match the email the payment was sent to (the claim's onchain
 * emailHash). So a leaked or forwarded link alone can't be claimed, not even by calling the
 * contract directly. Every check runs before any gas is spent.
 *
 * Env (server only, never NEXT_PUBLIC): RELAYER_PRIVATE_KEY (a testnet-only key funded with MON),
 * VERIFIER_PRIVATE_KEY (its address is ClaimEscrow.verifier), PRIVY_APP_SECRET, and optional
 * RELAYER_TOPUP_MON (default 0.02) and RELAYER_TOPUP_BELOW_MON (0.005).
 */

export type RelayResult = { txHash: Hex; amount: bigint; toppedUp: boolean };

/** A refusal whose message is safe to show the claimer as is. */
export class ClaimRefused extends Error {}

// ClaimEscrow.Status: 0 Sent, 1 Claimed, 2 Refunded.
const SENT = 0;
const CLAIMED = 1;

function serverKey(name: "RELAYER_PRIVATE_KEY" | "VERIFIER_PRIVATE_KEY"): Hex | null {
  const key = process.env[name];
  return key && /^0x[0-9a-fA-F]{64}$/.test(key) ? (key as Hex) : null;
}

function relayerAccount() {
  const key = serverKey("RELAYER_PRIVATE_KEY");
  return key ? privateKeyToAccount(key) : null;
}

export function relayerConfigured(): boolean {
  return relayerAccount() !== null && serverKey("VERIFIER_PRIVATE_KEY") !== null && !!process.env.PRIVY_APP_SECRET;
}

export async function relayClaim(input: {
  claimSigner: unknown;
  recipient: unknown;
  signature: unknown;
  accessToken: string | null;
}): Promise<RelayResult> {
  const { claimSigner, recipient, signature, accessToken } = input;
  if (typeof claimSigner !== "string" || !isAddress(claimSigner)) throw new NotFoundError("This payment link isn't valid.");
  if (typeof recipient !== "string" || !isAddress(recipient)) throw new Error("Your account isn't ready. Sign in again.");
  if (typeof signature !== "string" || !isHex(signature) || signature.length !== 132) throw new NotFoundError("This payment link isn't valid.");
  if (!accessToken) throw new ClaimRefused("Sign in to claim this payment.");

  const account = relayerAccount();
  const verifierKey = serverKey("VERIFIER_PRIVATE_KEY");
  const privyApi = privyClient();
  if (!account || !verifierKey || !privyApi) {
    console.error("[relay] RELAYER_PRIVATE_KEY, VERIFIER_PRIVATE_KEY or PRIVY_APP_SECRET is not set");
    throw new Error("Claiming isn't available right now. Try again later.");
  }

  const publicClient = createPublicClient({ chain: activeChain, transport: http() });
  const wallet = createWalletClient({ account, chain: activeChain, transport: http() });
  const escrow = need(config.contracts.claimEscrow, "NEXT_PUBLIC_CLAIM_ESCROW_ADDRESS");

  try {
    const [amount, , status, emailHash] = await publicClient.readContract({
      address: escrow,
      abi: claimEscrowAbi,
      functionName: "getClaim",
      args: [claimSigner as Address],
    });
    if (amount === 0n) throw new NotFoundError("This payment link isn't valid.");
    if (status === CLAIMED) throw new ClaimRefused("This payment has already been claimed.");
    if (status !== SENT) throw new ClaimRefused("This payment was returned to the sender.");

    // The link signature must match before we look anyone up or co-sign.
    const message = { recipient: recipient as Address, claimContract: escrow, chainId: activeChain.id };
    const linkSigner = await recoverClaimSigner(message, signature as Hex).catch(() => null);
    if (linkSigner?.toLowerCase() !== claimSigner.toLowerCase()) throw new NotFoundError("This payment link isn't valid.");

    const { emailHashes } = await verifiedUser(privyApi, accessToken).catch((err) => {
      throw err instanceof SessionExpired ? new ClaimRefused("Your session has expired. Sign in again to claim.") : err;
    });
    if (!emailHashes.has(emailHash)) {
      throw new ClaimRefused("This payment was sent to a different email. Sign in with the email address it was sent to.");
    }
    const verification = await signVerification(verifierKey, { ...message, claimSigner: claimSigner as Address });

    // Dry run first: anything else wrong reverts here and costs no gas.
    const { request } = await publicClient.simulateContract({
      account,
      address: escrow,
      abi: [...claimEscrowAbi, ...ALL_CONTRACT_ERRORS],
      functionName: "claim",
      args: [claimSigner as Address, recipient as Address, signature as Hex, verification],
    });
    const txHash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error("The claim failed onchain. Nothing was claimed. Try again.");

    return { txHash, amount, toppedUp: await topUp(publicClient, wallet, recipient as Address) };
  } catch (err) {
    if (err instanceof ClaimRefused || err instanceof NotFoundError) throw err;
    throw friendlyChainError(err);
  }
}

/** Best effort: a failed top-up never fails the claim. */
async function topUp(
  publicClient: ReturnType<typeof createPublicClient>,
  wallet: ReturnType<typeof createWalletClient>,
  to: Address,
): Promise<boolean> {
  try {
    const amount = parseEther(process.env.RELAYER_TOPUP_MON || "0.02");
    const below = parseEther(process.env.RELAYER_TOPUP_BELOW_MON || "0.005");
    if (amount === 0n || (await publicClient.getBalance({ address: to })) >= below) return false;
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: activeChain, to, value: amount });
    await publicClient.waitForTransactionReceipt({ hash });
    return true;
  } catch (err) {
    console.error("[relay] top-up failed", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Paying someone by email takes three transactions from the payee's own account (approve,
 * deposit, create the payout), about 0.04 MON at testnet prices. Before that, top the account up
 * so it can afford them. Only for a signed-in user whose account holds the dollars they're sending,
 * and at most once per account every few minutes, so this can't be used to drain the relayer.
 */
const feeTopUps = new Map<string, number>();
const FEE_COOLDOWN_MS = 5 * 60_000;

export async function topUpForEmailPayment(input: { address: unknown; amount: unknown; accessToken: string | null }): Promise<{ toppedUp: boolean }> {
  const { address, amount, accessToken } = input;
  if (typeof address !== "string" || !isAddress(address)) throw new ClaimRefused("Your account isn't ready. Sign in again.");
  if (typeof amount !== "string" || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new ClaimRefused("Enter an amount to send.");
  if (!accessToken) throw new ClaimRefused("Sign in to send money.");

  const account = relayerAccount();
  const privyApi = privyClient();
  if (!account || !privyApi) {
    console.error("[relay] RELAYER_PRIVATE_KEY or PRIVY_APP_SECRET is not set");
    throw new Error("Sending by email isn't available right now. Try again later.");
  }
  await verifiedUser(privyApi, accessToken); // throws SessionExpired

  const key = address.toLowerCase();
  const last = feeTopUps.get(key) ?? 0;
  if (Date.now() - last < FEE_COOLDOWN_MS) return { toppedUp: false };

  const publicClient = createPublicClient({ chain: activeChain, transport: http() });
  const token = need(config.stablecoin.address, "NEXT_PUBLIC_AUSD_ADDRESS");
  const held = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address as Address] });
  if (held < BigInt(amount)) throw new ClaimRefused("You don't have enough for that. Nothing was sent.");

  const target = parseEther(process.env.RELAYER_FEE_TOPUP_MON || "0.06");
  const have = await publicClient.getBalance({ address: address as Address });
  if (have >= target) return { toppedUp: false };
  feeTopUps.set(key, Date.now());
  const wallet = createWalletClient({ account, chain: activeChain, transport: http() });
  const hash = await wallet.sendTransaction({ account, chain: activeChain, to: address as Address, value: target - have });
  await publicClient.waitForTransactionReceipt({ hash });
  return { toppedUp: true };
}
