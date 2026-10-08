import { describe, expect } from "bun:test";
import { EvmMock, HttpActionsMock, newTestRuntime, REPORT_METADATA_HEADER_LENGTH, test } from "@chainlink/cre-sdk/test";
import { bytesToHex, decodeAbiParameters, getAddress, type Hex } from "viem";

import { REFUND_BODY_PARAMS, REFUND_EXPIRED, REPORT_PARAMS } from "../shared/fanout";
import { initWorkflow, onCron, pickRefunds, type Config } from "./workflow";

const MONAD_TESTNET = 2183018362218727504n;
const NOW = 1_800_000_000;

const config: Config = {
  schedule: "0 */10 * * * *",
  indexerUrl: "https://indexer.example/v1/graphql",
  batchPayout: "0x01aD7B7A7Ab17ffE4fDFE4644828167702338386",
  chainName: "monad-testnet",
  keeper: "0x000000000000000000000000000000000000bEEF",
  maxRefundsPerReport: 3,
  gasLimit: "6000000",
};

/** Mocks may answer in the JSON form, where bytes are base64. */
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const signer = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const claim = (n: number, batch: string) => ({ id: signer(n).toLowerCase(), batch_id: batch, expiresAt: NOW - 60 });

function mockIndexer(rows: ReturnType<typeof claim>[], seen: { body?: unknown }) {
  const http = HttpActionsMock.testInstance();
  http.sendRequest = (req) => {
    seen.body = JSON.parse(new TextDecoder().decode(req.body));
    const body = new TextEncoder().encode(JSON.stringify({ data: { Claim: rows } }));
    return { statusCode: 200, body: b64(body) };
  };
}

function decodeReport(rawReport: Uint8Array) {
  const payload = bytesToHex(rawReport.slice(REPORT_METADATA_HEADER_LENGTH)) as Hex;
  const [kind, body] = decodeAbiParameters(REPORT_PARAMS, payload);
  const [claimSigners] = decodeAbiParameters(REFUND_BODY_PARAMS, body);
  return { kind, claimSigners };
}

describe("refund-expired", () => {
  test("asks the indexer for expired rows of this deployment and sends one refund report to the keeper", () => {
    const seen: { body?: any } = {};
    mockIndexer([claim(1, "1002"), claim(2, "1001"), claim(3, "1001")], seen);

    let delivered: { receiver: string; kind: number; claimSigners: readonly string[]; gasLimit: string } | undefined;
    const evm = EvmMock.testInstance(MONAD_TESTNET);
    evm.writeReport = (req) => {
      const { kind, claimSigners } = decodeReport(req.report!.rawReport);
      delivered = { receiver: bytesToHex(req.receiver), kind, claimSigners, gasLimit: String(req.gasConfig?.gasLimit) };
      return { txStatus: "TX_STATUS_SUCCESS", txHash: new Uint8Array(32).fill(0xab) } as never;
    };

    const runtime = newTestRuntime<Config>(null, { timeProvider: () => NOW * 1000 });
    runtime.config = config;
    const result = onCron(runtime);

    expect(seen.body.variables).toEqual({ cutoff: NOW, batchPayout: config.batchPayout, limit: 3 });
    expect(seen.body.query).toContain("status: { _eq: Sent }");
    expect(delivered?.receiver.toLowerCase()).toBe(config.keeper.toLowerCase());
    expect(delivered?.kind).toBe(REFUND_EXPIRED);
    // Grouped by payout, oldest payout first.
    expect(delivered?.claimSigners).toEqual([signer(2), signer(3), signer(1)]);
    expect(delivered?.gasLimit).toBe("6000000");
    expect(result).toContain("refunded 3 row(s) from payouts 1001, 1002");
    expect(runtime.getLogs().join("\n")).toContain("Payout 1001: refunding 2 unclaimed row(s)");
  });

  test("does nothing when nothing has expired", () => {
    mockIndexer([], {});
    const evm = EvmMock.testInstance(MONAD_TESTNET);
    let writes = 0;
    evm.writeReport = () => {
      writes++;
      return { txStatus: "TX_STATUS_SUCCESS" } as never;
    };
    const runtime = newTestRuntime<Config>(null, { timeProvider: () => NOW * 1000 });
    runtime.config = config;
    expect(onCron(runtime)).toBe("nothing to refund");
    expect(writes).toBe(0);
  });

  test("fails the run when the report reverts, so it shows up as a failed execution", () => {
    mockIndexer([claim(1, "1001")], {});
    const evm = EvmMock.testInstance(MONAD_TESTNET);
    evm.writeReport = () => ({ txStatus: "TX_STATUS_REVERTED", errorMessage: "out of gas" }) as never;
    const runtime = newTestRuntime<Config>(null, { timeProvider: () => NOW * 1000 });
    runtime.config = config;
    expect(() => onCron(runtime)).toThrow(/out of gas/);
  });

  test("fails the run on an indexer error instead of refunding nothing silently", () => {
    const http = HttpActionsMock.testInstance();
    http.sendRequest = () => ({ statusCode: 200, body: b64(new TextEncoder().encode(JSON.stringify({ errors: [{ message: "field 'batchPayout' not found" }] }))) });
    const runtime = newTestRuntime<Config>(null, { timeProvider: () => NOW * 1000 });
    runtime.config = config;
    expect(() => onCron(runtime)).toThrow(/batchPayout/);
  });

  test("pickRefunds keeps whole payouts while they fit and splits only the last one", () => {
    const rows = [
      ["1001", signer(1)],
      ["1001", signer(2)],
      ["1002", signer(3)],
      ["1002", signer(4)],
      ["1003", signer(5)],
    ] as const;
    const { batches, claimSigners } = pickRefunds(rows, 3);
    expect(batches.map((b) => [b.batchId, b.claimSigners.length])).toEqual([["1001", 2], ["1002", 1]]);
    expect(claimSigners).toEqual([signer(1), signer(2), signer(3)]);
  });

  test("runs on the configured cron schedule", () => {
    const [h] = initWorkflow(config);
    expect((h.trigger as any).config.schedule).toBe(config.schedule);
  });
});
