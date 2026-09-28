import { keccak256, toBytes, type Hex } from "viem";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** keccak256 of the lowercased, trimmed email. Metadata only, never used to authorize a claim. */
export function hashEmail(email: string): Hex {
  return keccak256(toBytes(normalizeEmail(email)));
}
