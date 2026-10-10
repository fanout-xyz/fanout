import "server-only";
import { config } from "@/lib/config";

/**
 * Encrypts the claim keys of an agent's payout while they're stored (AES-256-GCM, Web Crypto).
 *
 * An agent's payout is built on the server, so its claim keys are made here too, not in the
 * platform's browser. They're kept, encrypted with AGENT_SECRET, so Fanout can email the claim links
 * once the platform approves and send reminders later; they expire with the payout's claim window.
 * The local demo uses a fixed key when AGENT_SECRET isn't set.
 */

const MOCK_SECRET = "fanout-local-demo-agent-secret";

export function agentSecret(env: Record<string, string | undefined> = process.env, useMock = config.useMock): string | null {
  const s = env.AGENT_SECRET?.trim();
  if (s && s.length >= 32) return s;
  return useMock ? MOCK_SECRET : null;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`fanout.agent.seal:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export async function seal(secret: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(plaintext)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function unseal(secret: string, sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Unknown sealed format.");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(iv, "base64") }, await aesKey(secret), Buffer.from(ct, "base64"));
  return new TextDecoder().decode(pt);
}
