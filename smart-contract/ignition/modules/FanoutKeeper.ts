import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// The live monad-v3 payout contracts (ignition/deployments/monad-v3/deployed_addresses.json).
const MONAD_V3_CLAIM_ESCROW = "0x15DaAD3E6200051AE2F956ba32cD8033e82d40B6";
const MONAD_V3_BATCH_PAYOUT = "0x01aD7B7A7Ab17ffE4fDFE4644828167702338386";

/**
 * Deploys FanoutKeeper, the receiver for Fanout's Chainlink CRE workflows (cre/ in this repo).
 * `forwarder` (required) is the Chainlink forwarder that delivers reports on this chain: the
 * KeystoneForwarder for deployed workflows, or the MockKeystoneForwarder for
 * `cre workflow simulate --broadcast`. Addresses:
 * https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
 * The payout contracts are untouched. Once a workflow is deployed, the owner restricts reports to it
 * with setExpectedWorkflowOwner and setWorkflowIdAllowed (see "Recurring work" in the root README.md).
 */
export default buildModule("FanoutKeeper", (m) => {
  const claimEscrow = m.getParameter("claimEscrow", MONAD_V3_CLAIM_ESCROW);
  const batchPayout = m.getParameter("batchPayout", MONAD_V3_BATCH_PAYOUT);
  const forwarder = m.getParameter<string>("forwarder");
  return { fanoutKeeper: m.contract("FanoutKeeper", [claimEscrow, batchPayout, forwarder]) };
});
