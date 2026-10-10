import "server-only";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { authorizationStateAbi, erc20Abi, transferWithAuthorizationAbi } from "@/lib/fanout/abis";
import { relayerAccount } from "@/lib/fanout/relayer";
import { x402Chain } from "./chain";
import { verifyAuthorizationSignature, type Facilitator } from "./facilitator";

/**
 * Verifying and settling x402 "exact" payments ourselves, for a network or asset no facilitator
 * serves (X402_FACILITATOR=self). Same checks a facilitator makes: the payer's ERC-3009 signature,
 * their balance, an unused nonce, and a dry run of transferWithAuthorization; then our relayer
 * submits it and pays the gas. The token sends the money only to the `to` the payer signed.
 */
export function selfFacilitator(chainId: number): Facilitator {
  const chain = x402Chain(chainId);
  const publicClient = createPublicClient({ chain, transport: http() });

  return {
    async verify(payment, requirements) {
      const a = payment.payload.authorization;
      const payer = a.from;
      if (!(await verifyAuthorizationSignature(payment, requirements, chainId))) return { isValid: false, invalidReason: "invalid_exact_evm_payload_signature", payer };
      const [balance, used] = await Promise.all([
        publicClient.readContract({ address: requirements.asset, abi: erc20Abi, functionName: "balanceOf", args: [payer] }),
        publicClient.readContract({ address: requirements.asset, abi: authorizationStateAbi, functionName: "authorizationState", args: [payer, a.nonce] }),
      ]);
      if (balance < BigInt(a.value)) return { isValid: false, invalidReason: "insufficient_funds", payer };
      if (used) return { isValid: false, invalidReason: "invalid_exact_evm_payload_authorization_nonce_used", payer };
      return { isValid: true, payer };
    },
    async settle(payment, requirements) {
      const account = relayerAccount();
      if (!account) return { success: false, errorReason: "settlement_unavailable", network: requirements.network };
      const a = payment.payload.authorization;
      try {
        const { request } = await publicClient.simulateContract({
          account,
          address: requirements.asset,
          abi: transferWithAuthorizationAbi,
          functionName: "transferWithAuthorization",
          args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, payment.payload.signature],
        });
        const wallet = createWalletClient({ account, chain, transport: http() });
        const transaction: Hex = await wallet.writeContract(request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: transaction });
        if (receipt.status !== "success") return { success: false, errorReason: "transaction_failed", network: requirements.network };
        return { success: true, payer: a.from, transaction, network: requirements.network };
      } catch {
        return { success: false, errorReason: "transaction_failed", network: requirements.network };
      }
    },
  };
}
