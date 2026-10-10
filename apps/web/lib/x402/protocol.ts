import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

/**
 * x402 v2 over HTTP (https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md and
 * specs/transports-v2/http.md): a 402 response carries the payment requirements, base64 JSON in the
 * PAYMENT-REQUIRED header; the client retries with its signed payment in PAYMENT-SIGNATURE; a paid
 * response carries the settlement in PAYMENT-RESPONSE. Only the "exact" scheme on EVM networks
 * (an ERC-3009 transferWithAuthorization the payer signs) is handled here.
 */

export const X402_VERSION = 2;
export const HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
export const HEADER_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";

export type PaymentRequirements = {
  scheme: "exact";
  /** CAIP-2, e.g. "eip155:10143" (Monad testnet). */
  network: string;
  /** Atomic units of `asset`, as a decimal string. */
  amount: string;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  /** The token's EIP-712 domain name and version, which the payer signs with. */
  extra: { name: string; version: string };
};

export type ResourceInfo = { url: string; description?: string; mimeType?: string };

export type PaymentRequired = {
  x402Version: typeof X402_VERSION;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
};

export type ExactEvmAuthorization = { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex };

export type PaymentPayload = {
  x402Version: typeof X402_VERSION;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: { signature: Hex; authorization: ExactEvmAuthorization };
  extensions?: Record<string, unknown>;
};

export type SettlementResponse = {
  success: boolean;
  errorReason?: string;
  payer?: Address;
  transaction: string;
  network: string;
  amount?: string;
};

export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeHeader<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export class PaymentInvalid extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

const uint = (v: unknown) => typeof v === "string" && /^\d{1,78}$/.test(v);
const sameAddress = (a: unknown, b: string) => typeof a === "string" && isAddress(a) && getAddress(a) === getAddress(b);

/**
 * Parses a PAYMENT-SIGNATURE header and checks it pays exactly `required` (scheme, network, asset,
 * amount, recipient). Signature, balance and nonce are the facilitator's job (lib/x402/facilitator.ts).
 */
export function parsePayment(header: string | null, required: PaymentRequirements, nowSeconds: bigint): PaymentPayload {
  if (!header) throw new PaymentInvalid("missing_payment", "Send the payment in the PAYMENT-SIGNATURE header.");
  const p = decodeHeader<PaymentPayload>(header);
  if (!p || typeof p !== "object") throw new PaymentInvalid("invalid_payload", "PAYMENT-SIGNATURE isn't base64 JSON.");
  if (p.x402Version !== X402_VERSION) throw new PaymentInvalid("invalid_x402_version", `Only x402 version ${X402_VERSION} is accepted.`);
  const a = p.accepted;
  if (!a || a.scheme !== "exact" || a.network !== required.network) {
    throw new PaymentInvalid("unsupported_scheme", `Pay with scheme "exact" on ${required.network}.`);
  }
  if (!sameAddress(a.asset, required.asset) || !sameAddress(a.payTo, required.payTo) || a.amount !== required.amount) {
    throw new PaymentInvalid("invalid_payment_requirements", "The payment doesn't match this request's requirements. Ask again without PAYMENT-SIGNATURE for a fresh quote.");
  }
  const auth = p.payload?.authorization;
  const signature = p.payload?.signature;
  if (!auth || typeof signature !== "string" || !isHex(signature)) throw new PaymentInvalid("invalid_payload", "The payment has no signed authorization.");
  if (typeof auth.from !== "string" || !isAddress(auth.from) || !sameAddress(auth.to, required.payTo)) throw new PaymentInvalid("invalid_payload", "The authorization pays the wrong address.");
  if (!uint(auth.value) || auth.value !== required.amount) throw new PaymentInvalid("invalid_exact_evm_payload_authorization_value", "The authorization is for the wrong amount.");
  if (!uint(auth.validAfter) || !uint(auth.validBefore) || typeof auth.nonce !== "string" || !isHex(auth.nonce) || auth.nonce.length !== 66) {
    throw new PaymentInvalid("invalid_payload", "The authorization is malformed.");
  }
  if (BigInt(auth.validAfter) > nowSeconds) throw new PaymentInvalid("invalid_exact_evm_payload_authorization_valid_after", "The authorization isn't valid yet.");
  if (BigInt(auth.validBefore) < nowSeconds + 6n) throw new PaymentInvalid("invalid_exact_evm_payload_authorization_valid_before", "The authorization has expired. Sign a new one.");
  return {
    ...p,
    payload: { signature: signature as Hex, authorization: { ...auth, from: getAddress(auth.from), to: getAddress(auth.to) } },
  };
}
