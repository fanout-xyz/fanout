import { isAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { activeChain } from "@/lib/chains";
import { claimVerifyingContract } from "@/lib/config";
import { recoverClaimSigner } from "./claim-keys";
import type { FanoutClient, FanoutClientContext } from "./client";
import { NotFoundError, type Batch, type BatchSummary, type PayeeHistoryItem } from "./types";

/**
 * In-memory stand-in for the contracts. State lives in this module and is mirrored
 * to localStorage so it survives reloads in the same browser. It is NOT shared
 * across devices: a claim link opened on a phone won't see a batch created on a laptop.
 */

type MockBatch = Batch & { platform: Address };

type MockState = {
  nextBatchId: number;
  treasury: Record<Address, bigint>;
  batches: Record<string, MockBatch>;
  /** claimSigner -> where that payout lives */
  claims: Record<Address, { batchId: string; index: number }>;
  balances: Record<Address, bigint>;
  history: Record<Address, PayeeHistoryItem[]>;
};

const STORAGE_KEY = "fanout.mock.v1";

function emptyState(): MockState {
  return { nextBatchId: 1, treasury: {}, batches: {}, claims: {}, balances: {}, history: {} };
}

// bigint isn't JSON-serializable; tag it on the way out and back in.
function serialize(state: MockState): string {
  return JSON.stringify(state, (_k, v) => (typeof v === "bigint" ? { __big: v.toString() } : v));
}
function deserialize(raw: string): MockState {
  return JSON.parse(raw, (_k, v) =>
    v && typeof v === "object" && typeof v.__big === "string" ? BigInt(v.__big) : v,
  );
}

let state: MockState | null = null;

function load(): MockState {
  if (state) return state;
  state = emptyState();
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (raw) state = deserialize(raw);
  } catch {
    // Storage unavailable or corrupt: start fresh.
  }
  return state;
}

function save() {
  try {
    if (typeof window !== "undefined" && state) window.localStorage.setItem(STORAGE_KEY, serialize(state));
  } catch {
    // Non-fatal: state still lives in memory for this tab.
  }
}

const key = (a: Address) => a.toLowerCase() as Address;

function fakeTxHash(): Hex {
  return keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
}

function delay(min = 500, max = 1200): Promise<void> {
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

function requireAccount(ctx: FanoutClientContext): Address {
  if (!ctx.account) throw new Error("Sign in first.");
  return key(ctx.account);
}

function pushHistory(s: MockState, address: Address, item: PayeeHistoryItem) {
  (s.history[address] ??= []).unshift(item);
}

export function createMockClient(ctx: FanoutClientContext): FanoutClient {
  return {
    async getTreasuryBalance(platform) {
      await delay(150, 400);
      return load().treasury[key(platform)] ?? 0n;
    },

    async deposit(amount) {
      const me = requireAccount(ctx);
      if (amount <= 0n) throw new Error("Deposit amount must be more than $0.");
      await delay();
      const s = load();
      s.treasury[me] = (s.treasury[me] ?? 0n) + amount;
      save();
      return { txHash: fakeTxHash() };
    },

    async createBatchPayout(rows) {
      const me = requireAccount(ctx);
      if (rows.length === 0) throw new Error("A payout needs at least one row.");
      await delay(800, 1600);
      const s = load();
      const total = rows.reduce((sum, r) => sum + r.amount, 0n);
      if (rows.some((r) => r.amount <= 0n)) throw new Error("Every amount must be more than $0.");
      if (total > (s.treasury[me] ?? 0n)) throw new Error("Not enough in the treasury for this payout.");
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
      save();
      return { batchId: id, txHash };
    },

    async getBatch(batchId) {
      await delay(150, 400);
      const b = load().batches[batchId];
      if (!b) throw new NotFoundError(`Payout #${batchId} doesn't exist.`);
      return structuredClone({ id: b.id, createdAt: b.createdAt, total: b.total, txHash: b.txHash, rows: b.rows });
    },

    async getClaim(claimSigner) {
      await delay(200, 500);
      const s = load();
      const ref = s.claims[key(claimSigner)];
      if (!ref) throw new NotFoundError("This payment link isn't valid.");
      const b = s.batches[ref.batchId];
      const row = b.rows[ref.index];
      return { amount: row.amount, platform: b.platform, status: row.status };
    },

    async claim(claimSigner, recipient, signature) {
      if (!isAddress(recipient)) throw new Error("Invalid recipient.");
      await delay(700, 1400);
      const s = load();
      const ref = s.claims[key(claimSigner)];
      if (!ref) throw new Error("This payment link isn't valid.");
      const row = s.batches[ref.batchId].rows[ref.index];
      if (row.status === "claimed") throw new Error("This payment has already been claimed.");
      if (row.status === "refunded") throw new Error("This payment expired and was returned to the sender.");

      // Verify exactly what the contract will verify.
      const signer = await recoverClaimSigner(
        { recipient, claimContract: claimVerifyingContract(), chainId: activeChain.id },
        signature,
      );
      if (key(signer) !== key(claimSigner)) throw new Error("This payment link isn't valid.");
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
      });
      save();
      return { txHash };
    },

    async getPayeeBalance(address) {
      await delay(150, 400);
      return load().balances[key(address)] ?? 0n;
    },

    async send(to, amount) {
      const me = requireAccount(ctx);
      if (!isAddress(to)) throw new Error("That address isn't valid.");
      if (amount <= 0n) throw new Error("Amount must be more than $0.");
      await delay();
      const s = load();
      if (amount > (s.balances[me] ?? 0n)) throw new Error("Not enough balance.");
      const txHash = fakeTxHash();
      const dest = key(to);
      s.balances[me] -= amount;
      s.balances[dest] = (s.balances[dest] ?? 0n) + amount;
      const now = Date.now();
      pushHistory(s, me, { kind: "sent", amount, counterparty: dest, txHash, timestamp: now });
      pushHistory(s, dest, { kind: "received", amount, counterparty: me, txHash, timestamp: now });
      save();
      return { txHash };
    },

    async listBatches(platform) {
      await delay(150, 400);
      const p = key(platform);
      return Object.values(load().batches)
        .filter((b) => b.platform === p)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(
          (b): BatchSummary => ({
            id: b.id,
            createdAt: b.createdAt,
            total: b.total,
            txHash: b.txHash,
            rowCount: b.rows.length,
            claimedCount: b.rows.filter((r) => r.status === "claimed").length,
          }),
        );
    },

    async getPayeeHistory(address) {
      await delay(150, 400);
      return structuredClone(load().history[key(address)] ?? []);
    },
  };
}

// --- Dev helpers (not part of FanoutClient) --------------------------------

/** Simulates claim expiry: unclaimed rows go back to the platform's treasury. */
export function mockRefundUnclaimed(batchId: string): void {
  const s = load();
  const b = s.batches[batchId];
  if (!b) throw new Error(`Payout ${batchId} not found.`);
  for (const row of b.rows) {
    if (row.status === "sent") {
      row.status = "refunded";
      s.treasury[b.platform] = (s.treasury[b.platform] ?? 0n) + row.amount;
    }
  }
  save();
}

export function mockReset(): void {
  state = emptyState();
  save();
}
