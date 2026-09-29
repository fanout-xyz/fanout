import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { deployFanout } from "./Fanout.ts";

/**
 * Same contracts as Fanout.ts, but paying out in our own mintable test token (tAUSD),
 * because Agora's AUSD faucet on Monad testnet is empty. Switch back to Fanout.ts for the demo.
 */
export default buildModule("FanoutTestAusd", (m) => {
  const token = m.contract("MockAUSD");
  return { token, ...deployFanout(m, token) };
});
