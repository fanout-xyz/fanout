"use client";

import { createSecp256k1SigningSession, getEvmAddress, getPasskeyPrfOutput, isMeraError } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { getAddress, hexToBytes, keccak256, sha256, toBytes, type Address, type Hex } from "viem";
import { linkMessage, statementMessage, type Passport, type PassportStatement } from "./passport";
import { loadRecord, PasskeyCancelled, PasskeyUnsupported, unlockPasskeyAccount } from "./passkey-account";

/**
 * The passport key: a second key from the same passkey, through its own PRF salt. It never holds
 * money and signs only Earnings Passport statements. One passkey, two keys that can't be derived
 * from each other: proving income never unlocks the key that moves funds.
 */
const PASSPORT_SALT = hexToBytes(sha256(toBytes("fanout.passport.v1")));
const LINKS = "fanout.passportLinks.v1";

type StoredLink = { passportKey: Address; link: Hex };

function readLinks(): Record<string, StoredLink> {
  try {
    return JSON.parse(window.localStorage.getItem(LINKS) ?? "{}") as Record<string, StoredLink>;
  } catch {
    return {};
  }
}

function saveLink(account: Address, value: StoredLink) {
  try {
    window.localStorage.setItem(LINKS, JSON.stringify({ ...readLinks(), [account.toLowerCase()]: value }));
  } catch {
    // Not fatal: next time we ask the account to vouch again.
  }
}

/**
 * Signs a statement for the payee signed in as `email`. One Face ID / Touch ID prompt, plus one
 * more the first time on this device, when the account vouches for its passport key.
 */
export async function signPassport(
  email: string,
  draft: Omit<PassportStatement, "passportKey" | "issuedAt" | "v">,
): Promise<Passport> {
  const record = loadRecord(email);
  if (!record) throw new Error("Set up your account with a passkey first.");

  let prf: Uint8Array;
  try {
    const got = await getPasskeyPrfOutput({
      rpId: window.location.hostname,
      credential: { credentialId: record.credentialId, transports: record.transports },
      prfSalt: PASSPORT_SALT,
    });
    prf = got.prfOutput;
  } catch (err) {
    if (isMeraError(err) && err.code === "PASSKEY_OPERATION_FAILED") throw new PasskeyCancelled("The passkey step was cancelled.");
    if (isMeraError(err)) throw new PasskeyUnsupported("This device can't use your passkey for this.");
    throw err;
  }
  // Hash the PRF output rather than use it raw, so this key is bound to its purpose.
  const keyBytes = hexToBytes(keccak256(prf));
  prf.fill(0);
  const session = createSecp256k1SigningSession({ privateKey: keyBytes });
  keyBytes.fill(0);

  try {
    const signer = toViemAccount(session);
    const passportKey = getAddress(getEvmAddress(session.publicKey));
    const statement: PassportStatement = { v: 1, ...draft, passportKey, issuedAt: Date.now() };

    const known = readLinks()[draft.account.toLowerCase()];
    let link = known && known.passportKey === passportKey ? known.link : undefined;
    if (!link) {
      const unlocked = await unlockPasskeyAccount(email);
      try {
        if (unlocked.address !== getAddress(draft.account)) throw new Error("That passkey opens a different account.");
        link = await unlocked.account.signMessage({ message: linkMessage(draft.account, passportKey) });
      } finally {
        unlocked.end();
      }
      saveLink(draft.account, { passportKey, link });
    }

    const sig = await signer.signMessage({ message: statementMessage(statement) });
    return { statement, link, sig };
  } finally {
    session.end();
  }
}
