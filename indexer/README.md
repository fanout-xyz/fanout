# Fanout — Envio indexer

Reads Fanout's contracts on Monad testnet and keeps a queryable history in a database, served over GraphQL. The dashboard and wallet page will read payout history, transaction links and totals from it instead of scanning the chain or this browser's local records.

It indexes the active **`monad-ausd`** deployment (addresses in `config.yaml`, from `smart-contract/README.md`), starting at block 66791223.

## What it stores

| Entity | One row per | Used for |
| --- | --- | --- |
| `Platform` | Paying wallet | Balance (mirrors `Treasury.balanceOf`), totals deposited, paid out, claimed, refunded |
| `Batch` | CSV payout | Dashboard list: total, rows, how many claimed or refunded, creation tx |
| `Claim` | Payout row (keyed by claim signer) | Status Sent / Claimed / Refunded, who claimed, when, which tx |
| `PlatformActivity` | Deposit, withdrawal, payout or refund | Dashboard ledger with explorer links |
| `Payee` | Wallet that has claimed at least once | Wallet page totals |
| `PayeeActivity` | Claim received, or AUSD sent/received after the first claim | Wallet page history |

Amounts are raw AUSD units (6 decimals). Times are unix seconds.

| Event | Effect |
| --- | --- |
| `Treasury.Deposited` / `Withdrawn` | Balance ± and a `Deposit` / `Withdraw` activity row |
| `Treasury.Debited` / `Credited` | Balance only (the batch and refund rows come from the events below) |
| `ClaimEscrow.ClaimOpened` | New `Claim` (emitted before `BatchCreated` in the same tx) |
| `BatchPayout.BatchCreated` | New `Batch` and a `Payout` activity row |
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

Update the addresses and `start_block` in `config.yaml`, run `pnpm codegen`, and resync from scratch.
