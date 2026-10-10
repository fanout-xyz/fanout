import "server-only";
import { createPublicClient, createWalletClient, http, keccak256, parseEventLogs, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentKv } from "@/lib/agents/kv";
import { mockOperatorAddress } from "@/lib/agents/ledger";
import { activeChain } from "@/lib/chains";
import { config } from "@/lib/config";
import { batchPayoutV3Abi, erc20Abi, treasuryAbi } from "@/lib/fanout/abis";
import { deliverClaimEmails, emailConfigured } from "@/lib/fanout/claim-emailer";
import { engine } from "@/lib/fanout/mock-engine";
import { getMockState, saveMockState } from "@/lib/fanout/mock-store";
import { ALL_CONTRACT_ERRORS, friendlyChainError, need } from "@/lib/fanout/onchain-client";
import { publicOrigin } from "@/lib/agents/server";
import { x402Chain } from "./chain";
import { operatorKey, x402Config, type X402Config } from "./config";
import { httpFacilitator, mockFacilitator, type Facilitator } from "./facilitator";
import type { PayoutAccount, X402Deps } from "./payout";
import { selfFacilitator } from "./self-facilitator";

const g = globalThis as typeof globalThis & { __fanoutX402Nonces?: Set<string> };

function facilitatorFor(cfg: X402Config): Facilitator {
  if (cfg.facilitator.kind === "http") return httpFacilitator(cfg.facilitator.url);
  if (cfg.facilitator.kind === "self") return selfFacilitator(cfg.chainId);
  return mockFacilitator(cfg.chainId, (g.__fanoutX402Nonces ??= new Set()));
}

/** The demo's payout account: payments "arrive" as payout balance, then pay the rows. */
function mockAccount(): PayoutAccount {
  const address = mockOperatorAddress();
  return {
    address,
    canCover: async () => true,
    async pay(rows, claimWindowSeconds, paid) {
      const s = getMockState();
      s.treasury[address.toLowerCase() as typeof address] = (s.treasury[address.toLowerCase() as typeof address] ?? 0n) + paid;
      const created = engine.createBatchPayout(s, address, rows, { claimWindowSeconds });
      saveMockState();
      return created;
    },
    refund: async () => keccak256(toHex(crypto.getRandomValues(new Uint8Array(32)))),
  };
}

/**
 * The operator account (X402_OPERATOR_PRIVATE_KEY): receives the x402 payment and pays the payout
 * from its own payout balance with BatchPayout.createBatch. It needs AUSD deposited as float and a
 * little MON for fees.
 */
function onchainAccount(cfg: X402Config, key: Hex): PayoutAccount {
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: activeChain, transport: http() });
  const wallet = createWalletClient({ account, chain: activeChain, transport: http() });
  const treasury = need(config.contracts.treasury, "NEXT_PUBLIC_TREASURY_ADDRESS");
  const batchPayout = need(config.contracts.batchPayout, "NEXT_PUBLIC_BATCH_PAYOUT_ADDRESS");
  return {
    address: account.address,
    async canCover(amount) {
      const balance = await publicClient.readContract({ address: treasury, abi: treasuryAbi, functionName: "balanceOf", args: [account.address] });
      return balance >= amount;
    },
    async pay(rows, claimWindowSeconds) {
      try {
        const { request } = await publicClient.simulateContract({
          account,
          address: batchPayout,
          abi: [...batchPayoutV3Abi, ...ALL_CONTRACT_ERRORS],
          functionName: "createBatch",
          args: [rows.map((r) => r.claimSigner), rows.map((r) => r.amount), rows.map((r) => r.emailHash), BigInt(claimWindowSeconds)],
        });
        const txHash = await wallet.writeContract(request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") throw new Error("The payout transaction failed.");
        const [event] = parseEventLogs({ abi: batchPayoutV3Abi, eventName: "BatchCreated", logs: receipt.logs });
        if (!event) throw new Error("The payout went through, but its number couldn't be read.");
        return { batchId: event.args.batchId.toString(), txHash };
      } catch (err) {
        throw friendlyChainError(err);
      }
    },
    async refund(payer, amount) {
      const chain = x402Chain(cfg.chainId);
      const refundWallet = createWalletClient({ account, chain, transport: http() });
      const refundReader = createPublicClient({ chain, transport: http() });
      const txHash = await refundWallet.writeContract({ address: cfg.asset.address, abi: erc20Abi, functionName: "transfer", args: [payer, amount], chain, account });
      await refundReader.waitForTransactionReceipt({ hash: txHash });
      return txHash;
    },
  };
}

/** Wires the endpoint to this deployment, or says why it's off. */
export function x402Deps(requestUrl?: string): { deps: X402Deps } | { unavailable: string } {
  const kv = agentKv();
  if (!kv) return { unavailable: "Payouts over x402 need KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*) for idempotency." };
  const cfg = x402Config();
  let account: PayoutAccount;
  if (config.useMock) account = mockAccount();
  else {
    if (!config.payoutsV3) return { unavailable: "Payouts over x402 need the v3 payout contracts." };
    if (cfg.chainId !== activeChain.id) return { unavailable: `X402_NETWORK must be the chain the payout contracts are on (eip155:${activeChain.id}).` };
    const key = operatorKey();
    if (!key) return { unavailable: "Payouts over x402 aren't set up on this server (X402_OPERATOR_PRIVATE_KEY)." };
    account = onchainAccount(cfg, key);
  }
  const origin = publicOrigin(requestUrl);
  return {
    deps: {
      kv,
      cfg,
      facilitator: facilitatorFor(cfg),
      account,
      decimals: config.stablecoin.decimals,
      resourceUrl: `${origin}/api/x402/payout`,
      origin,
      emailer: emailConfigured() ? (platform, requests) => deliverClaimEmails(new Set([platform]), requests) : undefined,
      demo: config.useMock,
    },
  };
}
