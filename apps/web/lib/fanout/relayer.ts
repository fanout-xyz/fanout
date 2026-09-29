import "server-only";
import { createPublicClient, createWalletClient, http, isAddress, isHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain } from "@/lib/chains";
import { claimVerifyingContract } from "@/lib/config";
import { claimEscrowAbi } from "./abis";
import { recoverClaimSigner } from "./claim-keys";

/**
 * Submits claims for payees and pays the gas from a Fanout-owned wallet (RELAYER_PRIVATE_KEY),
 * since a payee's new wallet holds no MON. Safe to expose: the signature binds the recipient,
 * so the relayer can only ever send a claim to the address the link holder chose.
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

function relayerAccount() {
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) throw new RelayError("Claims are switched off: the relayer isn't configured.", 503);
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}

// One transaction at a time, so concurrent claims don't pick the same nonce.
let queue: Promise<unknown> = Promise.resolve();

export async function relayClaim(input: { claimSigner: unknown; recipient: unknown; signature: unknown }): Promise<Hex> {
  const { claimSigner, recipient, signature } = input;
  if (typeof claimSigner !== "string" || !isAddress(claimSigner)) throw new RelayError("Bad claim.", 400);
  if (typeof recipient !== "string" || !isAddress(recipient)) throw new RelayError("Bad recipient.", 400);
  if (typeof signature !== "string" || !isHex(signature)) throw new RelayError("Bad signature.", 400);

  const escrow = claimVerifyingContract();
  const account = relayerAccount();

  const [amount, , status] = await reader.readContract({ address: escrow, abi: claimEscrowAbi, functionName: "getClaim", args: [claimSigner] });
  if (amount === 0n) throw new RelayError("This payment link isn't valid.", 404);
  if (status === CLAIMED) throw new RelayError("This payment has already been claimed.", 409);
  if (status !== SENT) throw new RelayError("This payment was returned to the sender.", 410);

  const message = { recipient: recipient as Address, claimContract: escrow, chainId: activeChain.id };
  const signer = await recoverClaimSigner(message, signature).catch(() => null);
  if (signer?.toLowerCase() !== claimSigner.toLowerCase()) throw new RelayError("Bad signature.", 400);

  const run = async () => {
    const { request } = await reader.simulateContract({
      account,
      address: escrow,
      abi: claimEscrowAbi,
      functionName: "claim",
      args: [claimSigner, recipient as Address, signature],
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
