import { verifyTypedData, type Address, type Hex } from "viem";
import { authorizationTypedData } from "@/lib/fanout/erc3009";
import { X402_VERSION, type PaymentPayload, type PaymentRequirements } from "./protocol";

/**
 * Who checks and settles an x402 payment: a facilitator over HTTP (POST /verify and /settle, x402 v2),
 * or our own code when no facilitator serves the network or asset (lib/x402/self-facilitator.ts).
 */

export type VerifyResult = { isValid: true; payer: Address } | { isValid: false; invalidReason: string; payer?: Address };
export type SettleResult = { success: true; payer: Address; transaction: Hex; network: string } | { success: false; errorReason: string; network: string };

export interface Facilitator {
  verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult>;
  settle(payment: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult>;
}

export function httpFacilitator(url: string, fetchImpl: typeof fetch = fetch): Facilitator {
  async function call<T>(path: "verify" | "settle", payment: PaymentPayload, requirements: PaymentRequirements): Promise<T> {
    const res = await fetchImpl(`${url}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload: payment, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(path === "settle" ? 45_000 : 15_000),
    });
    const body = (await res.json().catch(() => null)) as T | null;
    if (!body) throw new Error(`The payment service answered ${res.status} without a result.`);
    return body;
  }
  return {
    async verify(payment, requirements) {
      const r = await call<{ isValid?: boolean; invalidReason?: string; payer?: Address }>("verify", payment, requirements);
      return r.isValid && r.payer ? { isValid: true, payer: r.payer } : { isValid: false, invalidReason: r.invalidReason ?? "invalid_payment", payer: r.payer };
    },
    async settle(payment, requirements) {
      const r = await call<{ success?: boolean; errorReason?: string; payer?: Address; transaction?: Hex; network?: string }>("settle", payment, requirements);
      return r.success && r.payer && r.transaction
        ? { success: true, payer: r.payer, transaction: r.transaction, network: r.network ?? requirements.network }
        : { success: false, errorReason: r.errorReason ?? "settle_failed", network: r.network ?? requirements.network };
    },
  };
}

/** Checks the payer's ERC-3009 signature against the token's EIP-712 domain. */
export async function verifyAuthorizationSignature(payment: PaymentPayload, requirements: PaymentRequirements, chainId: number): Promise<boolean> {
  const a = payment.payload.authorization;
  const typedData = authorizationTypedData(
    "TransferWithAuthorization",
    { name: requirements.extra.name, version: requirements.extra.version, chainId, verifyingContract: requirements.asset },
    { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
  );
  return verifyTypedData({ address: a.from, signature: payment.payload.signature, ...typedData }).catch(() => false);
}

/**
 * The local demo's facilitator: checks the signature for real, remembers nonces so an authorization
 * works once, and "settles" without touching a chain.
 */
export function mockFacilitator(chainId: number, used: Set<string> = new Set()): Facilitator {
  const nonceKey = (p: PaymentPayload) => `${p.payload.authorization.from.toLowerCase()}:${p.payload.authorization.nonce}`;
  return {
    async verify(payment, requirements) {
      const payer = payment.payload.authorization.from;
      if (used.has(nonceKey(payment))) return { isValid: false, invalidReason: "invalid_exact_evm_payload_authorization_nonce_used", payer };
      if (!(await verifyAuthorizationSignature(payment, requirements, chainId))) {
        return { isValid: false, invalidReason: "invalid_exact_evm_payload_signature", payer };
      }
      return { isValid: true, payer };
    },
    async settle(payment, requirements) {
      const check = await this.verify(payment, requirements);
      if (!check.isValid) return { success: false, errorReason: check.invalidReason, network: requirements.network };
      used.add(nonceKey(payment));
      const tx = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
      return { success: true, payer: check.payer, transaction: tx, network: requirements.network };
    },
  };
}
