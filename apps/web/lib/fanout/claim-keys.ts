import {
  encodeAbiParameters,
  isHex,
  keccak256,
  recoverMessageAddress,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * One-time claim keys.
 *
 * Each payout row gets a fresh keypair at batch creation. The address (claimSigner)
 * goes onchain; the private key only ever lives in the claim link's URL fragment
 * (/claim#k=...), which browsers never send to a server.
 *
 * To claim, the key signs (recipient, verifying contract, chainId):
 *
 *   digest    = keccak256(abi.encode(address recipient, address claimContract, uint256 chainId))
 *   signature = personal_sign(digest)   // EIP-191: "\x19Ethereum Signed Message:\n32" ++ digest
 *
 * Solidity side (OpenZeppelin), inside the claim contract:
 *
 *   bytes32 digest = keccak256(abi.encode(recipient, address(this), block.chainid));
 *   address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(digest), signature);
 *   require(signer == claimSigner, "bad signature");
 *
 * Binding the recipient stops front-running (a watcher can't swap in their own address),
 * and binding contract + chainId stops replay elsewhere. The contract must mark the
 * claimSigner as used so the same signature can't be submitted twice.
 */

export type ClaimKey = { privateKey: Hex; claimSigner: Address };

export type ClaimMessage = {
  recipient: Address;
  claimContract: Address;
  chainId: number;
};

export function generateClaimKey(): ClaimKey {
  const privateKey = generatePrivateKey();
  return { privateKey, claimSigner: privateKeyToAccount(privateKey).address };
}

export function claimSignerFromKey(privateKey: Hex): Address {
  return privateKeyToAccount(privateKey).address;
}

export function claimDigest({ recipient, claimContract, chainId }: ClaimMessage): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [recipient, claimContract, BigInt(chainId)],
    ),
  );
}

export async function signClaim(privateKey: Hex, message: ClaimMessage): Promise<Hex> {
  return privateKeyToAccount(privateKey).signMessage({ message: { raw: claimDigest(message) } });
}

export async function recoverClaimSigner(message: ClaimMessage, signature: Hex): Promise<Address> {
  return recoverMessageAddress({ message: { raw: claimDigest(message) }, signature });
}

// --- Verifier co-signature ---------------------------------------------------
//
// The link key alone isn't enough to claim: Fanout's verifier also signs, but only after the
// server has checked that the claimer signed in with the email the payout was sent to.
//
//   digest       = keccak256(abi.encode(VERIFY_TAG, claimSigner, recipient, claimContract, chainId))
//   verification = personal_sign(digest)   // by the verifier key, server-side only

export const VERIFY_TAG = keccak256(toBytes("fanout.claim.verify"));

export type VerifyMessage = ClaimMessage & { claimSigner: Address };

export function verifyDigest({ claimSigner, recipient, claimContract, chainId }: VerifyMessage): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
      [VERIFY_TAG, claimSigner, recipient, claimContract, BigInt(chainId)],
    ),
  );
}

export async function signVerification(verifierKey: Hex, message: VerifyMessage): Promise<Hex> {
  return privateKeyToAccount(verifierKey).signMessage({ message: { raw: verifyDigest(message) } });
}

// --- Links -----------------------------------------------------------------

export function buildClaimLink(origin: string, privateKey: Hex): string {
  return `${origin}/claim#k=${privateKey.slice(2)}`;
}

/** Reads the key from a location hash like "#k=abc...". Returns null if missing or malformed. */
export function parseClaimFragment(hash: string): Hex | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const raw = params.get("k");
  if (!raw) return null;
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  return isHex(key) && key.length === 66 ? key : null;
}
