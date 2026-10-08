/**
 * Runs both workflows' report-building code against the fork's stand-ins and delivers the reports
 * through the fork's MockKeystoneForwarder, the same contract `cre workflow simulate --broadcast`
 * sends them to. simulate.sh uses it when the CRE CLI isn't logged in, so the keeper path can still
 * be checked end to end; it is not a replacement for the CRE simulator (no WASM, no consensus).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { concat, decodeEventLog, encodeFunctionData, getAddress, keccak256, pad, parseAbi, toHex, type Hex } from "viem";

import { BATCH_PAYOUT_ABI, EXPIRED_CLAIMS_QUERY, type ExpiredClaim, type Schedule } from "../shared/fanout.ts";
import { encodeRefundReport, pickRefunds } from "../refund-expired/workflow.ts";
import { duePayouts, encodeCreateBatchReport } from "../scheduled-payouts/workflow.ts";
import { LOCAL_DIR, MOCK_FORWARDER, SERVICES_PORT, V3, publicClient, walletFor, type LocalState } from "./local-chain.ts";

const forwarderAbi = parseAbi([
  "function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)",
  "event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)",
]);
const keeperAbi = parseAbi(["function onReport(bytes metadata, bytes report)"]);
const state: LocalState = JSON.parse(readFileSync(join(LOCAL_DIR, "state.json"), "utf8"));
const transmitter = walletFor(2);
const services = `http://127.0.0.1:${SERVICES_PORT}`;

/** KeystoneForwarder report layout: 109 bytes of metadata, then the workflow's payload. */
function rawReport(workflowName: string, payload: Hex): Hex {
  return concat([
    "0x01", // version
    keccak256(toHex(`${workflowName}-${Date.now()}`)), // workflow execution id
    toHex(Math.floor(Date.now() / 1000), { size: 4 }),
    toHex(1, { size: 4 }), // DON id
    toHex(1, { size: 4 }), // DON config version
    keccak256(toHex(workflowName)), // workflow id (cid)
    pad(toHex(workflowName.slice(0, 10)), { size: 10, dir: "right" }),
    transmitter.account.address, // workflow owner
    "0x0001", // report id
    payload,
  ]);
}

async function deliver(workflowName: string, payload: Hex) {
  // Dry run the keeper call first, so a revert shows its reason instead of a bare "NO".
  try {
    await publicClient.call({
      account: MOCK_FORWARDER,
      to: state.keeper,
      data: encodeFunctionData({ abi: keeperAbi, functionName: "onReport", args: ["0x", payload] }),
      gas: 15_000_000n,
    });
  } catch (e) {
    console.log(`${workflowName}: keeper dry run reverted: ${(e as Error).message.split("\n").slice(0, 3).join(" ")}`);
  }
  const hash = await transmitter.sendTransaction({
    to: MOCK_FORWARDER,
    data: encodeFunctionData({ abi: forwarderAbi, functionName: "report", args: [state.keeper, rawReport(workflowName, payload), "0x", []] }),
    gas: 15_000_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const processed = receipt.logs
    .filter((l) => getAddress(l.address) === getAddress(MOCK_FORWARDER))
    .map((l) => { try { return decodeEventLog({ abi: forwarderAbi, ...l }); } catch { return null; } })
    .find((e) => e?.eventName === "ReportProcessed");
  const ok = receipt.status === "success" && processed?.args && "result" in processed.args && processed.args.result;
  console.log(`${workflowName}: forwarder tx ${hash}, delivered to keeper: ${ok ? "yes" : "NO"}`);
  if (!ok) process.exitCode = 1;
}

// refund-expired
const cutoff = Math.floor(Date.now() / 1000);
const res = await fetch(`${services}/graphql`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: EXPIRED_CLAIMS_QUERY, variables: { cutoff, batchPayout: V3.batchPayout, limit: 150 } }),
});
const claims = ((await res.json()) as { data: { Claim: ExpiredClaim[] } }).data.Claim;
const { batches, claimSigners } = pickRefunds(claims.map((c) => [String(c.batch_id), c.id] as const), 150);
console.log(`refund-expired: ${claimSigners.length} expired row(s) in payout(s) ${batches.map((b) => b.batchId).join(", ") || "none"}`);
if (claimSigners.length) await deliver("refund-expired", encodeRefundReport(claimSigners));

// scheduled-payouts
const schedule = (await (await fetch(`${services}/schedule.json`)).json()) as Schedule;
for (const p of duePayouts(schedule.payouts, cutoff, 300)) {
  const used = await publicClient.readContract({ address: V3.batchPayout, abi: BATCH_PAYOUT_ABI, functionName: "authorizationState", args: [getAddress(p.platform), p.nonce as Hex] });
  if (used) continue;
  console.log(`scheduled-payouts: ${p.id} is due`);
  await deliver("scheduled-payouts", encodeCreateBatchReport(p));
  break;
}
