"use client";

import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialTransport,
  type Secp256k1SigningSession,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { getAddress, type Address, type LocalAccount } from "viem";
import { normalizeEmail } from "@/lib/email-hash";

/**
 * Payee accounts from a passkey, with Mera (https://mera.category.xyz).
 *
 * The passkey's PRF output (32 bytes only this passkey can reproduce) is the root of a normal EVM
 * account: PRF -> BIP-39 -> seed -> BIP-32 m/44'/60'/0'/0/0, as in Mera's docs. No seed phrase to
 * write down, no smart account, no key held by us. The same passkey (synced by iCloud Keychain or
 * Google Password Manager) gives the same account on any device.
 *
 * What we keep in localStorage per email is not secret: the credential ID (so the browser picks
 * the right passkey) and the derived address (so the balance shows without a prompt). The key only
 * exists inside a signing session while the payee is sending, and is zeroed when it ends.
 *
 * Email sign-in (Privy) is unchanged: it's what proves the claimer owns the email a payout was
 * sent to. The passkey account is only where the money lands.
 */

const STORE = "fanout.passkeyAccounts.v1";
const PATH = "m/44'/60'/0'/0/0";

export type PasskeyAccountRecord = {
  address: Address;
  credentialId: string;
  transports?: readonly PasskeyCredentialTransport[];
  createdAt: number;
};

/** A live account that can sign. Call end() when done so the key is zeroed. */
export type UnlockedAccount = { address: Address; account: LocalAccount; end: () => void };

export class PasskeyUnsupported extends Error {}
export class PasskeyCancelled extends Error {}
export class WrongPasskey extends Error {}

function readAll(): Record<string, PasskeyAccountRecord> {
  try {
    return JSON.parse(window.localStorage.getItem(STORE) ?? "{}") as Record<string, PasskeyAccountRecord>;
  } catch {
    return {};
  }
}

export function loadRecord(email: string): PasskeyAccountRecord | null {
  return readAll()[normalizeEmail(email)] ?? null;
}

function saveRecord(email: string, record: PasskeyAccountRecord): void {
  try {
    window.localStorage.setItem(STORE, JSON.stringify({ ...readAll(), [normalizeEmail(email)]: record }));
  } catch {
    // Not fatal: the passkey still reproduces the account; we'd just ask again next visit.
  }
}

export function forgetRecord(email: string): void {
  try {
    const all = readAll();
    delete all[normalizeEmail(email)];
    window.localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // ignore
  }
}

function deriveSession(prfOutput: Uint8Array): Secp256k1SigningSession {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive(PATH);
  seed.fill(0);
  if (!node.privateKey) throw new Error("Couldn't set up the account.");
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  node.wipePrivateData();
  return session;
}

/** Exported for tests: the account a given PRF output opens. */
export function accountFromPrf(prfOutput: Uint8Array): UnlockedAccount {
  return toUnlocked(deriveSession(prfOutput));
}

function toUnlocked(session: Secp256k1SigningSession): UnlockedAccount {
  return { address: getAddress(getEvmAddress(session.publicKey)), account: toViemAccount(session), end: () => session.end() };
}

function translate(err: unknown): never {
  if (isMeraError(err)) {
    if (err.code === "PRF_UNAVAILABLE" || err.code === "CRYPTO_UNAVAILABLE") {
      throw new PasskeyUnsupported("This device or password manager can't create this kind of passkey.");
    }
    if (err.code === "PASSKEY_OPERATION_FAILED") throw new PasskeyCancelled("The passkey step was cancelled.");
  }
  throw err;
}

/** Quick check before offering passkeys. A true here can still fail at the PRF step. */
export function passkeysAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential === "function";
}

/** Creates a new passkey and its account for `email`. One or two Face ID / Touch ID prompts. */
export async function createPasskeyAccount(email: string): Promise<UnlockedAccount> {
  try {
    const created = await createPasskeyWithPrfOutput({
      rp: { id: window.location.hostname, name: "Fanout" },
      user: { name: normalizeEmail(email), displayName: email.trim() },
    });
    const unlocked = toUnlocked(deriveSession(created.prfOutput));
    created.prfOutput.fill(0);
    saveRecord(email, {
      address: unlocked.address,
      credentialId: created.credentialId,
      transports: created.transports,
      createdAt: Date.now(),
    });
    return unlocked;
  } catch (err) {
    translate(err);
  }
}

/**
 * Opens the account with the passkey (one prompt). With no record on this device (new phone,
 * cleared storage), the browser offers any Fanout passkey the payee has, and the synced passkey
 * reproduces the same account.
 */
export async function unlockPasskeyAccount(email: string): Promise<UnlockedAccount> {
  const known = loadRecord(email);
  try {
    const got = await getPasskeyPrfOutput({
      rpId: window.location.hostname,
      ...(known ? { credential: { credentialId: known.credentialId, transports: known.transports } } : {}),
    });
    const unlocked = toUnlocked(deriveSession(got.prfOutput));
    got.prfOutput.fill(0);
    if (known && unlocked.address !== known.address) {
      // Another passkey opens another account; don't let it replace the one holding the money.
      unlocked.end();
      throw new WrongPasskey("That passkey opens a different account. Use the passkey you created when you claimed.");
    }
    saveRecord(email, {
      address: unlocked.address,
      credentialId: got.credentialId,
      transports: known?.credentialId === got.credentialId ? known.transports : undefined,
      createdAt: known?.createdAt ?? Date.now(),
    });
    return unlocked;
  } catch (err) {
    translate(err);
  }
}
