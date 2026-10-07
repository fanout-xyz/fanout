# Fanout — Envio indexer

Reads Fanout's contracts on Monad testnet and keeps a queryable history in a database, served over GraphQL. The dashboard and wallet page will read payout history, transaction links and totals from it instead of scanning the chain or this browser's local records.

It indexes the **`monad-ausd`** deployment and, once its addresses are filled in, **`monad-v3`** (addresses in `config.yaml`, from `smart-contract/README.md`), starting at block 66791223. Both emit the same events, and v3 payout ids start at 1001, so their payouts, claims and payees share one set of entities. `Batch.batchPayout` says which deployment a payout belongs to; with the v3 contracts the app asks only for v3 payouts.

## What it stores

| Entity | One row per | Used for |
| --- | --- | --- |
| `Platform` | Paying wallet | Balance (mirrors `Treasury.balanceOf`), totals deposited, paid out, claimed, refunded |
| `Batch` | CSV payout | Dashboard list: total, rows, how many claimed or refunded, creation tx, claim window end (`expiresAt`), deployment (`batchPayout`) |
| `Claim` | Payout row (keyed by claim signer) | Status Sent / Claimed / Refunded, who claimed, when, which tx |
| `PlatformActivity` | Deposit, withdrawal, payout or refund | Dashboard ledger with explorer links |
| `Payee` | Wallet that has claimed at least once | Wallet page totals |
| `PayeeActivity` | Claim received, or AUSD sent/received after the first claim | Wallet page history |

Amounts are raw AUSD units (6 decimals). Times are unix seconds.

| Event | Effect |
| --- | --- |
| `Treasury.Deposited` / `Withdrawn` | Balance ± and a `Deposit` / `Withdraw` activity row |
| `Treasury.Debited` / `Credited` | Balance only (the batch and refund rows come from the events below) |
| `ClaimEscrow.ClaimOpened` | New `Claim` (emitted before `BatchCreated` in the same tx); the first one starts the `Batch` with its `expiresAt` |
| `BatchPayout.BatchCreated` | Completes the `Batch` (total, rows, contract) and writes a `Payout` activity row |
| `ClaimEscrow.Claimed` | Claim → Claimed, batch/platform counts, `Payee` + `Received` row |
| `ClaimEscrow.Refunded` | Claim → Refunded, batch/platform counts, `Refund` row |
| `AUSD.Transfer` | Only if sender or receiver is a known payee: `Sent` / `Received` row. Transfers out of ClaimEscrow are skipped (the claim row already covers them). |

## Run it

This folder is its own pnpm project (it has its own `pnpm-workspace.yaml`), so install here, not at the repo root.

```bash
cd indexer
pnpm install
cp .env.example .env   # then paste your Envio API token (https://envio.dev/app/api-tokens)
pnpm codegen           # after any change to config.yaml or schema.graphql
pnpm test              # handler tests with simulated events, no network needed
pnpm dev               # local indexer; needs Docker. GraphQL at http://localhost:8080 (password: testing)
```

## Example queries

A platform's payouts, newest first:

```graphql
query ($platform: String!) {
  Batch(where: { platform_id: { _eq: $platform } }, order_by: { createdAt: desc }) {
    id total rowCount claimedCount refundedCount createdAt txHash
  }
}
```

A payee's wallet history:

```graphql
query ($payee: String!) {
  PayeeActivity(where: { payee_id: { _eq: $payee } }, order_by: { timestamp: desc }) {
    kind amount counterparty txHash timestamp
  }
}
```

Addresses are checksummed, the same as viem's `getAddress`.

## After a redeploy of the contracts

For `monad-v3`: in `config.yaml`, uncomment the three `monad-v3` addresses and fill them in from `smart-contract/ignition/deployments/monad-v3/deployed_addresses.json`. Keep `start_block` (it covers both deployments). Run `pnpm codegen` and `pnpm test`, then redeploy the hosted indexer, which resyncs from scratch. The free Envio plan gives the new deployment its own URL: set `NEXT_PUBLIC_INDEXER_URL` in the web app to it.

For any other redeploy: update the addresses and `start_block`, run `pnpm codegen`, and resync. A new `BatchPayout` that shares this indexer with older ones must start its payout ids after theirs (Ignition parameter `firstBatchId`).
