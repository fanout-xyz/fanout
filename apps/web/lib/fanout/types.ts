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
};
