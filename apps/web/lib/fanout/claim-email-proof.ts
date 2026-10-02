import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

/**
 * Proof that the account which made some payouts asks for their claim emails. Platforms are
 * recognised by their sign-in wallet; a payee paying someone by email sends from their passkey
 * account, which sign-in doesn't know, so that account signs this message instead.
 */
export type ClaimEmailProof = { address: Address; signature: Hex };

export function claimEmailProofMessage(address: Address, claimSigners: readonly Address[]): string {
  const claims = [...claimSigners].map((s) => getAddress(s)).sort().join(",");
  return `Fanout: email the claim links for payments I sent.\nFrom: ${getAddress(address)}\nClaims: ${claims}`;
}

export function parseProof(raw: unknown): ClaimEmailProof | undefined {
  const p = raw as { address?: unknown; signature?: unknown } | null | undefined;
  if (!p || typeof p.address !== "string" || !isAddress(p.address) || typeof p.signature !== "string" || !isHex(p.signature)) {
    return undefined;
  }
  return { address: getAddress(p.address), signature: p.signature };
}
