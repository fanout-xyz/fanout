// Writes a payout CSV (email, amount, note) to upload on the New payout page.
//
// Every row gets a claim email once the payout is sent, so the addresses must be inboxes you
// control. Pick one:
//   --to you@yourdomain.com      plus-addressed copies of ONE address: you+1@..., you+2@..., ...
//                                (Gmail, Google Workspace, Fastmail, iCloud and Outlook deliver
//                                these to you@...; check your provider supports "+" tags first)
//   --list emails.txt            your own list: one address per line, or a CSV with email first
// Made-up and reserved domains (example.com, *.test, ...) are refused, and the domain must have
// mail (MX) records, so no claim email bounces.
//
// Options:
//   --rows N         rows to write, 1-150 (default 150)
//   --amount 1.00    the same amount on every row, or
//   --min 1.00 --max 5.00   random amounts in this range (default $1.00-$3.00)
//   --seed N         seed for the random amounts (default 1), so a rerun gives the same file
//   --note "..."     note on every row (default "Demo payout")
//   --out file.csv   where to write (default payout-<rows>.csv in the current folder; "-" for stdout)
//
// Usage (from anywhere in the repo; paths are relative to where you run it):
//   pnpm --filter web demo-csv --to you@yourdomain.com
//   pnpm --filter web demo-csv --list ~/team-emails.txt --rows 40 --amount 2.50
import { resolveMx } from "node:dns/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  addressesFromList,
  DEMO_DEFAULT_ROWS,
  DemoCsvError,
  demoAmounts,
  parseDollarsToCents,
  plusAddresses,
  toPayoutCsv,
} from "../lib/demo-payout-csv.ts";

/** pnpm runs package scripts from apps/web; resolve paths against where the command was typed. */
const fromCwd = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);

/** Resend's free plan sends at most 100 emails a day; larger payouts need a paid plan. */
const FREE_DAILY_EMAILS = 100;

async function assertDomainsReceiveMail(emails: string[]) {
  const domains = [...new Set(emails.map((e) => e.slice(e.lastIndexOf("@") + 1)))];
  for (const domain of domains) {
    const mx = await resolveMx(domain).catch(() => []);
    if (mx.length === 0) throw new DemoCsvError(`"${domain}" has no mail servers (MX records), so claim emails would bounce.`);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      to: { type: "string" },
      list: { type: "string" },
      rows: { type: "string", default: String(DEMO_DEFAULT_ROWS) },
      amount: { type: "string" },
      min: { type: "string", default: "1.00" },
      max: { type: "string", default: "3.00" },
      seed: { type: "string", default: "1" },
      note: { type: "string", default: "Demo payout" },
      out: { type: "string" },
    },
  });

  if (!!values.to === !!values.list) throw new DemoCsvError("Pass exactly one of --to you@yourdomain.com or --list emails.txt.");
  const rows = Number(values.rows);
  const emails = values.to ? plusAddresses(values.to, rows) : addressesFromList(readFileSync(fromCwd(values.list!), "utf8"), rows);
  await assertDomainsReceiveMail(emails);

  const fixed = values.amount ? parseDollarsToCents(values.amount) : undefined;
  const cents = fixed
    ? emails.map(() => fixed)
    : demoAmounts(rows, { minCents: parseDollarsToCents(values.min), maxCents: parseDollarsToCents(values.max), seed: Number(values.seed) });
  const csv = toPayoutCsv(emails.map((email, i) => ({ email, cents: cents[i], note: values.note })));

  const out = values.out ?? `payout-${rows}.csv`;
  if (out === "-") process.stdout.write(csv);
  else writeFileSync(fromCwd(out), csv);

  const total = cents.reduce((a, b) => a + b, 0) / 100;
  console.error(`${out === "-" ? "Wrote" : `Wrote ${out}:`} ${rows} rows, $${total.toFixed(2)} in total. Fund at least that much before sending.`);
  if (rows > FREE_DAILY_EMAILS) {
    console.error(`Sending this payout emails ${rows} people. Resend's free plan stops at ${FREE_DAILY_EMAILS} emails a day, so use a paid plan (or copy the remaining links from the payout page).`);
  }
}

main().catch((err) => {
  console.error(err instanceof DemoCsvError ? err.message : err);
  process.exit(1);
});
