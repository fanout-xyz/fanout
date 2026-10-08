/**
 * Prepares an anvil fork of Monad testnet for `cre workflow simulate --target local-simulation`:
 *   - deploys FanoutKeeper against the live monad-v3 ClaimEscrow and BatchPayout, wired to the
 *     MockKeystoneForwarder the simulator delivers through,
 *   - a dev "platform" takes AUSD from Agora's faucet, deposits it, and pays out two batches: one
 *     with the minimum 5-minute claim window that has already expired, one with a day left,
 *   - the platform pre-signs two scheduled payouts: one due now, one next week,
 *   - writes .local/ (state, schedule.json) and config.local.json for both workflows.
 *
 * The fork starts ~10 minutes in the past (simulate.sh forks an older block), so the short batch is
 * expired by wall-clock time too, which is what the workflow's DON time is in simulation. Then the
 * fork's clock is moved to now.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, getAddress, keccak256, parseAbi, parseUnits, toHex, type Address, type Hex } from "viem";

import { generateClaimKey } from "../../apps/web/lib/fanout/claim-keys.ts";
import { buildSchedule } from "./sign-schedule.ts";
import {
  CRE_DIR, LOCAL_DIR, MOCK_FORWARDER, SERVICES_PORT, V3, artifact, devAccount, publicClient, testClient, walletFor,
  type LocalState,
} from "./local-chain.ts";

const deployer = walletFor(0);
const platform = walletFor(1);
const platformAccount = devAccount(1);

const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const faucet = parseAbi(["function requestFunds(address)"]);
const treasury = parseAbi(["function deposit(uint256)", "function balanceOf(address) view returns (uint256)"]);
const batchPayout = parseAbi([
  "function createBatch(address[] claimSigners, uint256[] amounts, bytes32[] emailHashes, uint64 claimWindow) returns (uint256)",
  "function nextBatchId() view returns (uint256)",
]);

async function send(wallet: typeof deployer, to: Address, data: Hex) {
  const hash = await wallet.sendTransaction({ to, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction to ${to} reverted: ${hash}`);
  return receipt;
}

async function payout(amounts: bigint[], claimWindow: bigint) {
  const signers = amounts.map(() => generateClaimKey().claimSigner);
  const emailHashes = amounts.map((_, i) => keccak256(toHex(`local-sim-${i}-${Math.random()}@example.com`)));
  const batchId = await publicClient.readContract({ address: V3.batchPayout, abi: batchPayout, functionName: "nextBatchId" });
  await send(platform, V3.batchPayout, encodeFunctionData({ abi: batchPayout, functionName: "createBatch", args: [signers, amounts, emailHashes, claimWindow] }));
  const { timestamp } = await publicClient.getBlock();
  return { batchId: String(batchId), signers, expiresAt: Number(timestamp + claimWindow) };
}

async function main() {
  // Gas money for the dev accounts (anvil funds them on a fresh chain, not always on a fork).
  // anvil's dev accounts are public, and on Monad testnet someone has given them EIP-7702
  // delegations. With code at the platform address, BatchPayout checks its signature through
  // ERC-1271 instead of ecrecover and rejects it, so clear that code on the fork.
  for (const i of [0, 1, 2, 3]) {
    const address = devAccount(i).address;
    await testClient.setBalance({ address, value: parseUnits("100", 18) });
    await testClient.setCode({ address, bytecode: "0x" });
  }

  const keeperArtifact = artifact("FanoutKeeper");
  const deployHash = await deployer.deployContract({
    abi: keeperArtifact.abi,
    bytecode: keeperArtifact.bytecode,
    args: [V3.claimEscrow, V3.batchPayout, MOCK_FORWARDER],
  });
  const keeper = getAddress((await publicClient.waitForTransactionReceipt({ hash: deployHash })).contractAddress!);
  console.log(`FanoutKeeper ${keeper} (forwarder ${MOCK_FORWARDER})`);

  await send(platform, V3.faucet, encodeFunctionData({ abi: faucet, functionName: "requestFunds", args: [platformAccount.address] }));
  const ausd = await publicClient.readContract({ address: V3.ausd, abi: erc20, functionName: "balanceOf", args: [platformAccount.address] });
  if (ausd < parseUnits("100", 6)) throw new Error(`Faucet gave ${ausd} AUSD units`);
  await send(platform, V3.ausd, encodeFunctionData({ abi: erc20, functionName: "approve", args: [V3.treasury, parseUnits("100", 6)] }));
  await send(platform, V3.treasury, encodeFunctionData({ abi: treasury, functionName: "deposit", args: [parseUnits("100", 6)] }));

  const expired = await payout([parseUnits("1.5", 6), parseUnits("2", 6), parseUnits("2.5", 6)], 300n);
  const open = await payout([parseUnits("4", 6)], 86_400n);
  console.log(`Payout ${expired.batchId}: 3 rows, claim window ends ${expired.expiresAt}`);
  console.log(`Payout ${open.batchId}: 1 row, claim window ends ${open.expiresAt}`);

  // Catch the fork's clock up with the wall clock (and the simulator's DON time).
  const now = Math.floor(Date.now() / 1000);
  if (now <= expired.expiresAt) throw new Error("The fork isn't old enough: fork an earlier block (simulate.sh FORK_BLOCKS_BACK)");
  await testClient.setNextBlockTimestamp({ timestamp: BigInt(now) });
  await testClient.mine({ blocks: 1 });

  const { schedule, claimLinks } = await buildSchedule(
    {
      payees: [{ email: "ana@example.com", amount: "3" }, { email: "bo@example.com", amount: "4.25" }],
      periods: 2,
      firstAt: now - 60,
      everySeconds: 7 * 86_400,
      validForSeconds: 86_400,
      claimWindowSeconds: 86_400,
      idPrefix: "weekly",
    },
    platformAccount,
    { batchPayout: V3.batchPayout, chainId: 10143, appOrigin: "http://localhost:3000" },
  );

  const state: LocalState = {
    keeper,
    platform: platformAccount.address,
    claims: [
      ...expired.signers.map((id) => ({ id, batch_id: expired.batchId, expiresAt: expired.expiresAt, batchPayout: V3.batchPayout })),
      ...open.signers.map((id) => ({ id, batch_id: open.batchId, expiresAt: open.expiresAt, batchPayout: V3.batchPayout })),
    ],
    expiredSigners: expired.signers,
    openSigners: open.signers,
    scheduledNonce: schedule.payouts[0].nonce as Hex,
  };

  mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(join(LOCAL_DIR, "state.json"), JSON.stringify(state, null, 2));
  writeFileSync(join(LOCAL_DIR, "schedule.json"), JSON.stringify(schedule, null, 2));
  writeFileSync(join(LOCAL_DIR, "claim-links.json"), JSON.stringify(claimLinks, null, 2));

  const services = `http://127.0.0.1:${SERVICES_PORT}`;
  const common = { chainName: "monad-testnet", keeper };
  writeFileSync(
    join(CRE_DIR, "refund-expired", "config.local.json"),
    JSON.stringify({ schedule: "0 */10 * * * *", indexerUrl: `${services}/graphql`, batchPayout: V3.batchPayout, ...common, maxRefundsPerReport: 150, gasLimit: "8000000" }, null, 2),
  );
  writeFileSync(
    join(CRE_DIR, "scheduled-payouts", "config.local.json"),
    JSON.stringify(
      { schedule: "0 */5 * * * *", scheduleUrl: `${services}/schedule.json`, ...common, batchPayout: V3.batchPayout, treasury: V3.treasury, deadlineMarginSeconds: 300, maxPerRun: 1, gasLimit: "15000000" },
      null,
      2,
    ),
  );
  console.log(`Wrote ${LOCAL_DIR} and config.local.json for both workflows`);
}

await main();
