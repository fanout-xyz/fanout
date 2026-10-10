import { keccak256, toBytes, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * The local demo's account for an email (mock sign-in, lib/auth/mock.tsx): a fixed key derived from
 * the email, so balances persist across sign-ins and the demo can sign things (agent policies,
 * payout approvals) like a real wallet would. Anyone can derive it: demo only, never onchain.
 */
export function mockAccountForEmail(email: string): LocalAccount {
  return privateKeyToAccount(keccak256(toBytes(`fanout-mock:${email}`)));
}
