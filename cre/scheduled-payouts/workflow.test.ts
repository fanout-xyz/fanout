import { describe, expect } from "bun:test";
import { EvmMock, HttpActionsMock, newTestRuntime, REPORT_METADATA_HEADER_LENGTH, test } from "@chainlink/cre-sdk/test";
import { bytesToHex, decodeAbiParameters, decodeFunctionData, encodeFunctionResult, getAddress, hexToBytes, type Hex } from "viem";

import { BATCH_PAYOUT_ABI, CREATE_BATCH, CREATE_BATCH_BODY_PARAMS, REPORT_PARAMS, TREASURY_ABI, type ScheduledPayout } from "../shared/fanout";
import { duePayouts, onCron, type Config } from "./workflow";

const MONAD_TESTNET = 2183018362218727504n;
const NOW = 1_800_000_000;
const PLATFORM = "0x00000000000000000000000000000000000000AA";

const config: Config = {
  schedule: "0 */5 * * * *",
  scheduleUrl: "https://platform.example/fanout/schedule.json",
  chainName: "monad-testnet",
  keeper: "0x000000000000000000000000000000000000bEEF",
  batchPayout: "0x01aD7B7A7Ab17ffE4fDFE4644828167702338386",
  treasury: "0xecC2616C45a55AEA2d33374E4B99D64d0900255c",
  deadlineMarginSeconds: 300,
  maxPerRun: 2,
  gasLimit: "8000000",
};

/** Mocks may answer in the JSON form, where bytes are base64. */
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const word = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const payout = (id: string, notBefore: number, overrides: Partial<ScheduledPayout> = {}): ScheduledPayout => ({
  id,
  notBefore,
  platform: PLATFORM,
  claimSigners: ["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"],
  amounts: ["5000000", "7000000"],
  emailHashes: [word(11), word(12)],
  claimWindow: "86400",
  nonce: word(Number(id.replace(/\D/g, "")) || 1),
  deadline: String(notBefore + 7 * 86400),
  signature: "0x1234",
  ...overrides,
});

type Chain = { used?: Set<Hex>; balance?: bigint; reverts?: Set<Hex> };

function setup(payouts: ScheduledPayout[], chain: Chain = {}) {
  const http = HttpActionsMock.testInstance();
  const seen: { url?: string; headers?: Record<string, string> } = {};
  http.sendRequest = (req) => {
    seen.url = req.url;
    seen.headers = req.headers;
    return { statusCode: 200, body: b64(new TextEncoder().encode(JSON.stringify({ version: 1, payouts }))) };
  };

  const evm = EvmMock.testInstance(MONAD_TESTNET);
  evm.callContract = (req) => {
    const to = getAddress(bytesToHex(req.call!.to));
    const data = bytesToHex(req.call!.data);
    if (to === getAddress(config.treasury)) {
      return { data: b64(hexToBytes(encodeFunctionResult({ abi: TREASURY_ABI, functionName: "balanceOf", result: chain.balance ?? 1_000_000_000n }))) };
    }
    const call = decodeFunctionData({ abi: BATCH_PAYOUT_ABI, data });
    if (call.functionName === "authorizationState") {
      const used = chain.used?.has(call.args[1]) ?? false;
      return { data: b64(hexToBytes(encodeFunctionResult({ abi: BATCH_PAYOUT_ABI, functionName: "authorizationState", result: used }))) };
    }
    if (chain.reverts?.has(call.args[5].nonce)) throw new Error("execution reverted: BadAuthorization()");
    return { data: b64(hexToBytes(word(1001))) };
  };

  const delivered: { id: Hex; platform: string; amounts: readonly bigint[]; claimWindow: bigint }[] = [];
  evm.writeReport = (req) => {
    const payload = bytesToHex(req.report!.rawReport.slice(REPORT_METADATA_HEADER_LENGTH));
    const [kind, body] = decodeAbiParameters(REPORT_PARAMS, payload);
    expect(kind).toBe(CREATE_BATCH);
    expect(bytesToHex(req.receiver).toLowerCase()).toBe(config.keeper.toLowerCase());
    const [platform, , amounts, , claimWindow, auth] = decodeAbiParameters(CREATE_BATCH_BODY_PARAMS, body);
    delivered.push({ id: auth.nonce, platform, amounts, claimWindow });
    return { txStatus: "TX_STATUS_SUCCESS", txHash: new Uint8Array(32).fill(1) } as never;
  };

  const runtime = newTestRuntime<Config>(null, { timeProvider: () => NOW * 1000 });
  runtime.config = config;
  return { runtime, delivered, seen };
}

describe("scheduled-payouts", () => {
  test("submits the due, unused authorizations through the keeper, earliest first", () => {
    const { runtime, delivered, seen } = setup([
      payout("p3", NOW - 10),
      payout("p1", NOW - 86400),
      payout("p9", NOW + 86400), // next period: not due
    ]);
    expect(onCron(runtime)).toBe("submitted p1, p3");
    expect(seen.url).toBe(config.scheduleUrl);
    expect(delivered.map((d) => d.id)).toEqual([word(1), word(3)]);
    expect(delivered[0]).toMatchObject({ platform: getAddress(PLATFORM), amounts: [5_000_000n, 7_000_000n], claimWindow: 86400n });
  });

  test("skips used or cancelled nonces, short balances and authorizations that would revert", () => {
    const { runtime, delivered } = setup(
      [payout("p1", NOW - 30), payout("p2", NOW - 20), payout("p3", NOW - 10, { amounts: ["5000000", "999000000000"] })],
      { used: new Set([word(1)]), reverts: new Set([word(2)]), balance: 100_000_000n },
    );
    expect(onCron(runtime)).toBe("nothing submittable");
    expect(delivered).toEqual([]);
    const logs = runtime.getLogs().join("\n");
    expect(logs).toContain("p2: createBatchFor would revert");
    expect(logs).toContain("p3: platform balance 100000000 is below the total 999005000000");
  });

  test("stops at maxPerRun; the rest go out on the next tick", () => {
    const { runtime, delivered } = setup([payout("p1", NOW - 3), payout("p2", NOW - 2), payout("p3", NOW - 1)]);
    onCron(runtime);
    expect(delivered.length).toBe(2);
  });

  test("rejects a malformed schedule", () => {
    const { runtime } = setup([payout("p1", NOW - 1, { nonce: "0x12" })]);
    expect(() => onCron(runtime)).toThrow();
  });

  test("duePayouts honours notBefore and keeps a margin before the deadline", () => {
    const list = [
      payout("early", NOW + 1),
      payout("now", NOW),
      payout("closing", NOW - 86400, { deadline: String(NOW + 100) }),
      payout("expired", NOW - 86400, { deadline: String(NOW - 1) }),
    ];
    expect(duePayouts(list, NOW, 300).map((p) => p.id)).toEqual(["now"]);
    expect(duePayouts(list, NOW, 0).map((p) => p.id)).toEqual(["closing", "now"]);
  });
});
