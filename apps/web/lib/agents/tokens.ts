import { sha256, toBytes, type Hex } from "viem";

/**
 * Agent keys: the bearer token an AI agent sends to /api/mcp. 32 random bytes, shown to the
 * platform once. Fanout keeps only its SHA-256, so a leaked database can't be used to pay anyone;
 * a lost token is replaced by creating a new key.
 */

export const AGENT_TOKEN_PREFIX = "fo_agent_";
const TOKEN_RE = /^fo_agent_[A-Za-z0-9_-]{43}$/;

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateAgentToken(): string {
  return AGENT_TOKEN_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function isAgentToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

/** What's stored and looked up. The token is high-entropy, so a plain hash is enough (no salt, no KDF). */
export function hashAgentToken(token: string): Hex {
  return sha256(toBytes(token));
}

/** The last 4 characters, so the dashboard can tell keys apart without holding them. */
export function tokenHint(token: string): string {
  return token.slice(-4);
}

/** "Bearer fo_agent_..." -> the token, or null. */
export function bearerToken(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m && isAgentToken(m[1]) ? m[1] : null;
}

/** A random id for payout requests: "req_" + 16 random bytes. */
export function randomId(prefix: string): string {
  return prefix + base64url(crypto.getRandomValues(new Uint8Array(16)));
}
