/**
 * Shared by the local simulation scripts: the anvil fork of Monad testnet, its dev accounts and the
 * live monad-v3 contracts (which the fork carries over).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createTestClient, createWalletClient, defineChain, http, type Abi, type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

export const CRE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCAL_DIR = join(CRE_DIR, ".local");
export const RPC_URL = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545";
export const SERVICES_PORT = Number(process.env.SERVICES_PORT ?? 8788);

export const V3 = {
  ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  treasury: "0xecC2616C45a55AEA2d33374E4B99D64d0900255c",
  claimEscrow: "0x15DaAD3E6200051AE2F956ba32cD8033e82d40B6",
  batchPayout: "0x01aD7B7A7Ab17ffE4fDFE4644828167702338386",
  /** Agora's AUSD faucet on Monad testnet: requestFunds(recipient), 10,000 AUSD a call. */
  faucet: "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C",
} as const satisfies Record<string, Address>;

/** MockKeystoneForwarder that `cre workflow simulate` uses on monad-testnet (CRE forwarder directory). */
export const MOCK_FORWARDER: Address = "0xB9F79d863261869B234c481D1f9A7af84AeAd192";

export const monadFork = defineChain({
  id: 10143,
  name: "Monad testnet (local fork)",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

// anvil's public development mnemonic: these accounts exist only on the local fork.
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
export const devAccount = (index: number) => mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index });
export const devPrivateKey = (index: number): Hex => {
  const key = devAccount(index).getHdKey().privateKey;
  if (!key) throw new Error("no key");
  return `0x${Buffer.from(key).toString("hex")}`;
};

export const publicClient = createPublicClient({ chain: monadFork, transport: http(RPC_URL, { timeout: 180_000 }) });
export const testClient = createTestClient({ chain: monadFork, mode: "anvil", transport: http(RPC_URL, { timeout: 180_000 }) });
export const walletFor = (index: number) =>
  createWalletClient({ chain: monadFork, account: devAccount(index), transport: http(RPC_URL, { timeout: 180_000 }) });

export function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const path = join(CRE_DIR, "..", "smart-contract", "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

export const ESCROW_ABI = [
  {
    type: "function",
    name: "claims",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "platform", type: "address" },
      { name: "status", type: "uint8" },
      { name: "expiresAt", type: "uint64" },
      { name: "emailHash", type: "bytes32" },
    ],
  },
] as const;

/** What fork-setup.ts leaves for the indexer stand-in, the checks and the fallback delivery. */
export type LocalState = {
  keeper: Address;
  platform: Address;
  claims: { id: Address; batch_id: string; expiresAt: number; batchPayout: Address }[];
  expiredSigners: Address[];
  openSigners: Address[];
  scheduledNonce: Hex;
};
