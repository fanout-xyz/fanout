/** Prints what the workflows changed on the fork: refunded rows and the scheduled payout. Exits 1 if either is missing. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatUnits, getAddress, type Hex } from "viem";

import { BATCH_PAYOUT_ABI, TREASURY_ABI } from "../shared/fanout.ts";
import { ESCROW_ABI, LOCAL_DIR, V3, publicClient, type LocalState } from "./local-chain.ts";

const state: LocalState = JSON.parse(readFileSync(join(LOCAL_DIR, "state.json"), "utf8"));
const STATUS = ["Sent", "Claimed", "Refunded"];
const status = async (s: Hex) =>
  (await publicClient.readContract({ address: V3.claimEscrow, abi: ESCROW_ABI, functionName: "claims", args: [getAddress(s)] }))[2];

let failed = false;
for (const s of state.expiredSigners) {
  const st = await status(s);
  console.log(`expired row ${s}: ${STATUS[st]}`);
  if (st !== 2) failed = true;
}
for (const s of state.openSigners) {
  const st = await status(s);
  console.log(`open row    ${s}: ${STATUS[st]} (claim window not over, must stay Sent)`);
  if (st !== 0) failed = true;
}
const used = await publicClient.readContract({ address: V3.batchPayout, abi: BATCH_PAYOUT_ABI, functionName: "authorizationState", args: [state.platform, state.scheduledNonce] });
console.log(`scheduled payout authorization used: ${used}`);
if (!used) failed = true;
const balance = await publicClient.readContract({ address: V3.treasury, abi: TREASURY_ABI, functionName: "balanceOf", args: [state.platform] });
console.log(`platform Treasury balance: ${formatUnits(balance, 6)} AUSD`);
console.log(failed ? "CHECK FAILED" : "CHECK PASSED");
process.exit(failed ? 1 : 0);
