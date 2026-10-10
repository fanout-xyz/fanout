import "server-only";
import { createPublicClient, createWalletClient, getAddress, http, parseEventLogs, type VerifyTypedDataParameters } from "viem";
import { activeChain } from "@/lib/chains";
import { config } from "@/lib/config";
import { batchPayoutAbi, batchPayoutV3Abi, claimEscrowAbi, claimEscrowV3Abi } from "@/lib/fanout/abis";
import { createOnchainClient, ALL_CONTRACT_ERRORS, friendlyChainError, need } from "@/lib/fanout/onchain-client";
import { relayerAccount } from "@/lib/fanout/relayer";
import type { Ledger } from "./ledger";

/**
 * The agent ledger against the deployed contracts. Reads go to the chain; writes are submitted by
 * the relayer (RELAYER_PRIVATE_KEY), which pays the network fee. The relayer can only submit what
 * the platform signed: createBatchFor checks the platform's CreateBatch signature onchain, and
 * refundMany only ever returns money to the platform that sent it.
 */
export function onchainLedger(): Ledger {
  const publicClient = createPublicClient({ chain: activeChain, transport: http() });
  const batchPayout = need(config.contracts.batchPayout, "NEXT_PUBLIC_BATCH_PAYOUT_ADDRESS");
  const reads = createOnchainClient({});

  function relayer() {
    const account = relayerAccount();
    if (!account) throw new Error("Payouts from agents aren't available on this server yet (no relayer key).");
    return { account, wallet: createWalletClient({ account, chain: activeChain, transport: http() }) };
  }

  return {
    chainId: activeChain.id,
    batchPayout,
    balanceOf: (platform) => reads.getTreasuryBalance(platform),
    async getBatch(batchId) {
      const batch = await reads.getBatch(batchId);
      const [platform] = await publicClient.readContract({ address: batchPayout, abi: batchPayoutAbi, functionName: "getBatch", args: [BigInt(batchId)] });
      return { ...batch, platform: getAddress(platform) };
    },
    async createBatchFor(input) {
      if (!config.payoutsV3) throw new Error("Payouts from agents need the v3 payout contracts.");
      const { account, wallet } = relayer();
      const abi = [...batchPayoutV3Abi, ...ALL_CONTRACT_ERRORS];
      try {
        // Dry run first: a bad signature, a used nonce or a short balance reverts here for free.
        const { request } = await publicClient.simulateContract({
          account,
          address: batchPayout,
          abi,
          functionName: "createBatchFor",
          args: [
            input.platform,
            input.claimSigners,
            input.amounts,
            input.emailHashes,
            input.claimWindow,
            { nonce: input.nonce, deadline: input.deadline, signature: input.signature },
          ],
        });
        const txHash = await wallet.writeContract(request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") throw new Error("The payout failed. Nothing was sent. Try again.");
        const [event] = parseEventLogs({ abi: batchPayoutV3Abi, eventName: "BatchCreated", logs: receipt.logs });
        if (!event) throw new Error("The payout went through, but its number couldn't be read. Check the dashboard.");
        return { batchId: event.args.batchId.toString(), txHash };
      } catch (err) {
        throw friendlyChainError(err);
      }
    },
    async refundExpired(batchId) {
      const escrow = need(config.contracts.claimEscrow, "NEXT_PUBLIC_CLAIM_ESCROW_ADDRESS");
      if (!config.payoutsV3) throw new Error("Returning unclaimed money from here needs the v3 payout contracts.");
      const batch = await reads.getBatch(batchId);
      const now = Date.now();
      if (batch.expiresAt && batch.expiresAt > now) throw new Error("This payout's claim links still work. Unclaimed money can return once they expire.");
      const due = batch.rows.filter((r) => r.status === "sent").map((r) => r.claimSigner);
      if (due.length === 0) throw new Error("Nothing is waiting to be claimed in this payout.");
      const { account, wallet } = relayer();
      try {
        const { request } = await publicClient.simulateContract({ account, address: escrow, abi: claimEscrowV3Abi, functionName: "refundMany", args: [due] });
        const txHash = await wallet.writeContract(request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        const refunded = parseEventLogs({ abi: claimEscrowAbi, eventName: "Refunded", logs: receipt.logs }).length;
        return { txHash, refunded };
      } catch (err) {
        throw friendlyChainError(err);
      }
    },
    // Smart accounts (ERC-1271) too, like BatchPayout's SignatureChecker.
    verifySignature: (signer, typedData, signature) =>
      publicClient.verifyTypedData({ address: signer, signature, ...typedData } as VerifyTypedDataParameters).catch(() => false),
  };
}
