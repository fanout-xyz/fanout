import "server-only";
import { PrivyClient } from "@privy-io/node";
import { createPublicClient, createWalletClient, http, isAddress, isHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain } from "@/lib/chains";
import { claimVerifyingContract, config } from "@/lib/config";
import { hashEmail } from "@/lib/email-hash";
import { claimEscrowAbi } from "./abis";
import { recoverClaimSigner, signVerification } from "./claim-keys";

/**
 * Submits claims for payees and pays the gas from a Fanout-owned wallet (RELAYER_PRIVATE_KEY),
 * since a payee's new wallet holds no MON.
 *
 * Before it does, it acts as the claim verifier: it checks the claimer's Privy session, and only
 * if one of their verified emails matches the email the payment was sent to does it co-sign with
 * VERIFIER_PRIVATE_KEY. ClaimEscrow refuses any claim without that co-signature, so a leaked link
 * alone can't be claimed, not even by calling the contract directly.
 * Every check below runs before any gas is spent, so junk requests cost nothing.
 */

export class RelayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// ClaimEscrow.Status: 0 Sent, 1 Claimed, 2 Refunded. An unknown claim has amount 0.
const SENT = 0;
const CLAIMED = 1;

const reader = createPublicClient({ chain: activeChain, transport: http() });

function serverKey(name: "RELAYER_PRIVATE_KEY" | "VERIFIER_PRIVATE_KEY"): Hex {
  const key = process.env[name];
  if (!key) throw new RelayError(`Claims are switched off: ${name} isn't configured.`, 503);
  return (key.startsWith("0x") ? key : `0x${key}`) as Hex;
}

let privy: PrivyClient | null = null;
function privyClient(): PrivyClient {
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!config.privyAppId || !appSecret) throw new RelayError("Claims are switched off: PRIVY_APP_SECRET isn't configured.", 503);
  return (privy ??= new PrivyClient({ appId: config.privyAppId, appSecret }));
}

/** Hashes of the emails Privy has verified for the signed-in user (email logins, not just profile data). */
async function verifiedEmailHashes(accessToken: string): Promise<Set<Hex>> {
  const client = privyClient();
  let userId: string;
  try {
    ({ user_id: userId } = await client.utils().auth().verifyAccessToken(accessToken));
  } catch {
    throw new RelayError("Your session has expired. Sign in again.", 401);
  }
  const user = await client.users()._get(userId);
  return new Set(user.linked_accounts.flatMap((a) => (a.type === "email" && a.verified_at ? [hashEmail(a.address)] : [])));
}

// One transaction at a time, so concurrent claims don't pick the same nonce.
let queue: Promise<unknown> = Promise.resolve();

export async function relayClaim(input: {
  claimSigner: unknown;
  recipient: unknown;
  signature: unknown;
  accessToken: string | null;
}): Promise<Hex> {
  const { claimSigner, recipient, signature, accessToken } = input;
  if (!accessToken) throw new RelayError("Sign in to claim this payment.", 401);
  if (typeof claimSigner !== "string" || !isAddress(claimSigner)) throw new RelayError("Bad claim.", 400);
  if (typeof recipient !== "string" || !isAddress(recipient)) throw new RelayError("Bad recipient.", 400);
  if (typeof signature !== "string" || !isHex(signature)) throw new RelayError("Bad signature.", 400);

  const escrow = claimVerifyingContract();
  const account = privateKeyToAccount(serverKey("RELAYER_PRIVATE_KEY"));
  const verifierKey = serverKey("VERIFIER_PRIVATE_KEY");

  const [amount, , status, emailHash] = await reader.readContract({ address: escrow, abi: claimEscrowAbi, functionName: "getClaim", args: [claimSigner] });
  if (amount === 0n) throw new RelayError("This payment link isn't valid.", 404);
  if (status === CLAIMED) throw new RelayError("This payment has already been claimed.", 409);
  if (status !== SENT) throw new RelayError("This payment was returned to the sender.", 410);

  const message = { recipient: recipient as Address, claimContract: escrow, chainId: activeChain.id };
  const signer = await recoverClaimSigner(message, signature).catch(() => null);
  if (signer?.toLowerCase() !== claimSigner.toLowerCase()) throw new RelayError("Bad signature.", 400);

  // The email check: the heart of the verifier.
  const emails = await verifiedEmailHashes(accessToken);
  if (!emails.has(emailHash)) {
    throw new RelayError("This payment was sent to a different email. Sign in with the email address it was sent to.", 403);
  }
  const verification = await signVerification(verifierKey, { ...message, claimSigner });

  const run = async () => {
    const { request } = await reader.simulateContract({
      account,
      address: escrow,
      abi: claimEscrowAbi,
      functionName: "claim",
      args: [claimSigner, recipient as Address, signature, verification],
    });
    const hash = await createWalletClient({ account, chain: activeChain, transport: http() }).writeContract(request);
    const receipt = await reader.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new RelayError("The claim transaction failed.", 502);
    return hash;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
