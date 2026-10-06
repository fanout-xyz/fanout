// Grants SettleToUsdc the APPROVED_SWAPPER role on Agora's AUSD/USDC pair, then checks it took.
// Only the swapping contract needs the role; payees never call the pair themselves.
// Usage: pnpm approve-swapper  (SettleToUsdc address from ignition/deployments/monad-settle-usdc,
//        or set SETTLE_ADDRESS; WHITELISTER_ADDRESS and PAIR_ADDRESS override the testnet defaults)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { network } from "hardhat";
import { getAddress, parseAbi, type Address } from "viem";

// Monad testnet. On testnet the whitelister's setApprovedSwapper is open to anyone.
const WHITELISTER = (process.env.WHITELISTER_ADDRESS || "0x7c10F56d6f04a51376393a1C3670e966863F6BD5") as Address;
const PAIR = (process.env.PAIR_ADDRESS || "0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae") as Address;
const ROLE = "APPROVED_SWAPPER";

function settleAddress(): Address {
  if (process.env.SETTLE_ADDRESS) return getAddress(process.env.SETTLE_ADDRESS);
  const file = join(import.meta.dirname, "..", "ignition", "deployments", "monad-settle-usdc", "deployed_addresses.json");
  if (!existsSync(file)) throw new Error("Deploy SettleToUsdc first (pnpm deploy:monad:settle-usdc) or set SETTLE_ADDRESS.");
  const addresses: Record<string, string> = JSON.parse(readFileSync(file, "utf8"));
  return getAddress(addresses["SettleToUsdc#SettleToUsdc"]);
}

const whitelisterAbi = parseAbi(["function setApprovedSwapper(address account)"]);
const pairAbi = parseAbi(["function hasRole(string role, address account) view returns (bool)"]);

const settle = settleAddress();
const { viem } = await network.create("monadTestnet");
const publicClient = await viem.getPublicClient();
const [wallet] = await viem.getWalletClients();

if (await publicClient.readContract({ address: PAIR, abi: pairAbi, functionName: "hasRole", args: [ROLE, settle] })) {
  console.log(`${settle} already has ${ROLE} on ${PAIR}. Nothing to do.`);
} else {
  const hash = await wallet.writeContract({ address: WHITELISTER, abi: whitelisterAbi, functionName: "setApprovedSwapper", args: [settle] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`setApprovedSwapper failed: ${hash}`);
  const ok = await publicClient.readContract({ address: PAIR, abi: pairAbi, functionName: "hasRole", args: [ROLE, settle] });
  if (!ok) throw new Error(`setApprovedSwapper went through (${hash}) but ${settle} still lacks ${ROLE} on ${PAIR}.`);
  console.log(`${settle} now has ${ROLE} on ${PAIR} (tx ${hash}).`);
}
