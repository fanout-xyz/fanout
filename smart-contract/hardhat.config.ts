import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import "dotenv/config";
import { configVariable, defineConfig } from "hardhat/config";

const compiler = {
  version: "0.8.30",
  settings: {
    // Monad executes Cancun bytecode; pin it so a newer compiler default can't emit unsupported opcodes.
    evmVersion: "cancun",
    optimizer: { enabled: true, runs: 200 },
  },
};

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: compiler,
      production: compiler,
    },
  },
  networks: {
    monadTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 10143,
      url: configVariable("MONAD_RPC_URL", { default: "https://testnet-rpc.monad.xyz" }),
      // Read from the MONAD_PRIVATE_KEY env var or `pnpm hardhat keystore set MONAD_PRIVATE_KEY`. Never commit it.
      accounts: [configVariable("MONAD_PRIVATE_KEY")],
    },
  },
});
