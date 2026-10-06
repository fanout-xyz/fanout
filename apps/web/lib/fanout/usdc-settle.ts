import { encodeAbiParameters, keccak256, type Address, type Hex, type LocalAccount, type WalletClient } from "viem";
import {
  AUTHORIZATION_WINDOW_SECONDS,
  authorizationTypedData,
  randomNonce,
  signAuthorization,
  type Authorization,
  type TokenDomain,
} from "./erc3009.ts";

export type { TokenDomain };

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
 * used, so the same signature can't be submitted twice. The signing itself is in erc3009.ts. No
 * imports from "@/": the contract tests sign with this file too.
 */

export type SettleAuthorization = {
  from: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  salt: Hex;
  minOut: bigint;
};

/** How long a signed authorization stays valid: long enough for the relayer, short enough not to linger. */
export const SETTLE_WINDOW_SECONDS = AUTHORIZATION_WINDOW_SECONDS;

/** Accept at most this much below the quote (basis points), in case the pair's price moves between quote and swap. */
export const SETTLE_SLIPPAGE_BPS = 10n;

export function settleNonce(settleContract: Address, salt: Hex, minOut: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }, { type: "uint256" }], [settleContract, salt, minOut]));
}

export const randomSalt = randomNonce;

/** The least output to accept for a quote. */
export function minOutFor(quote: bigint): bigint {
  return (quote * (10_000n - SETTLE_SLIPPAGE_BPS)) / 10_000n;
}

function toAuthorization(settleContract: Address, auth: SettleAuthorization): Authorization {
  const { from, value, validAfter, validBefore } = auth;
  return { from, to: settleContract, value, validAfter, validBefore, nonce: settleNonce(settleContract, auth.salt, auth.minOut) };
}

export function settleTypedData(domain: TokenDomain, settleContract: Address, auth: SettleAuthorization) {
  return authorizationTypedData("ReceiveWithAuthorization", domain, toAuthorization(settleContract, auth));
}

/** Signs with a local account (passkey account, tests) or a wallet client (sign-in account). */
export function signSettle(
  signer: LocalAccount | WalletClient,
  domain: TokenDomain,
  settleContract: Address,
  auth: SettleAuthorization,
): Promise<Hex> {
  return signAuthorization(signer, "ReceiveWithAuthorization", domain, toAuthorization(settleContract, auth));
}
