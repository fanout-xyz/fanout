import "server-only";
import { createPublicClient, createWalletClient, http, isAddress, isHex, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain } from "@/lib/chains";
import { config } from "@/lib/config";
import { claimEscrowAbi } from "./abis";
import { ALL_CONTRACT_ERRORS, friendlyChainError, need } from "./onchain-client";
import { NotFoundError } from "./types";

/**
 * Server-side relayer: submits ClaimEscrow.claim() and pays its gas, so payees with
 * brand-new accounts (no MON) can claim. The claim signature binds the recipient, so the
 * relayer can't redirect funds. After a claim it tops the recipient up with a little MON
 * (only if they're nearly empty) so they can send from their account later.
 *
 * Env (server only, never NEXT_PUBLIC): RELAYER_PRIVATE_KEY (a testnet-only key funded
 * with MON), optional RELAYER_TOPUP_MON (default 0.02) and RELAYER_TOPUP_BELOW_MON (0.005).
 */

export type RelayResult = { txHash: Hex; amount: bigint; toppedUp: boolean };

function relayerAccount() {
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return privateKeyToAccount(key as Hex);
}

export function relayerConfigured(): boolean {
  return relayerAccount() !== null;
}

export async function relayClaim(input: { claimSigner: unknown; recipient: unknown; signature: unknown }): Promise<RelayResult> {
  const { claimSigner, recipient, signature } = input;
  if (typeof claimSigner !== "string" || !isAddress(claimSigner)) throw new NotFoundError("This payment link isn't valid.");
  if (typeof recipient !== "string" || !isAddress(recipient)) throw new Error("Your account isn't ready. Sign in again.");
  if (typeof signature !== "string" || !isHex(signature) || signature.length !== 132) throw new NotFoundError("This payment link isn't valid.");

  const account = relayerAccount();
  if (!account) {
    console.error("[relay] RELAYER_PRIVATE_KEY is not set");
    throw new Error("Claiming isn't available right now. Try again later.");
  }

  const publicClient = createPublicClient({ chain: activeChain, transport: http() });
  const wallet = createWalletClient({ account, chain: activeChain, transport: http() });
  const escrow = need(config.contracts.claimEscrow, "NEXT_PUBLIC_CLAIM_ESCROW_ADDRESS");

  try {
    const [amount] = await publicClient.readContract({ address: escrow, abi: claimEscrowAbi, functionName: "getClaim", args: [claimSigner as Address] });
    if (amount === 0n) throw new NotFoundError("This payment link isn't valid.");

    // Dry run first: a bad signature or used link reverts here and costs no gas.
    const { request } = await publicClient.simulateContract({
      account,
      address: escrow,
      abi: [...claimEscrowAbi, ...ALL_CONTRACT_ERRORS],
      functionName: "claim",
      args: [claimSigner as Address, recipient as Address, signature as Hex],
    });
    const txHash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error("The claim failed onchain. Nothing was claimed. Try again.");

    return { txHash, amount, toppedUp: await topUp(publicClient, wallet, recipient as Address) };
  } catch (err) {
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
