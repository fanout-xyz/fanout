import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import type { ArgumentType, IgnitionModuleBuilder } from "@nomicfoundation/ignition-core";

// Agora AUSD on Monad testnet (6 decimals).
const MONAD_TESTNET_AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
export const THIRTY_DAYS = 30n * 24n * 60n * 60n;

/** Deploys Treasury, ClaimEscrow and BatchPayout for `ausd` and wires them together. */
export function deployFanout(m: IgnitionModuleBuilder, ausd: ArgumentType) {
  const claimTtl = m.getParameter("claimTtl", THIRTY_DAYS);

  const treasury = m.contract("Treasury", [ausd]);
  const claimEscrow = m.contract("ClaimEscrow", [ausd, treasury]);
  const batchPayout = m.contract("BatchPayout", [treasury, claimEscrow, claimTtl]);

  m.call(treasury, "wire", [batchPayout, claimEscrow]);
  m.call(claimEscrow, "wire", [batchPayout]);

  return { treasury, claimEscrow, batchPayout };
}

/** Production setup: real Agora AUSD. */
export default buildModule("Fanout", (m) => deployFanout(m, m.getParameter("ausd", MONAD_TESTNET_AUSD)));
