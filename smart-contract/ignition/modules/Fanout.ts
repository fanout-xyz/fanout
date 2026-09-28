import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Agora AUSD on Monad testnet (6 decimals).
const MONAD_TESTNET_AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const THIRTY_DAYS = 30n * 24n * 60n * 60n;

export default buildModule("Fanout", (m) => {
  const ausd = m.getParameter("ausd", MONAD_TESTNET_AUSD);
  const claimTtl = m.getParameter("claimTtl", THIRTY_DAYS);

  const treasury = m.contract("Treasury", [ausd]);
  const claimEscrow = m.contract("ClaimEscrow", [ausd, treasury]);
  const batchPayout = m.contract("BatchPayout", [treasury, claimEscrow, claimTtl]);

  m.call(treasury, "wire", [batchPayout, claimEscrow]);
  m.call(claimEscrow, "wire", [batchPayout]);

  return { treasury, claimEscrow, batchPayout };
});
