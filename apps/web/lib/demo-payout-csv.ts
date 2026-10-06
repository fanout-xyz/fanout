/**
 * Builds payout CSVs (email, amount, note) for trying out large payouts on the New payout page.
 * Used by scripts/demo-payout-csv.ts. Kept free of imports so the script runs with plain `node`.
 *
 * Every payee gets a claim email after a payout, so addresses must be real inboxes the person
 * running the payout controls: plus-addressed variants of one address (you+1@domain, ...) or a
 * list they supply. Made-up and reserved domains are refused, since mail to them bounces and
 * hurts the sending domain's reputation.
 */

/** Same limit as the New payout page and BatchPayout.MAX_ROWS (see lib/csv.ts). */
export const DEMO_MAX_ROWS = 150;
export const DEMO_DEFAULT_ROWS = 150;

export class DemoCsvError extends Error {
  override name = "DemoCsvError";
}

const EMAIL_RE = /^[^\s@,"]+@[^\s@,"]+\.[^\s@,"]{2,}$/;

/** Domains and TLDs that never receive mail (RFC 2606 / 6761) or are obviously placeholders. */
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org", "test.com", "email.com", "domain.com", "fake.com", "mailinator.com"]);
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local", "internal", "lan", "home", "corp"]);

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** Throws unless `email` is a well-formed address on a domain that can receive mail. */
export function assertDeliverableAddress(email: string): void {
  if (!EMAIL_RE.test(email)) throw new DemoCsvError(`"${email}" isn't a valid email address.`);
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (RESERVED_DOMAINS.has(domain) || RESERVED_TLDS.has(tld)) {
    throw new DemoCsvError(`Claim emails to "${domain}" would bounce or reach strangers. Use an inbox you control.`);
  }
}

/** you@domain -> you+1@domain ... you+n@domain. Every email lands in the one inbox. */
export function plusAddresses(base: string, count: number): string[] {
  const email = normalize(base);
  assertDeliverableAddress(email);
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  if (local.includes("+")) throw new DemoCsvError(`Pass the address without a "+" tag (e.g. ${local.split("+")[0]}${email.slice(at)}).`);
  assertCount(count);
  return Array.from({ length: count }, (_, i) => `${local}+${i + 1}${email.slice(at)}`);
}

/**
 * Addresses from a file: one per line, or a CSV whose first column is the email (a header row
 * is skipped). Blank lines and lines starting with # are ignored. Duplicates are dropped.
 * Returns the first `count`, and fails if there aren't enough.
 */
export function addressesFromList(text: string, count: number): string[] {
  assertCount(count);
  const seen = new Set<string>();
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const email = normalize(line.split(",")[0].replace(/^"|"$/g, ""));
    if (email === "email") continue;
    assertDeliverableAddress(email);
    seen.add(email);
  }
  if (seen.size < count) {
    throw new DemoCsvError(`The list has ${seen.size} different address${seen.size === 1 ? "" : "es"}; ${count} are needed.`);
  }
  return [...seen].slice(0, count);
}

function assertCount(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > DEMO_MAX_ROWS) {
    throw new DemoCsvError(`Rows must be a whole number from 1 to ${DEMO_MAX_ROWS}.`);
  }
}

/** Small deterministic PRNG (mulberry32), so the same seed gives the same file. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` amounts in whole cents between minCents and maxCents inclusive. */
export function demoAmounts(count: number, opts: { minCents: number; maxCents: number; seed?: number }): number[] {
  const { minCents, maxCents } = opts;
  if (!Number.isInteger(minCents) || !Number.isInteger(maxCents) || minCents < 1 || maxCents < minCents) {
    throw new DemoCsvError("Amounts must be at least $0.01, with min no more than max.");
  }
  const next = random(opts.seed ?? 1);
  return Array.from({ length: count }, () => minCents + Math.floor(next() * (maxCents - minCents + 1)));
}

/** "12.5" / "$3" -> cents. Throws for anything else. */
export function parseDollarsToCents(input: string): number {
  const cleaned = input.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new DemoCsvError(`"${input}" isn't a dollar amount (use 1.50).`);
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

const csvField = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The CSV the New payout page reads. */
export function toPayoutCsv(rows: { email: string; cents: number; note?: string }[]): string {
  const lines = rows.map((r) => [r.email, (r.cents / 100).toFixed(2), csvField(r.note ?? "")].join(","));
  return ["email,amount,note", ...lines].join("\n") + "\n";
}
