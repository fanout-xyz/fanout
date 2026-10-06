import { isAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { activeChain } from "@/lib/chains";
import { claimVerifyingContract, config } from "@/lib/config";
import { recoverClaimSigner } from "./claim-keys";
import { NotFoundError, type Batch, type BatchRowInput, type BatchSummary, type ClaimInfo, type PayeeHistoryItem } from "./types";

/**
 * The mock "contracts": pure state + rules, no I/O. Runs on the dev server behind
 * /api/mock (so a phone and a laptop see the same payouts), and directly in tests.
 * Rules mirror what the real contracts must enforce.
 */

type MockBatch = Batch & { platform: Address };

export type MockState = {
  nextBatchId: number;
  treasury: Record<Address, bigint>;
  batches: Record<string, MockBatch>;
  /** claimSigner -> where that payout lives */
  claims: Record<Address, { batchId: string; index: number }>;
  balances: Record<Address, bigint>;
  /** USDC held, in USDC base units. Optional: state saved before USDC existed has none. */
  usdcBalances?: Record<Address, bigint>;
  history: Record<Address, PayeeHistoryItem[]>;
};

export function emptyState(): MockState {
  return { nextBatchId: 1, treasury: {}, batches: {}, claims: {}, balances: {}, usdcBalances: {}, history: {} };
}

const key = (a: Address) => a.toLowerCase() as Address;

function fakeTxHash(): Hex {
  return keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
}

function requireAccount(account: Address | undefined): Address {
  if (!account || !isAddress(account)) throw new Error("Sign in first.");
  return key(account);
}

/** 1 AUSD unit -> this many USDC units (the pair trades 1:1 in dollars, fee 0). */
const usdcPerAusdUnit = () => 10n ** BigInt(Math.max(0, config.usdc.decimals - config.stablecoin.decimals));

function pushHistory(s: MockState, address: Address, item: PayeeHistoryItem) {
  (s.history[address] ??= []).unshift(item);
}

export const engine = {
  getTreasuryBalance(s: MockState, platform: Address): bigint {
    return s.treasury[key(platform)] ?? 0n;
  },

  deposit(s: MockState, account: Address | undefined, amount: bigint) {
    const me = requireAccount(account);
    if (amount <= 0n) throw new Error("Deposit amount must be more than $0.");
    s.treasury[me] = (s.treasury[me] ?? 0n) + amount;
    return { txHash: fakeTxHash() };
  },

  createBatchPayout(s: MockState, account: Address | undefined, rows: BatchRowInput[]) {
    const me = requireAccount(account);
    if (rows.length === 0) throw new Error("A payout needs at least one row.");
    if (rows.some((r) => r.amount <= 0n)) throw new Error("Every amount must be more than $0.");
    const total = rows.reduce((sum, r) => sum + r.amount, 0n);
    if (total > (s.treasury[me] ?? 0n)) throw new Error("Not enough in the payout balance for this payout.");
    const seen = new Set<string>();
    for (const r of rows) {
      const k = key(r.claimSigner);
      if (seen.has(k) || s.claims[k]) throw new Error("Duplicate claim signer in batch.");
      seen.add(k);
    }

    const id = String(s.nextBatchId++);
    const txHash = fakeTxHash();
    s.treasury[me] -= total;
    s.batches[id] = {
      id,
      platform: me,
      createdAt: Date.now(),
      total,
      txHash,
      rows: rows.map((r) => ({ ...r, claimSigner: key(r.claimSigner), status: "sent" as const })),
    };
    rows.forEach((r, index) => (s.claims[key(r.claimSigner)] = { batchId: id, index }));
    return { batchId: id, txHash };
  },

  getBatch(s: MockState, batchId: string): Batch {
    const b = s.batches[batchId];
    if (!b) throw new NotFoundError(`Payout #${batchId} doesn't exist.`);
    return { id: b.id, createdAt: b.createdAt, total: b.total, txHash: b.txHash, rows: b.rows };
  },

  getClaim(s: MockState, claimSigner: Address): ClaimInfo {
    const ref = s.claims[key(claimSigner)];
    if (!ref) throw new NotFoundError("This payment link isn't valid.");
    const b = s.batches[ref.batchId];
    const row = b.rows[ref.index];
    return { amount: row.amount, platform: b.platform, status: row.status };
  },

  /** Verify first (async), then check and mutate synchronously so concurrent claims can't both pass. */
  async claim(s: MockState, claimSigner: Address, recipient: Address, signature: Hex) {
    if (!isAddress(recipient)) throw new Error("Invalid recipient.");
    const signer = await recoverClaimSigner(
      { recipient, claimContract: claimVerifyingContract(), chainId: activeChain.id },
      signature,
    ).catch(() => null);
    const ref = s.claims[key(claimSigner)];
    if (!ref || !signer || key(signer) !== key(claimSigner)) throw new NotFoundError("This payment link isn't valid.");
    const row = s.batches[ref.batchId].rows[ref.index];
    if (row.status === "claimed") throw new Error("This payment has already been claimed.");
    if (row.status === "refunded") throw new Error("This payment expired and was returned to the sender.");

    const txHash = fakeTxHash();
    const to = key(recipient);
    row.status = "claimed";
    s.balances[to] = (s.balances[to] ?? 0n) + row.amount;
    pushHistory(s, to, {
      kind: "received",
      amount: row.amount,
      counterparty: s.batches[ref.batchId].platform,
      txHash,
      timestamp: Date.now(),
      payout: true,
    });
    return { txHash };
  },

  getPayeeBalance(s: MockState, address: Address): bigint {
    return s.balances[key(address)] ?? 0n;
  },

  send(s: MockState, account: Address | undefined, to: Address, amount: bigint) {
    const me = requireAccount(account);
    if (!isAddress(to)) throw new Error("That address isn't valid.");
    if (amount <= 0n) throw new Error("Amount must be more than $0.");
    if (amount > (s.balances[me] ?? 0n)) throw new Error("Not enough balance.");
    const txHash = fakeTxHash();
    const dest = key(to);
    s.balances[me] -= amount;
    s.balances[dest] = (s.balances[dest] ?? 0n) + amount;
    const now = Date.now();
    pushHistory(s, me, { kind: "sent", amount, counterparty: dest, txHash, timestamp: now });
    pushHistory(s, dest, { kind: "received", amount, counterparty: me, txHash, timestamp: now });
    return { txHash };
  },

  /** Same rules as SettleToUsdc: the payee's own dollars, swapped 1:1, paid back to them. */
  receiveAsUsdc(s: MockState, account: Address | undefined, amount: bigint) {
    const me = requireAccount(account);
    if (amount <= 0n) throw new Error("Amount must be more than $0.");
    if (amount > (s.balances[me] ?? 0n)) throw new Error("Not enough balance.");
    const amountOut = amount * usdcPerAusdUnit();
    const txHash = fakeTxHash();
    const usdc = (s.usdcBalances ??= {});
    s.balances[me] -= amount;
    usdc[me] = (usdc[me] ?? 0n) + amountOut;
    pushHistory(s, me, { kind: "sent", amount, counterparty: me, txHash, timestamp: Date.now(), toUsdc: true });
    return { txHash, amountOut };
  },

  getPayeeUsdcBalance(s: MockState, address: Address): bigint {
    return s.usdcBalances?.[key(address)] ?? 0n;
  },

  listBatches(s: MockState, platform: Address): BatchSummary[] {
    const p = key(platform);
    return Object.values(s.batches)
      .filter((b) => b.platform === p)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((b) => ({
        id: b.id,
        createdAt: b.createdAt,
        total: b.total,
        txHash: b.txHash,
        rowCount: b.rows.length,
        claimedCount: b.rows.filter((r) => r.status === "claimed").length,
      }));
  },

  getPayeeHistory(s: MockState, address: Address): PayeeHistoryItem[] {
    return s.history[key(address)] ?? [];
  },

  /** Demo: simulates claim expiry. Only the platform that sent the payout can do it. */
  refundUnclaimed(s: MockState, account: Address | undefined, batchId: string) {
    const me = requireAccount(account);
    const b = s.batches[batchId];
    if (!b) throw new NotFoundError(`Payout #${batchId} doesn't exist.`);
    if (b.platform !== me) throw new Error("Only the sender can expire this payout.");
    for (const row of b.rows) {
      if (row.status === "sent") {
        row.status = "refunded";
        s.treasury[b.platform] = (s.treasury[b.platform] ?? 0n) + row.amount;
      }
    }
    return null;
  },
};

/** Methods that change state (the store saves after these). */
export const MUTATING = new Set(["deposit", "createBatchPayout", "claim", "send", "receiveAsUsdc", "refundUnclaimed"]);
export type EngineMethod = keyof typeof engine;
