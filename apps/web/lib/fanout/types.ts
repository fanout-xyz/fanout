import type { Address, Hex } from "viem";

export type { Address, Hex };

export type TxResult = { txHash: Hex };

export type PayoutStatus = "sent" | "claimed" | "refunded";

export type BatchRowInput = {
  claimSigner: Address;
  amount: bigint;
  /** Optional metadata. Never used for authorization. */
  emailHash?: Hex;
};

export type BatchRow = BatchRowInput & { status: PayoutStatus };

export type Batch = {
  id: string;
  createdAt: number; // unix ms
  total: bigint;
  rows: BatchRow[];
  /** PROPOSED: tx that created the batch, for the "View transaction" link. */
  txHash: Hex;
};

export type ClaimInfo = {
  amount: bigint;
  /** Platform address that funded the payout. Display name is resolved offchain. */
  platform: Address;
  status: PayoutStatus;
};

/** PROPOSED */
export type BatchSummary = Pick<Batch, "id" | "createdAt" | "total" | "txHash"> & {
  rowCount: number;
  claimedCount: number;
};

/** PROPOSED */
export type PayeeHistoryItem = {
  kind: "received" | "sent";
  amount: bigint;
  counterparty: Address;
  txHash: Hex;
  timestamp: number; // unix ms
  /** True when this row is a claimed platform payout, not a transfer. Payouts count as income. */
  payout?: boolean;
  /** True on the "sent" row when the payee changed dollars to USDC: their own money, not a payment to anyone. */
  toUsdc?: boolean;
};

export type UsdcSettleResult = TxResult & {
  /** USDC received, in USDC base units (config.usdc.decimals). */
  amountOut: bigint;
};

export type GaslessSendResult = TxResult & {
  /** True when our relayer paid the fee; false when it went from the payee's own account instead. */
  gasless: boolean;
};

export type TestDollarsResult = TxResult & {
  /** Test dollars received, in AUSD base units. */
  amount: bigint;
};

/** Thrown when a batch or claim doesn't exist. Not worth retrying. */
export class NotFoundError extends Error {
  override name = "NotFoundError";
}
