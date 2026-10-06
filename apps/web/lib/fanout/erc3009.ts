import { toHex, type Address, type Hex, type LocalAccount, type WalletClient } from "viem";

/**
 * ERC-3009 authorizations for AUSD: the payee signs one EIP-712 message and someone else (our
 * relayer) submits it and pays the gas. Used to change dollars to USDC (usdc-settle.ts,
 * ReceiveWithAuthorization) and to send dollars to someone (TransferWithAuthorization).
 *
 * AUSD marks each nonce used, so a signed authorization can only ever move money once, and only
 * between validAfter and validBefore. No imports from "@/": the contract tests sign with this file too.
 */

/** A token's EIP-712 domain. Agora AUSD reports name "Agora Dollar", version "1" (eip712Domain()). */
export type TokenDomain = { name: string; version: string; chainId: number; verifyingContract: Address };

/**
 * TransferWithAuthorization: anyone may submit it, the money goes to `to`.
 * ReceiveWithAuthorization: only `to` may submit it (for contracts that collect and act on the money).
 */
export type AuthorizationKind = "TransferWithAuthorization" | "ReceiveWithAuthorization";

export type Authorization = {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
};

const authorizationFields = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

/** How long a signed authorization stays valid: long enough for the relayer, short enough not to linger. */
export const AUTHORIZATION_WINDOW_SECONDS = 10n * 60n;

/** A fresh random 32-byte nonce (or salt). */
export function randomNonce(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function authorizationTypedData<K extends AuthorizationKind>(kind: K, domain: TokenDomain, auth: Authorization) {
  return {
    domain,
    types: { [kind]: authorizationFields } as { [P in K]: typeof authorizationFields },
    primaryType: kind,
    message: {
      from: auth.from,
      to: auth.to,
      value: auth.value,
      validAfter: auth.validAfter,
      validBefore: auth.validBefore,
      nonce: auth.nonce,
    },
  };
}

/** Signs with a local account (passkey account, tests) or a wallet client (sign-in account). */
export function signAuthorization(signer: LocalAccount | WalletClient, kind: AuthorizationKind, domain: TokenDomain, auth: Authorization): Promise<Hex> {
  const typedData = authorizationTypedData(kind, domain, auth);
  if ("type" in signer && signer.type === "local") return (signer as LocalAccount).signTypedData(typedData);
  const wc = signer as WalletClient;
  return wc.signTypedData({ ...typedData, account: wc.account ?? auth.from });
}
