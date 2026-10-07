import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Monad testnet: Agora AUSD, the USDC stand-in on Agora's pair (CTK, 18 decimals), and the pair.
const MONAD_TESTNET_AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const MONAD_TESTNET_USDC = "0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D";
const MONAD_TESTNET_PAIR = "0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae";

/**
 * Deploys SettleToUsdc, which lets payees take AUSD as USDC through Agora's stable-swap pair.
 * Standalone: the payout contracts are untouched. After deploying, grant it the pair's
 * APPROVED_SWAPPER role with scripts/approve-swapper.ts.
 */
export default buildModule("SettleToUsdc", (m) => {
  const ausd = m.getParameter("ausd", MONAD_TESTNET_AUSD);
  const usdc = m.getParameter("usdc", MONAD_TESTNET_USDC);
  const pair = m.getParameter("pair", MONAD_TESTNET_PAIR);
  return { settleToUsdc: m.contract("SettleToUsdc", [ausd, usdc, pair]) };
});
