# Fanout — Smart Contracts

Three Solidity contracts on Monad testnet that move the money for Fanout: **Treasury**, **BatchPayout** and **ClaimEscrow**. Built and tested with Hardhat. Target: deposit → batch → claim working end to end on testnet by **Oct 6**.

The web app (`apps/web`) is already written against draft versions of these contracts in `apps/web/lib/fanout/abis/index.ts`. This spec follows those drafts and lists what they are missing.

## Stack

| Piece | Choice | Notes |
| --- | --- | --- |
| Language | Solidity 0.8.x | Monad runs Ethereum-style contracts unchanged |
| Framework | Hardhat, TypeScript + viem template | Matches the web app, which already uses viem |
| Library | OpenZeppelin Contracts | `SafeERC20`, `ECDSA`, `MessageHashUtils`, `Ownable`, `ReentrancyGuard` |
| Network | Monad testnet, chain id `10143` | RPC `https://testnet-rpc.monad.xyz`; gas paid in MON from the faucet |
| Payout token | Agora AUSD, `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` | 6 decimals, so $1 = `1_000_000` |

## Money flow

```
Platform wallet ──deposit──▶ Treasury ──BatchPayout.createBatch──▶ ClaimEscrow ──claim──▶ Payee wallet
                              ▲          (one tx for all rows)          │
                              └────────── refund after expiry ──────────┘
```

1. **Deposit.** The platform approves the Treasury to spend its AUSD, then calls `Treasury.deposit(amount)`. The web app already does both steps.
2. **Batch.** The platform calls `BatchPayout.createBatch(...)`. In one transaction it takes the total from the platform's Treasury balance and opens one claim per payee in ClaimEscrow.
3. **Claim.** The payee's browser signs a claim, and anyone submits `ClaimEscrow.claim(...)`. AUSD moves to the payee's wallet.
4. **Refund.** If a claim is still unclaimed after the expiry time, its amount goes back to the platform's Treasury balance.

## Contract spec

Keep the names and argument order of the existing functions, or change `apps/web/lib/fanout/onchain-client.ts` to match. Items marked **new** are not in the drafts (see [Gaps](#gaps-in-the-draft-abis)).

### Treasury

Holds each platform's deposited AUSD.

| Function / event | Who calls it | What it does |
| --- | --- | --- |
| `deposit(uint256 amount)` | Platform | Pulls `amount` AUSD from the caller with `safeTransferFrom` and adds it to their balance |
| `balanceOf(address platform) view → uint256` | Anyone | The platform's current balance |
| `debit(address platform, uint256 amount)` **new** | BatchPayout only | Lowers the balance and sends the AUSD to ClaimEscrow |
| `credit(address platform, uint256 amount)` **new** | ClaimEscrow only | Adds a refunded amount back to the balance |
| `withdraw(uint256 amount)` **new** | Platform | Sends unused balance back to the platform's wallet |
| `Deposited(platform indexed, amount)` **new** | Event | For the indexer and the dashboard |

### BatchPayout

Turns one approved CSV into many claims in a single transaction.

| Function / event | Who calls it | What it does |
| --- | --- | --- |
| `createBatch(address[] claimSigners, uint256[] amounts, bytes32[] emailHashes) → uint256 batchId` | Platform | Checks the rows, debits the sum from the caller's Treasury balance, opens one claim per row in ClaimEscrow |
| `getBatch(uint256 batchId) view → (address platform, uint64 createdAt, uint256 total, address[] claimSigners)` | Anyone | Returns `platform = address(0)` when the batch doesn't exist; the web app treats that as "not found" |
| `BatchCreated(uint256 indexed batchId, address indexed platform, uint256 total, uint256 count)` | Event | The web app reads `batchId` from this event after the transaction |

`emailHashes` entries are `bytes32(0)` when a row has no email. They are stored for display only and never used to authorize a claim.

### ClaimEscrow

Holds each payee's money until it is claimed or refunded.

| Function / event | Who calls it | What it does |
| --- | --- | --- |
| `getClaim(address claimSigner) view → (uint256 amount, address platform, uint8 status, bytes32 emailHash)` | Anyone | Returns `amount = 0` for an unknown claim; the web app treats that as "link not valid" |
| `claim(address claimSigner, address recipient, bytes signature)` | Anyone (a relayer can pay gas) | Checks the signature, marks the claim claimed, sends AUSD to `recipient` |
| `open(...)` **new** | BatchPayout only | Records one claim: amount, platform, email hash, expiry |
| `refund(address claimSigner)` **new** | Anyone, after expiry | Marks the claim refunded and credits the platform's Treasury balance |
| `Claimed(claimSigner indexed, recipient indexed, amount)`, `Refunded(claimSigner indexed, platform indexed, amount)` **new** | Events | For the indexer and the payout detail page |

Claim `status` values must match the web app: `0` = sent, `1` = claimed, `2` = refunded.

## Claim links and signatures

A claim is unlocked by a one-time key that lives only in the payee's email link. The web app side is in `apps/web/lib/fanout/claim-keys.ts`; the contract must match it exactly.

1. When the platform approves a payout, the browser makes a fresh keypair per row. The address (`claimSigner`) goes onchain in `createBatch`.
2. The private key goes only into the link, `/claim#k=<key>`. Browsers never send the part after `#` to a server.
3. On the claim page, the key signs the recipient address, the ClaimEscrow address and the chain id.
4. `claim(...)` recovers the signer and checks it equals `claimSigner`.

```solidity
bytes32 digest = keccak256(abi.encode(recipient, address(this), block.chainid));
address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(digest), signature);
require(signer == claimSigner, "bad signature");
require(c.status == Status.Sent, "not claimable");
c.status = Status.Claimed;           // update state before the transfer
ausd.safeTransfer(recipient, c.amount);
```

- **Signing the recipient** means anyone can submit the transaction, but nobody can swap in their own address. This lets a relayer pay gas for payees whose new wallets have no MON.
- **Signing the contract address and chain id** stops the signature from being reused on another contract or chain.
- **Setting the status to claimed** stops the same signature from being used twice.

## Gaps in the draft ABIs

| Gap | Why it matters | What to add |
| --- | --- | --- |
| Refunds | The PRD requires unclaimed money to return to the platform | An expiry time per claim (set in `createBatch`) and `refund(claimSigner)`, callable after expiry |
| Who can move Treasury money | Without it, anyone could drain a platform's balance | `debit` callable only by BatchPayout, `credit` only by ClaimEscrow; set these addresses once after deploy |
| Who can open claims | Without it, anyone could create claims against escrowed money | `ClaimEscrow.open` callable only by BatchPayout |
| Input checks | Bad rows would lock or lose money | Same length for all three arrays; no zero amount; no zero or already-used `claimSigner`; a maximum row count per batch |
| Withdraw | A platform can't get unused money back | `Treasury.withdraw(amount)` |
| Events | The indexer (Envio) and dashboard history need them | `Deposited`, `Claimed`, `Refunded`, alongside `BatchCreated` |
| Re-entrancy | Token transfers call out to another contract | Update state before transferring, and use `ReentrancyGuard` on `claim`, `refund` and `withdraw` |

## Build plan

1. **Set up the project**
   - `cd smart-contract && pnpm dlx hardhat --init`, then pick the TypeScript + viem template.
   - `pnpm add @openzeppelin/contracts`
   - Add `"smart-contract"` to `pnpm-workspace.yaml` next to `"apps/*"`.
2. **Add Monad testnet to `hardhat.config.ts`**
   - Network `monadTestnet`: RPC `https://testnet-rpc.monad.xyz`, chain id `10143`.
   - The deployer's private key comes from an environment variable, never from a committed file.
   - Get MON for the deployer from the Monad testnet faucet.
3. **Write the contracts** in `contracts/`: `Treasury.sol`, `ClaimEscrow.sol`, `BatchPayout.sol`, plus a `MockAUSD.sol` (ERC-20 with 6 decimals) for tests.
4. **Test** in `test/` with TypeScript and viem, using the same signing logic as `apps/web/lib/fanout/claim-keys.ts`. Run with `pnpm hardhat test`.
5. **Deploy** with a Hardhat Ignition module or deploy script, in this order:
   1. `Treasury(AUSD)`
   2. `ClaimEscrow(AUSD, Treasury)`
   3. `BatchPayout(Treasury, ClaimEscrow)`
   4. Wire permissions: tell Treasury and ClaimEscrow the BatchPayout address, and Treasury the ClaimEscrow address.
6. **Wire up the web app**
   - Put the three addresses in `apps/web/.env.local` and set `NEXT_PUBLIC_USE_MOCK=false`.
   - Replace the draft ABIs in `apps/web/lib/fanout/abis/index.ts` with the real ones from `smart-contract/artifacts/`.
   - Run deposit → CSV → approve → claim on the live site.

## Test checklist

- [ ] Deposit raises the platform's Treasury balance; deposit without approval fails
- [ ] `createBatch` with 50+ rows succeeds in one transaction and emits `BatchCreated`
- [ ] `createBatch` fails on mismatched arrays, a zero amount, a reused `claimSigner`, or too little balance
- [ ] `getBatch` and `getClaim` return zero values for unknown ids
- [ ] Claim with a valid signature pays the recipient and sets status to claimed
- [ ] Claim fails with a wrong signature, a swapped recipient, or a second attempt
- [ ] A signature made for another contract address or chain id is rejected
- [ ] Refund fails before expiry, works after, and credits the platform's balance
- [ ] Only BatchPayout can call `debit` and `open`; only ClaimEscrow can call `credit`
- [ ] Withdraw returns unused balance and can't exceed it

## Open questions

- How long should a claim link stay valid before it can be refunded?
- Who pays gas for payee claims and sends: a relayer, or sponsored gas through Privy?
- Should a batch have a maximum row count, and what is it on Monad's gas limit?
- Does the web app call `refund` and `withdraw`, or are they admin-only for the demo?
