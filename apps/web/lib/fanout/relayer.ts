import "server-only";
import { createPublicClient, createWalletClient, http, isAddress, isHex, parseEther, parseEventLogs, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain } from "@/lib/chains";
import { privyClient, SessionExpired, verifiedUser } from "@/lib/auth/privy-server";
import { config } from "@/lib/config";
import {
  agoraPairAbi,
  authorizationStateAbi,
  batchPayoutV3Abi,
  claimEscrowAbi,
  erc20Abi,
  settleToUsdcAbi,
  transferWithAuthorizationAbi,
  treasuryAbi,
} from "./abis";
import { BATCH_AUTHORIZATION_WINDOW_SECONDS } from "./batch-authorization";
import { AUTHORIZATION_WINDOW_SECONDS } from "./erc3009";
import { recoverClaimSigner, signVerification } from "./claim-keys";
import { ALL_CONTRACT_ERRORS, friendlyChainError, need } from "./onchain-client";
import { NotFoundError } from "./types";
import { SETTLE_WINDOW_SECONDS } from "./usdc-settle";

/**
 * Server-side relayer: submits ClaimEscrow.claim() and pays its gas, so payees with
 * brand-new accounts (no MON) can claim. It also submits payees' signed sends (relaySend),
 * changes to USDC (relaySettle) and, with the v3 contracts, payments by email
 * (relayEmailPayment), so none of those need MON either. After a claim it tops the
 * recipient up with a little MON (only if they're nearly empty) for anything they do from their
 * account directly.
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

/** The relayer isn't set up on this server (no key or no Privy secret). Nothing was attempted. */
export class RelayUnavailable extends Error {}

/** AUSD's ERC-3009 errors, so a used, expired or badly signed authorization decodes by name. */
const authorizationErrors = transferWithAuthorizationAbi.filter((x) => x.type === "error");

// ClaimEscrow.Status: 0 Sent, 1 Claimed, 2 Refunded.
const SENT = 0;
const CLAIMED = 1;

function serverKey(name: "RELAYER_PRIVATE_KEY" | "VERIFIER_PRIVATE_KEY"): Hex | null {
  const key = process.env[name];
  return key && /^0x[0-9a-fA-F]{64}$/.test(key) ? (key as Hex) : null;
}

export function relayerAccount() {
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
 * Before the v3 contracts, paying someone by email takes three transactions from the payee's own
 * account (approve, deposit, create the payout), about 0.04 MON at testnet prices. (With v3,
 * relayEmailPayment submits it all and the account needs no MON.) Before that, top the account up
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

/** Whether relaySend can run here: the client asks first and sends the old way if not. */
export function relaySendConfigured(): boolean {
  return relayerAccount() !== null && privyClient() !== null;
}

/** A non-negative integer sent as a decimal string, or null. */
const uint = (v: unknown) => (typeof v === "string" && /^\d{1,78}$/.test(v) ? BigInt(v) : null);

/**
 * Sending dollars from a payee's account to anyone: submits AUSD's ERC-3009
 * transferWithAuthorization with the payee's signature and pays its gas, so the payee never needs
 * MON. The signature binds the payee, the recipient, the amount and a one-time nonce, so the relayer
 * can't change where the money goes or send it twice. Signed-in users only; balance, deadline and
 * rate are checked before any gas is spent. Throws RelayUnavailable when the relayer isn't set up,
 * so the client can send the old way instead.
 */
export async function relaySend(input: {
  from: unknown;
  to: unknown;
  value: unknown;
  validAfter: unknown;
  validBefore: unknown;
  nonce: unknown;
  signature: unknown;
  accessToken: string | null;
}): Promise<{ txHash: Hex }> {
  const { from, to, nonce, signature, accessToken } = input;
  const [value, validAfter, validBefore] = [uint(input.value), uint(input.validAfter), uint(input.validBefore)];
  if (typeof from !== "string" || !isAddress(from)) throw new ClaimRefused("Your account isn't ready. Sign in again.");
  if (typeof to !== "string" || !isAddress(to) || to === zeroAddress) throw new ClaimRefused("That address isn't valid. Nothing was sent.");
  if (to.toLowerCase() === from.toLowerCase()) throw new ClaimRefused("That's your own address. Nothing was sent.");
  if (value === null || value === 0n) throw new ClaimRefused("Enter an amount to send.");
  if (validAfter === null || validBefore === null) throw new ClaimRefused("Something's off with this request. Try again.");
  if (typeof nonce !== "string" || !isHex(nonce) || nonce.length !== 66) throw new ClaimRefused("Something's off with this request. Try again.");
  if (typeof signature !== "string" || !isHex(signature) || signature.length < 132) throw new ClaimRefused("Something's off with this request. Try again.");
  if (!accessToken) throw new ClaimRefused("Sign in to send money.");

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (validAfter > now) throw new ClaimRefused("Something's off with this request. Try again.");
  // Room to land, and no long-lived authorizations sitting around.
  if (validBefore < now + 30n || validBefore > now + AUTHORIZATION_WINDOW_SECONDS + 60n) throw new ClaimRefused("That took too long. Nothing was sent. Try again.");

  const account = relayerAccount();
  const privyApi = privyClient();
  if (!account || !privyApi) {
    console.error("[relay] RELAYER_PRIVATE_KEY or PRIVY_APP_SECRET is not set");
    throw new RelayUnavailable("Sending without a fee isn't available right now.");
  }
  await verifiedUser(privyApi, accessToken); // throws SessionExpired

  const publicClient = createPublicClient({ chain: activeChain, transport: http() });
  const wallet = createWalletClient({ account, chain: activeChain, transport: http() });
  const ausd = need(config.stablecoin.address, "NEXT_PUBLIC_AUSD_ADDRESS");

  try {
    const held = await publicClient.readContract({ address: ausd, abi: erc20Abi, functionName: "balanceOf", args: [from as Address] });
    if (held < value) throw new ClaimRefused("You don't have enough for that. Nothing was sent.");

    // Dry run first: a bad signature or a used or expired authorization reverts here for free.
    const { request } = await publicClient.simulateContract({
      account,
      address: ausd,
      abi: transferWithAuthorizationAbi,
      functionName: "transferWithAuthorization",
      args: [from as Address, to as Address, value, validAfter, validBefore, nonce as Hex, signature as Hex],
    });
    const txHash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error("The payment failed. Nothing was sent. Try again.");
    return { txHash };
  } catch (err) {
    if (err instanceof ClaimRefused) throw err;
    throw friendlyChainError(err);
  }
}

/** Whether relayEmailPayment can run here: the v3 contracts and the relayer are set up. */
export function relayEmailPaymentConfigured(): boolean {
  return config.payoutsV3 && relayerAccount() !== null && privyClient() !== null;
}

/** Paying by email is one person; the relayer pays the gas, so it doesn't relay bigger payouts. */
const EMAIL_PAYMENT_ROWS = 1;

const bytes32 = (v: unknown): v is Hex => typeof v === "string" && isHex(v) && v.length === 66;
const signatureHex = (v: unknown): v is Hex => typeof v === "string" && isHex(v) && v.length >= 132;

/**
 * Paying someone by email from an account that holds only AUSD (v3 contracts): submits
 * BatchPayout.depositAndCreateBatchFor and pays its gas. The account signed two things: an ERC-3009
 * ReceiveWithAuthorization moving exactly the payment's total into the Treasury for itself, and an
 * EIP-712 CreateBatch fixing the claim signer, amount, email hash, claim window, a one-time nonce and
 * a deadline (lib/fanout/batch-authorization.ts). So the relayer can't change who can claim, how
 * much, or for how long, and can't use either signature twice. A refund goes back to the account's
 * own Treasury balance. Signed-in users only; balance and deadlines are checked before any gas is
 * spent. Throws RelayUnavailable when this server can't do it, so the client can pay the old way.
 *
 * If the deposit authorization was already used on its own (someone submitted it first), the money
 * is already in the account's Treasury balance, so this finishes with createBatchFor instead.
 */
export async function relayEmailPayment(input: {
  body: Record<string, unknown>;
  accessToken: string | null;
}): Promise<{ txHash: Hex; batchId: string }> {
  const { body, accessToken } = input;
  const { platform, claimSigners, emailHashes, nonce, signature } = body;
  const deposit = (body.deposit ?? {}) as Record<string, unknown>;
  const [claimWindow, deadline, validAfter, validBefore] = [uint(body.claimWindow), uint(body.deadline), uint(deposit.validAfter), uint(deposit.validBefore)];
  const amounts = Array.isArray(body.amounts) ? body.amounts.map(uint) : [];
  const malformed = () => new ClaimRefused("Something's off with this request. Nothing was sent. Try again.");

  if (typeof platform !== "string" || !isAddress(platform)) throw new ClaimRefused("Your account isn't ready. Sign in again.");
  if (!Array.isArray(claimSigners) || !Array.isArray(emailHashes) || claimSigners.length !== EMAIL_PAYMENT_ROWS) throw malformed();
  if (amounts.length !== EMAIL_PAYMENT_ROWS || emailHashes.length !== EMAIL_PAYMENT_ROWS) throw malformed();
  if (!claimSigners.every((s) => typeof s === "string" && isAddress(s) && s !== zeroAddress)) throw malformed();
  // Paying by email: every row is locked to an email.
  if (!emailHashes.every((h) => bytes32(h) && h !== zeroHash)) throw malformed();
  if (amounts.some((a) => a === null || a === 0n)) throw new ClaimRefused("Enter an amount to send.");
  if (claimWindow === null || deadline === null || validAfter === null || validBefore === null) throw malformed();
  if (!bytes32(nonce) || !bytes32(deposit.nonce) || !signatureHex(signature) || !signatureHex(deposit.signature)) throw malformed();
  if (!accessToken) throw new ClaimRefused("Sign in to send money.");

  const now = BigInt(Math.floor(Date.now() / 1000));
  // Room to land, and no long-lived authorizations sitting around.
  const tooLate = (t: bigint, window: bigint) => t < now + 30n || t > now + window + 60n;
  if (validAfter > now || tooLate(validBefore, AUTHORIZATION_WINDOW_SECONDS) || tooLate(deadline, BATCH_AUTHORIZATION_WINDOW_SECONDS)) {
    throw new ClaimRefused("That took too long. Nothing was sent. Try again.");
  }

  const account = relayerAccount();
  const privyApi = privyClient();
  if (!config.payoutsV3 || !account || !privyApi) {
    if (config.payoutsV3) console.error("[relay] RELAYER_PRIVATE_KEY or PRIVY_APP_SECRET is not set");
    throw new RelayUnavailable("Sending by email without a fee isn't available right now.");
  }
  await verifiedUser(privyApi, accessToken); // throws SessionExpired

  const publicClient = createPublicClient({ chain: activeChain, transport: http() });
  const wallet = createWalletClient({ account, chain: activeChain, transport: http() });
  const ausd = need(config.stablecoin.address, "NEXT_PUBLIC_AUSD_ADDRESS");
  const treasury = need(config.contracts.treasury, "NEXT_PUBLIC_TREASURY_ADDRESS");
  const batchPayout = need(config.contracts.batchPayout, "NEXT_PUBLIC_BATCH_PAYOUT_ADDRESS");
  const from = platform as Address;
  const total = (amounts as bigint[]).reduce((sum, a) => sum + a, 0n);
  const rows = [claimSigners as Address[], amounts as bigint[], emailHashes as Hex[]] as const;
  const auth = { nonce: nonce as Hex, deadline, signature: signature as Hex };
  const abi = [...batchPayoutV3Abi, ...authorizationErrors, ...ALL_CONTRACT_ERRORS];

  try {
    const [held, deposited] = await Promise.all([
      publicClient.readContract({ address: ausd, abi: erc20Abi, functionName: "balanceOf", args: [from] }),
      publicClient.readContract({ address: ausd, abi: authorizationStateAbi, functionName: "authorizationState", args: [from, deposit.nonce as Hex] }).catch(() => false),
    ]);

    // Dry run first: a bad signature, a used authorization or a reused claim link reverts here for free.
    let txHash: Hex;
    if (deposited) {
      // The deposit went through on its own already; its money waits in the account's Treasury balance.
      const balance = await publicClient.readContract({ address: treasury, abi: treasuryAbi, functionName: "balanceOf", args: [from] });
      if (balance < total) throw new ClaimRefused("This was already sent. Check your activity before trying again.");
      const { request } = await publicClient.simulateContract({ account, address: batchPayout, abi, functionName: "createBatchFor", args: [from, ...rows, claimWindow, auth] });
      txHash = await wallet.writeContract(request);
    } else {
      if (held < total) throw new ClaimRefused("You don't have enough for that. Nothing was sent.");
      const depositArg = { validAfter, validBefore, nonce: deposit.nonce as Hex, signature: deposit.signature as Hex };
      const { request } = await publicClient.simulateContract({
        account,
        address: batchPayout,
        abi,
        functionName: "depositAndCreateBatchFor",
        args: [from, ...rows, claimWindow, auth, depositArg],
      });
      txHash = await wallet.writeContract(request);
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error("The payment failed. Nothing was sent. Try again.");
    const [event] = parseEventLogs({ abi: batchPayoutV3Abi, eventName: "BatchCreated", logs: receipt.logs });
    if (!event) throw new Error("The payment went through, but its number couldn't be read. Check your activity.");
    return { txHash, batchId: event.args.batchId.toString() };
  } catch (err) {
    if (err instanceof ClaimRefused) throw err;
    throw friendlyChainError(err);
  }
}

/**
 * Changing dollars to USDC: submits SettleToUsdc.settle() with the payee's signed authorization and
 * pays its gas. The signature binds the amount, the minimum USDC out and the payee, and the USDC can
 * only go to the payee, so the relayer can't redirect anything. Like the fee top-up, it serves
 * signed-in users only, and checks balance, rate and deadline before spending any gas.
 */
export async function relaySettle(input: {
  from: unknown;
  value: unknown;
  validAfter: unknown;
  validBefore: unknown;
  salt: unknown;
  minOut: unknown;
  signature: unknown;
  accessToken: string | null;
}): Promise<{ txHash: Hex; amountOut: bigint }> {
  const { from, salt, signature, accessToken } = input;
  const [value, validAfter, validBefore, minOut] = [uint(input.value), uint(input.validAfter), uint(input.validBefore), uint(input.minOut)];
  if (typeof from !== "string" || !isAddress(from)) throw new ClaimRefused("Your account isn't ready. Sign in again.");
  if (value === null || value === 0n || validAfter === null || validBefore === null || minOut === null) throw new ClaimRefused("Enter an amount to change.");
  if (typeof salt !== "string" || !isHex(salt) || salt.length !== 66) throw new ClaimRefused("Something's off with this request. Try again.");
  if (typeof signature !== "string" || !isHex(signature) || signature.length < 132) throw new ClaimRefused("Something's off with this request. Try again.");
  if (!accessToken) throw new ClaimRefused("Sign in to change dollars to USDC.");

  const now = BigInt(Math.floor(Date.now() / 1000));
  // Room to land, and no long-lived authorizations sitting around.
  if (validBefore < now + 30n || validBefore > now + SETTLE_WINDOW_SECONDS + 60n) throw new ClaimRefused("That took too long. Try again.");

  const account = relayerAccount();
  const privyApi = privyClient();
  const settle = config.usdc.settle;
  if (!account || !privyApi || !settle || !config.usdc.address || !config.usdc.pair) {
    console.error("[relay] RELAYER_PRIVATE_KEY, PRIVY_APP_SECRET or the USDC settings are not set");
    throw new Error("USDC isn't available right now. Try again later.");
  }
  await verifiedUser(privyApi, accessToken); // throws SessionExpired

  const publicClient = createPublicClient({ chain: activeChain, transport: http() });
  const wallet = createWalletClient({ account, chain: activeChain, transport: http() });
  const ausd = need(config.stablecoin.address, "NEXT_PUBLIC_AUSD_ADDRESS");

  try {
    const [held, [, quote]] = await Promise.all([
      publicClient.readContract({ address: ausd, abi: erc20Abi, functionName: "balanceOf", args: [from as Address] }),
      publicClient.readContract({ address: config.usdc.pair, abi: agoraPairAbi, functionName: "getAmountsOut", args: [value, [ausd, config.usdc.address]] }),
    ]);
    if (held < value) throw new ClaimRefused("You don't have enough for that. Nothing changed.");
    if (quote < minOut) throw new ClaimRefused("The USDC rate moved. Nothing changed. Try again.");

    // Dry run first: a bad signature, a used authorization or a pair problem reverts here for free.
    const { request } = await publicClient.simulateContract({
      account,
      address: settle,
      abi: [...settleToUsdcAbi, ...agoraPairAbi.filter((x) => x.type === "error"), ...authorizationErrors, ...ALL_CONTRACT_ERRORS],
      functionName: "settle",
      args: [from as Address, value, validAfter, validBefore, salt as Hex, minOut, signature as Hex],
    });
    const txHash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error("The change to USDC failed onchain. Nothing changed. Try again.");
    const [event] = parseEventLogs({ abi: settleToUsdcAbi, eventName: "SettledToUsdc", logs: receipt.logs });
    return { txHash, amountOut: event?.args.amountOut ?? quote };
  } catch (err) {
    if (err instanceof ClaimRefused) throw err;
    throw friendlyChainError(err);
  }
}
