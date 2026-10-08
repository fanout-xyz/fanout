import {
  bytesToHex,
  consensusIdenticalAggregation,
  CronCapability,
  encodeCallMsg,
  EVMClient,
  getNetwork,
  handler,
  HTTPClient,
  LATEST_BLOCK_NUMBER,
  ok,
  prepareReportRequest,
  text,
  TxStatus,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { z } from "zod";

import {
  BATCH_PAYOUT_ABI,
  CREATE_BATCH,
  CREATE_BATCH_BODY_PARAMS,
  REPORT_PARAMS,
  TREASURY_ABI,
  type ScheduledPayout,
} from "../shared/fanout";

/**
 * Runs a platform's scheduled payouts. A CreateBatch authorization can't be reused (one nonce,
 * one deadline), so a recurring payout is a list of authorizations the platform signs ahead of time,
 * one per period, each with its own nonce, a `notBefore` and a deadline (cre/scripts/sign-schedule.ts).
 * The list is a JSON file served over HTTPS (`scheduleUrl`). On every cron tick the workflow:
 *   1. fetches the schedule (HTTP capability, identical consensus),
 *   2. keeps entries that are due (notBefore <= now < deadline - margin),
 *   3. reads BatchPayout.authorizationState to drop ones already used or cancelled, reads the
 *      platform's Treasury balance, and dry-runs createBatchFor (EVM read capability),
 *   4. sends a CREATE_BATCH report for each one that would succeed (up to `maxPerRun`) to
 *      FanoutKeeper, which calls BatchPayout.createBatchFor.
 *
 * The schedule host can't change a payout: BatchPayout checks the platform's signature over every
 * row, the claim window, the nonce and the deadline. It can withhold or delay entries, or (since an
 * authorization has no start time onchain) let someone submit one before its notBefore, which pays
 * the same approved people early. Keep the file private (bearer token, `scheduleTokenSecret`) and
 * cancel unwanted entries with BatchPayout.cancelAuthorization.
 */

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "not an address");
const uint = z.string().regex(/^\d+$/);
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const configSchema = z.object({
  /** Cron expression, e.g. every 5 minutes: "0 *\/5 * * * *". */
  schedule: z.string(),
  scheduleUrl: z.string().url(),
  /** Optional CRE secret id holding a bearer token for scheduleUrl. */
  scheduleTokenSecret: z.string().optional(),
  chainName: z.string(),
  /** FanoutKeeper (ignition module FanoutKeeper); the zero address placeholder is refused. */
  keeper: address.refine((a) => !/^0x0{40}$/.test(a), "set keeper to the deployed FanoutKeeper"),
  batchPayout: address,
  treasury: address,
  /** Skip entries whose deadline is closer than this (seconds), so a submitted report can't land late. */
  deadlineMarginSeconds: z.number().int().min(0),
  maxPerRun: z.number().int().min(1).max(5),
  gasLimit: uint,
});
export type Config = z.infer<typeof configSchema>;

const payoutSchema = z.object({
  id: z.string(),
  notBefore: z.number().int(),
  platform: address,
  claimSigners: z.array(address).min(1).max(150),
  amounts: z.array(uint).min(1).max(150),
  emailHashes: z.array(hex32).min(1).max(150),
  claimWindow: uint,
  nonce: hex32,
  deadline: uint,
  signature: z.string().regex(/^0x[0-9a-fA-F]*$/),
});
const scheduleSchema = z.object({ version: z.literal(1), payouts: z.array(payoutSchema) });

/** Runs on each node: the schedule file's text, so identical consensus compares exact bytes. */
export function fetchSchedule(sendRequester: HTTPSendRequester, config: Config, token: string): string {
  const response = sendRequester
    .sendRequest({
      url: config.scheduleUrl,
      method: "GET",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
    .result();
  if (!ok(response)) throw new Error(`Schedule returned HTTP ${response.statusCode}`);
  return text(response);
}

/** Entries due at `now` (unix seconds), earliest first. */
export function duePayouts(payouts: readonly ScheduledPayout[], now: number, marginSeconds: number): ScheduledPayout[] {
  return payouts
    .filter((p) => p.notBefore <= now && BigInt(p.deadline) > BigInt(now + marginSeconds))
    .sort((a, b) => a.notBefore - b.notBefore || a.id.localeCompare(b.id));
}

function createBatchArgs(p: ScheduledPayout) {
  if (p.amounts.length !== p.claimSigners.length || p.emailHashes.length !== p.claimSigners.length) {
    throw new Error(`Scheduled payout ${p.id}: row arrays differ in length`);
  }
  return [
    getAddress(p.platform),
    p.claimSigners.map((s) => getAddress(s)),
    p.amounts.map(BigInt),
    p.emailHashes as Hex[],
    BigInt(p.claimWindow),
    { nonce: p.nonce as Hex, deadline: BigInt(p.deadline), signature: p.signature as Hex },
  ] as const;
}

export function encodeCreateBatchReport(p: ScheduledPayout): Hex {
  const body = encodeAbiParameters(CREATE_BATCH_BODY_PARAMS, createBatchArgs(p));
  return encodeAbiParameters(REPORT_PARAMS, [CREATE_BATCH, body]);
}

export function onCron(runtime: Runtime<Config>): string {
  const config = runtime.config;
  const now = Math.floor(runtime.now().getTime() / 1000);
  const token = config.scheduleTokenSecret ? runtime.getSecret({ id: config.scheduleTokenSecret }).result().value : "";

  const body = new HTTPClient()
    .sendRequest(runtime, fetchSchedule, consensusIdenticalAggregation<string>())(config, token)
    .result();
  const schedule = scheduleSchema.parse(JSON.parse(body));
  const due = duePayouts(schedule.payouts, now, config.deadlineMarginSeconds);
  if (due.length === 0) {
    runtime.log(`No scheduled payout due at ${now} (${schedule.payouts.length} in the schedule)`);
    return "nothing due";
  }

  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainName });
  if (!network) throw new Error(`Unknown chain name: ${config.chainName}`);
  const evm = new EVMClient(network.chainSelector.selector);
  const read = (to: string, data: Hex) =>
    bytesToHex(
      evm
        .callContract(runtime, {
          call: encodeCallMsg({ from: getAddress(config.keeper) as Address, to: getAddress(to) as Address, data }),
          blockNumber: LATEST_BLOCK_NUMBER,
        })
        .result().data,
    );

  const sent: string[] = [];
  for (const p of due) {
    if (sent.length >= config.maxPerRun) break;
    const used = decodeFunctionResult({
      abi: BATCH_PAYOUT_ABI,
      functionName: "authorizationState",
      data: read(config.batchPayout, encodeFunctionData({ abi: BATCH_PAYOUT_ABI, functionName: "authorizationState", args: [getAddress(p.platform), p.nonce as Hex] })),
    });
    if (used) continue; // Already paid, or cancelled by the platform.

    const total = p.amounts.reduce((sum, a) => sum + BigInt(a), 0n);
    const balance = decodeFunctionResult({
      abi: TREASURY_ABI,
      functionName: "balanceOf",
      data: read(config.treasury, encodeFunctionData({ abi: TREASURY_ABI, functionName: "balanceOf", args: [getAddress(p.platform)] })),
    });
    if (balance < total) {
      runtime.log(`Scheduled payout ${p.id}: platform balance ${balance} is below the total ${total}, waiting for a deposit`);
      continue;
    }

    // A dry run from the keeper catches a bad signature or rows before any gas is spent on them.
    try {
      read(config.batchPayout, encodeFunctionData({ abi: BATCH_PAYOUT_ABI, functionName: "createBatchFor", args: createBatchArgs(p) }));
    } catch (e) {
      runtime.log(`Scheduled payout ${p.id}: createBatchFor would revert, skipping (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }

    const report = runtime.report(prepareReportRequest(encodeCreateBatchReport(p))).result();
    const write = evm
      .writeReport(runtime, { receiver: config.keeper, report, gasConfig: { gasLimit: config.gasLimit } })
      .result();
    const txHash = bytesToHex(write.txHash ?? new Uint8Array(32));
    if (write.txStatus !== TxStatus.SUCCESS) {
      throw new Error(`Scheduled payout ${p.id} not delivered (status ${write.txStatus}): ${write.errorMessage ?? "unknown error"}`);
    }
    runtime.log(`Scheduled payout ${p.id}: ${p.claimSigners.length} row(s), ${total} AUSD units, delivered in ${txHash}`);
    sent.push(p.id);
  }
  return sent.length ? `submitted ${sent.join(", ")}` : "nothing submittable";
}

export const initWorkflow = (config: Config) => [
  handler(new CronCapability().trigger({ schedule: config.schedule }), onCron),
];
