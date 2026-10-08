/**
 * Pre-signs a recurring payout for the scheduled-payouts workflow.
 *
 * A CreateBatch authorization works once (one nonce, one deadline), so a payout that repeats every
 * period is N authorizations signed now: period i becomes due at firstAt + i * everySeconds and
 * stays valid for validForSeconds. Each period gets fresh claim keys.
 *
 *   PLATFORM_PRIVATE_KEY=0x... bun scripts/sign-schedule.ts plan.json out-dir
 *
 * plan.json:
 *   { "payees": [{ "email": "ana@example.com", "amount": "12.50" }],
 *     "periods": 4, "firstAt": 1791400000, "everySeconds": 604800,
 *     "validForSeconds": 86400, "claimWindowSeconds": 2592000 }
 *
 * Writes:
 *   out-dir/schedule.json     what the workflow reads (serve it at scheduleUrl, behind a token)
 *   out-dir/claim-links.json  the claim link of every row: secret, send each one to its payee once
 *                             its payout lands (the workflow logs "Scheduled payout <id> ... delivered")
 *
 * Env: BATCH_PAYOUT (default: monad-v3), CHAIN_ID (default 10143), APP_ORIGIN (default the payee app).
 * The platform's Treasury balance must cover each payout when it comes due; until then the workflow waits.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseUnits, type Address, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { signCreateBatch } from "../../apps/web/lib/fanout/batch-authorization.ts";
import { buildClaimLink, generateClaimKey } from "../../apps/web/lib/fanout/claim-keys.ts";
import { randomNonce } from "../../apps/web/lib/fanout/erc3009.ts";
import { hashEmail } from "../../apps/web/lib/email-hash.ts";
import type { Schedule, ScheduledPayout } from "../shared/fanout.ts";

export type Plan = {
  payees: { email: string; amount: string }[];
  periods: number;
  firstAt: number;
  everySeconds: number;
  validForSeconds: number;
  claimWindowSeconds: number;
  /** Prefix for payout ids; default "payout". */
  idPrefix?: string;
};

export type ClaimLinks = { id: string; notBefore: number; links: { email: string; amount: string; link: string }[] }[];

export async function buildSchedule(
  plan: Plan,
  platform: LocalAccount,
  opts: { batchPayout: Address; chainId: number; appOrigin: string },
): Promise<{ schedule: Schedule; claimLinks: ClaimLinks }> {
  if (plan.payees.length < 1 || plan.payees.length > 150) throw new Error("1 to 150 payees per payout");
  if (plan.periods < 1) throw new Error("periods must be at least 1");
  const payouts: ScheduledPayout[] = [];
  const claimLinks: ClaimLinks = [];
  for (let i = 0; i < plan.periods; i++) {
    const id = `${plan.idPrefix ?? "payout"}-${i + 1}`;
    const notBefore = plan.firstAt + i * plan.everySeconds;
    const keys = plan.payees.map(() => generateClaimKey());
    const auth = {
      platform: platform.address,
      claimSigners: keys.map((k) => k.claimSigner),
      amounts: plan.payees.map((p) => parseUnits(p.amount, 6)),
      emailHashes: plan.payees.map((p) => hashEmail(p.email)),
      claimWindow: BigInt(plan.claimWindowSeconds),
      nonce: randomNonce(),
      deadline: BigInt(notBefore + plan.validForSeconds),
    };
    const signature: Hex = await signCreateBatch(platform, opts.batchPayout, opts.chainId, auth);
    payouts.push({
      id,
      notBefore,
      platform: auth.platform,
      claimSigners: [...auth.claimSigners],
      amounts: auth.amounts.map(String),
      emailHashes: [...auth.emailHashes],
      claimWindow: String(auth.claimWindow),
      nonce: auth.nonce,
      deadline: String(auth.deadline),
      signature,
    });
    claimLinks.push({
      id,
      notBefore,
      links: plan.payees.map((p, j) => ({ email: p.email, amount: p.amount, link: buildClaimLink(opts.appOrigin, keys[j].privateKey) })),
    });
  }
  return { schedule: { version: 1, payouts }, claimLinks };
}

if (import.meta.main) {
  const [planPath, outDir] = process.argv.slice(2);
  const key = process.env.PLATFORM_PRIVATE_KEY as Hex | undefined;
  if (!planPath || !outDir || !key) {
    console.error("Usage: PLATFORM_PRIVATE_KEY=0x... bun scripts/sign-schedule.ts plan.json out-dir");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as Plan;
  const { schedule, claimLinks } = await buildSchedule(plan, privateKeyToAccount(key), {
    batchPayout: (process.env.BATCH_PAYOUT ?? "0x01aD7B7A7Ab17ffE4fDFE4644828167702338386") as Address,
    chainId: Number(process.env.CHAIN_ID ?? 10143),
    appOrigin: process.env.APP_ORIGIN ?? "https://wallet.fanout.tech",
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "schedule.json"), JSON.stringify(schedule, null, 2));
  writeFileSync(join(outDir, "claim-links.json"), JSON.stringify(claimLinks, null, 2), { mode: 0o600 });
  console.log(`Signed ${schedule.payouts.length} payout(s) for ${privateKeyToAccount(key).address}: ${join(outDir, "schedule.json")}`);
}
