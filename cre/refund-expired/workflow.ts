import {
  bytesToHex,
  consensusIdenticalAggregation,
  CronCapability,
  EVMClient,
  getNetwork,
  handler,
  HTTPClient,
  ok,
  prepareReportRequest,
  text,
  TxStatus,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, getAddress, type Address, type Hex } from "viem";
import { z } from "zod";

import {
  EXPIRED_CLAIMS_QUERY,
  REFUND_BODY_PARAMS,
  REFUND_EXPIRED,
  REPORT_PARAMS,
  type ExpiredClaim,
} from "../shared/fanout";

/**
 * Returns unclaimed money automatically. On every cron tick:
 *   1. asks the Envio indexer for claims that are still unclaimed after their claim window
 *      (HTTP capability, identical consensus across nodes),
 *   2. groups them by payout and takes whole payouts up to `maxRefundsPerReport` rows,
 *   3. sends one signed report to FanoutKeeper, which calls ClaimEscrow.refundMany(claimSigners).
 *
 * ClaimEscrow refunds each row to the platform that paid it and skips anything claimed, refunded or
 * not yet expired, so an indexer that lags behind the chain costs gas at worst, never money.
 */

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "not an address");

export const configSchema = z.object({
  /** Cron expression, e.g. every 10 minutes: "0 *\/10 * * * *". */
  schedule: z.string(),
  /** Envio GraphQL endpoint (the same one the web app reads, NEXT_PUBLIC_INDEXER_URL). */
  indexerUrl: z.string().url(),
  /** Only claims from this BatchPayout deployment: its ClaimEscrow is the one the keeper calls. */
  batchPayout: address,
  /** CRE chain name, e.g. "monad-testnet". */
  chainName: z.string(),
  /** FanoutKeeper (ignition module FanoutKeeper); the zero address placeholder is refused. */
  keeper: address.refine((a) => !/^0x0{40}$/.test(a), "set keeper to the deployed FanoutKeeper"),
  /** Rows per report. ClaimEscrow.refundMany costs ~40k gas a row. */
  maxRefundsPerReport: z.number().int().min(1).max(300),
  gasLimit: z.string().regex(/^\d+$/),
});
export type Config = z.infer<typeof configSchema>;

type IndexerResponse = { data?: { Claim?: ExpiredClaim[] }; errors?: { message: string }[] };

/**
 * Runs on each node. Returns the expired rows as a canonical JSON string ([[batchId, claimSigner], ...],
 * sorted), so every node that saw the same indexer state returns byte-identical output.
 */
export function fetchExpiredClaims(sendRequester: HTTPSendRequester, config: Config, cutoff: number): string {
  const body = JSON.stringify({
    query: EXPIRED_CLAIMS_QUERY,
    variables: { cutoff, batchPayout: getAddress(config.batchPayout), limit: config.maxRefundsPerReport },
  });
  const response = sendRequester
    .sendRequest({
      url: config.indexerUrl,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.from(new TextEncoder().encode(body)).toString("base64"),
    })
    .result();
  if (!ok(response)) throw new Error(`Indexer returned HTTP ${response.statusCode}`);
  const parsed = JSON.parse(text(response)) as IndexerResponse;
  if (parsed.errors?.length) throw new Error(`Indexer error: ${parsed.errors[0].message}`);
  const rows = (parsed.data?.Claim ?? []).map((c) => [String(c.batch_id), getAddress(c.id)] as const);
  rows.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : Number(a[0]) - Number(b[0])));
  return JSON.stringify(rows);
}

/**
 * Groups rows by payout and keeps whole payouts while they fit in `max` rows (a payout larger than
 * `max` is split; the rest comes back on the next run).
 */
export function pickRefunds(rows: readonly (readonly [string, string])[], max: number) {
  const byBatch = new Map<string, Address[]>();
  for (const [batchId, signer] of rows) {
    const list = byBatch.get(batchId) ?? [];
    list.push(getAddress(signer));
    byBatch.set(batchId, list);
  }
  const batches: { batchId: string; claimSigners: Address[] }[] = [];
  let count = 0;
  for (const [batchId, signers] of byBatch) {
    if (count >= max) break;
    const take = signers.slice(0, max - count);
    batches.push({ batchId, claimSigners: take });
    count += take.length;
  }
  return { batches, claimSigners: batches.flatMap((b) => b.claimSigners) };
}

export function encodeRefundReport(claimSigners: readonly Address[]): Hex {
  const body = encodeAbiParameters(REFUND_BODY_PARAMS, [claimSigners]);
  return encodeAbiParameters(REPORT_PARAMS, [REFUND_EXPIRED, body]);
}

export function onCron(runtime: Runtime<Config>): string {
  const config = runtime.config;
  // DON time, so every node asks the indexer the same question.
  const cutoff = Math.floor(runtime.now().getTime() / 1000);

  const http = new HTTPClient();
  const json = http
    .sendRequest(runtime, fetchExpiredClaims, consensusIdenticalAggregation<string>())(config, cutoff)
    .result();
  const rows = JSON.parse(json) as [string, string][];
  const { batches, claimSigners } = pickRefunds(rows, config.maxRefundsPerReport);
  if (claimSigners.length === 0) {
    runtime.log(`No expired, unclaimed payments at ${cutoff}`);
    return "nothing to refund";
  }
  for (const b of batches) runtime.log(`Payout ${b.batchId}: refunding ${b.claimSigners.length} unclaimed row(s)`);

  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainName });
  if (!network) throw new Error(`Unknown chain name: ${config.chainName}`);
  const evm = new EVMClient(network.chainSelector.selector);

  const report = runtime.report(prepareReportRequest(encodeRefundReport(claimSigners))).result();
  const write = evm
    .writeReport(runtime, { receiver: config.keeper, report, gasConfig: { gasLimit: config.gasLimit } })
    .result();
  const txHash = bytesToHex(write.txHash ?? new Uint8Array(32));
  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Refund report not delivered (status ${write.txStatus}): ${write.errorMessage ?? "unknown error"}`);
  }
  runtime.log(`Refund report delivered for ${claimSigners.length} row(s) in ${batches.length} payout(s): ${txHash}`);
  return `refunded ${claimSigners.length} row(s) from payouts ${batches.map((b) => b.batchId).join(", ")} in ${txHash}`;
}

export const initWorkflow = (config: Config) => [
  handler(new CronCapability().trigger({ schedule: config.schedule }), onCron),
];
