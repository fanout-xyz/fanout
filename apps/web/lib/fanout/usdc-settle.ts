import { encodeAbiParameters, keccak256, toHex, type Address, type Hex, type LocalAccount, type WalletClient } from "viem";

/**
 * Taking dollars as USDC (smart-contract/contracts/SettleToUsdc.sol).
 *
 * The payee signs one ERC-3009 ReceiveWithAuthorization (EIP-712) moving `value` AUSD to the
 * SettleToUsdc contract. Our relayer submits SettleToUsdc.settle(), which collects the AUSD with
 * that signature and swaps it to USDC on Agora's stable-swap pair, paid straight back to the payee.
 *
 * The nonce binds the least USDC the payee accepts:
 *
 *   nonce = keccak256(abi.encode(address settleContract, bytes32 salt, uint256 minOut))
 *
 * so a submitter can't lower minOut without invalidating the signature. AUSD itself marks the nonce
 * used, so the same signature can't be submitted twice. No imports from "@/": the contract tests
 * sign with this file too.
 */

export type SettleAuthorization = {
  from: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  salt: Hex;
  minOut: bigint;
};

/** AUSD's EIP-712 domain. Agora AUSD reports name "Agora Dollar", version "1" (eip712Domain()). */
export type TokenDomain = { name: string; version: string; chainId: number; verifyingContract: Address };

export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** How long a signed authorization stays valid: long enough for the relayer, short enough not to linger. */
export const SETTLE_WINDOW_SECONDS = 10n * 60n;

/** Accept at most this much below the quote (basis points), in case the pair's price moves between quote and swap. */
export const SETTLE_SLIPPAGE_BPS = 10n;

export function settleNonce(settleContract: Address, salt: Hex, minOut: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }, { type: "uint256" }], [settleContract, salt, minOut]));
}

export function randomSalt(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** The least output to accept for a quote. */
export function minOutFor(quote: bigint): bigint {
  return (quote * (10_000n - SETTLE_SLIPPAGE_BPS)) / 10_000n;
}

export function settleTypedData(domain: TokenDomain, settleContract: Address, auth: SettleAuthorization) {
  return {
    domain,
    types: receiveWithAuthorizationTypes,
    primaryType: "ReceiveWithAuthorization" as const,
    message: {
      from: auth.from,
      to: settleContract,
      value: auth.value,
      validAfter: auth.validAfter,
      validBefore: auth.validBefore,
      nonce: settleNonce(settleContract, auth.salt, auth.minOut),
    },
  };
}

/** Signs with a local account (passkey account, tests) or a wallet client (sign-in account). */
export function signSettle(
  signer: LocalAccount | WalletClient,
  domain: TokenDomain,
  settleContract: Address,
  auth: SettleAuthorization,
): Promise<Hex> {
  const typedData = settleTypedData(domain, settleContract, auth);
  if ("type" in signer && signer.type === "local") return (signer as LocalAccount).signTypedData(typedData);
  const wc = signer as WalletClient;
  return wc.signTypedData({ ...typedData, account: wc.account ?? auth.from });
}
