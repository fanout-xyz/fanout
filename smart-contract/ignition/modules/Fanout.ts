import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import type { ArgumentType, IgnitionModuleBuilder } from "@nomicfoundation/ignition-core";

// Agora AUSD on Monad testnet (6 decimals).
const MONAD_TESTNET_AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";

/**
 * Deploys Treasury, ClaimEscrow and BatchPayout for `ausd` and wires them together.
 * `verifier` (required parameter) is the address of the web app's VERIFIER_PRIVATE_KEY, which
 * co-signs each claim after checking the claimer's email.
 * `firstBatchId` (default 1) is the first payout number. A new deployment starts after the ids an
 * older one used, so payouts from both can share one indexer without clashing.
 * Each payout picks its own claim window (BatchPayout.MIN_CLAIM_WINDOW to MAX_CLAIM_WINDOW).
 */
export function deployFanout(m: IgnitionModuleBuilder, ausd: ArgumentType) {
  const firstBatchId = m.getParameter("firstBatchId", 1n);
  const verifier = m.getParameter<string>("verifier");

  const treasury = m.contract("Treasury", [ausd]);
  const claimEscrow = m.contract("ClaimEscrow", [ausd, treasury, verifier]);
  const batchPayout = m.contract("BatchPayout", [treasury, claimEscrow, firstBatchId]);

  m.call(treasury, "wire", [batchPayout, claimEscrow]);
  m.call(claimEscrow, "wire", [batchPayout]);

  return { treasury, claimEscrow, batchPayout };
}

/** Production setup: real Agora AUSD. */
export default buildModule("Fanout", (m) => deployFanout(m, m.getParameter("ausd", MONAD_TESTNET_AUSD)));
