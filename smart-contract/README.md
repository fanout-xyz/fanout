# Fanout — Smart Contracts

Three Solidity contracts on Monad testnet that move the money for Fanout: **Treasury**, **BatchPayout** and **ClaimEscrow**. A platform deposits AUSD once, pays out a whole CSV in one transaction, and each payee claims their share with a one-time link. Unclaimed money goes back to the platform after expiry.

**Status:** deployed to Monad testnet on 2026-09-29, with all 17 tests passing. The web app still runs against the mock backend. Next up is [connecting the web app](#web-app-integration). Target: deposit → batch → claim working end to end on testnet by **Oct 6**.

## Deployed addresses (Monad testnet)

| Contract | Address | Deploy tx |
| --- | --- | --- |
| Treasury | [`0x74a8D547daD96f478135E475360d719df1cA2BFa`](https://testnet.monadscan.com/address/0x74a8D547daD96f478135E475360d719df1cA2BFa) | [`0x62f8…98dd`](https://testnet.monadscan.com/tx/0x62f857b967162d0d970fbc70324373f02128815ca8088a353d23c3366a4198dd) |
| ClaimEscrow | [`0x7AB0E50E02e900dc423AAF5858c8E70289B44F11`](https://testnet.monadscan.com/address/0x7AB0E50E02e900dc423AAF5858c8E70289B44F11) | [`0x6e82…74ff`](https://testnet.monadscan.com/tx/0x6e82b4f06a83ffa835aedbb5925910f3c94eb3953ee118c177f24a4fdf1374ff) |
| BatchPayout | [`0x408640A93b9e11C2e7799fd3eB1975b5B7FC10F4`](https://testnet.monadscan.com/address/0x408640A93b9e11C2e7799fd3eB1975b5B7FC10F4) | [`0xe362…c32c`](https://testnet.monadscan.com/tx/0xe36217f20d10d6cfb869d324d1030c67ed8870d243f90ef95503410d46ffc32c) |

| Setting | Value |
| --- | --- |
| Network | Monad testnet, chain id `10143`, RPC `https://testnet-rpc.monad.xyz` |
| Payout token | Agora AUSD [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadscan.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC), 6 decimals ($1 = `1_000_000`) |
| Deployer / owner | `0x978D459587b9807375E7A02ff403BED7E68d0b0e` (testnet-only wallet) |
| Claim expiry (`claimTtl`) | 30 days (`2592000` seconds) |
| Max rows per batch (`MAX_ROWS`) | 150 |
| Wiring | `ClaimEscrow.wire` [`0xbff8…a1bf`](https://testnet.monadscan.com/tx/0xbff8e33f2dc7ecf9978b59558a56803d5a1e519799e36eb7eacfab781e19a1bf), `Treasury.wire` [`0xb8c3…ae37`](https://testnet.monadscan.com/tx/0xb8c33747b28a0a3794088502b647cb4d9f27f51d29dbc31ebfd5c7c4b23bae37) |
| Blocks | 66494877 (Treasury) to 66494919 (last wire) |
| Compiler | solc 0.8.30, EVM target `cancun`, optimizer on (200 runs) |

The wiring was checked onchain after deploy. `Treasury.batchPayout`, `Treasury.claimEscrow`, `ClaimEscrow.treasury` and `ClaimEscrow.batchPayout` each hold the addresses above. The full deploy record lives in `ignition/deployments/chain-10143/`: `deployed_addresses.json` for the addresses, `journal.jsonl` for every transaction, and `artifacts/` for the exact ABIs and bytecode deployed.

## Quick start

```bash
pnpm install                 # from the repo root (this package is in the pnpm workspace)
cd smart-contract
pnpm build                   # compile contracts
pnpm test                    # 17 tests on Hardhat's in-process network
pnpm typecheck               # tsc over the config, tests and deploy module
pnpm deploy:monad            # deploy to Monad testnet (needs .env, see below)
```

The deployer key comes from `.env`, which is gitignored. Copy `.env.example` and fill it in:

```
MONAD_PRIVATE_KEY=0x...      # testnet-only wallet with MON from the Monad testnet faucet
# MONAD_RPC_URL=             # optional; defaults to https://testnet-rpc.monad.xyz
```

`hardhat.config.ts` loads `.env` with `dotenv`. Instead of the file, you can set the key as an environment variable, or store it encrypted with `pnpm hardhat keystore set MONAD_PRIVATE_KEY`. Deploying used about 0.24 MON.

## Project structure

```
smart-contract/
├── contracts/
│   ├── Treasury.sol              # per-platform AUSD balances: deposit, withdraw, debit, credit
│   ├── BatchPayout.sol           # one CSV → one transaction → many claims
│   ├── ClaimEscrow.sol           # holds each payee's AUSD; claim with a signature, refund after expiry
│   ├── interfaces/
│   │   ├── ITreasury.sol         # what BatchPayout and ClaimEscrow call on Treasury
│   │   └── IClaimEscrow.sol      # what BatchPayout calls on ClaimEscrow
│   └── test/
│       └── MockAUSD.sol          # 6-decimal ERC-20 with public mint, tests only
├── test/
│   └── Fanout.ts                 # node:test + viem; signs claims with the web app's claim-keys.ts
├── ignition/
│   ├── modules/Fanout.ts         # deploy + wire module
│   └── deployments/chain-10143/  # record of the Monad testnet deployment (commit this)
├── hardhat.config.ts             # compiler settings + monadTestnet network
├── tsconfig.json                 # strict; "preserve" modules so tests can import apps/web
├── .env.example                  # template for the deployer key
└── package.json                  # build / test / typecheck / deploy:monad scripts
```

## Stack

| Piece | Choice | Notes |
| --- | --- | --- |
| Language | Solidity 0.8.30 (`pragma ^0.8.24`) | EVM target pinned to `cancun` so a newer compiler default can't produce opcodes Monad doesn't support |
| Framework | Hardhat 3 with `hardhat-toolbox-viem` | TypeScript tests on the Node test runner, using viem like the web app does |
| Library | OpenZeppelin Contracts 5 | `SafeERC20`, `ECDSA`, `MessageHashUtils`, `Ownable`, `ReentrancyGuard`, `ERC20` (mock) |
| Deploy | Hardhat Ignition | Deploys and wires in one run; can resume if interrupted |
| Network | Monad testnet, chain id `10143` | Gas paid in MON |

## How it works

```
                  deposit / withdraw
Platform wallet ◀──────────────────▶ Treasury
      │                                │  ▲
      │ createBatch(rows)              │  │ credit (refund)
      ▼                                │  │
  BatchPayout ──debit(total)───────────┘  │
      │           (AUSD → ClaimEscrow)    │
      └──open(rows)──▶ ClaimEscrow ───────┘
                          │   (AUSD → Treasury on refund)
                          │
                 claim(sig)▼
                     Payee wallet
```

1. **Deposit.** The platform approves the Treasury to spend its AUSD, then calls `Treasury.deposit(amount)`. The Treasury keeps a separate balance for each platform.
2. **Batch.** The platform calls `BatchPayout.createBatch(claimSigners, amounts, emailHashes)`. In one transaction, BatchPayout checks the rows, stores the batch, and calls `Treasury.debit`, which lowers the platform's balance and moves the total to ClaimEscrow. It then calls `ClaimEscrow.open`, which opens one claim per row with a 30-day expiry.
3. **Claim.** The payee opens `/claim#k=<key>`. Their browser uses the one-time key to sign their wallet address, and anyone can submit `ClaimEscrow.claim(...)`. The AUSD goes straight to the payee's wallet.
4. **Refund.** Once a claim has expired, anyone can call `ClaimEscrow.refund(claimSigner)`. The AUSD goes back to the Treasury and is added back to the platform's balance, where it can be used for another batch or withdrawn.

Money only ever sits in two places: the Treasury (deposited but not yet paid out) and the ClaimEscrow (paid out but not yet claimed or refunded). At any time, the Treasury's AUSD balance equals the sum of all platform balances. The ClaimEscrow's AUSD balance equals the sum of all claims that are still in the sent state.

## Contracts

### Treasury

`contracts/Treasury.sol`. Holds each platform's deposited AUSD. It is `Ownable` (the owner is the deployer) and uses `ReentrancyGuard`.

**Storage**

| Variable | Type | Meaning |
| --- | --- | --- |
| `ausd` | `IERC20 immutable` | The payout token |
| `batchPayout` | `address` | The only address allowed to call `debit`. Set once by `wire` |
| `claimEscrow` | `address` | The only address allowed to call `credit`, and where `debit` sends AUSD. Set once by `wire` |
| `balanceOf` | `mapping(address => uint256)` | Each platform's available balance |

**Functions**

| Function | Who can call | What it does |
| --- | --- | --- |
| `constructor(IERC20 ausd)` | Deployer | Sets the token; the deployer becomes owner |
| `wire(address batchPayout, address claimEscrow)` | Owner, once | Sets the two trusted contracts. Reverts `AlreadyWired` the second time |
| `deposit(uint256 amount)` | Platform | Pulls `amount` AUSD from the caller (`safeTransferFrom`) and adds it to their balance |
| `withdraw(uint256 amount)` | Platform | Lowers the caller's balance and sends the AUSD back to them |
| `debit(address platform, uint256 amount)` | BatchPayout only | Lowers `platform`'s balance and sends `amount` AUSD to ClaimEscrow |
| `credit(address platform, uint256 amount)` | ClaimEscrow only | Adds `amount` back to `platform`'s balance. ClaimEscrow sends the AUSD before calling this |
| `balanceOf(address platform) view` | Anyone | The platform's current balance |

**Events:** `Deposited(platform indexed, amount)`, `Withdrawn(platform indexed, amount)`, `Debited(platform indexed, amount)`, `Credited(platform indexed, amount)`.

**Errors:** `ZeroAmount`, `ZeroAddress`, `AlreadyWired`, `Unauthorized`, `InsufficientBalance(balance, needed)`, plus OpenZeppelin's `OwnableUnauthorizedAccount` and the token's own errors (for example, `ERC20InsufficientAllowance` when a deposit wasn't approved).

### BatchPayout

`contracts/BatchPayout.sol`. Turns one approved CSV into many claims in a single transaction. It has no owner and holds no money.

**Storage**

| Variable | Type | Meaning |
| --- | --- | --- |
| `MAX_ROWS` | `constant = 150` | The most rows one batch can hold |
| `treasury` | `ITreasury immutable` | Where the money comes from |
| `claimEscrow` | `IClaimEscrow immutable` | Where the claims are opened |
| `claimTtl` | `uint64 immutable` | Seconds until a claim can be refunded; 30 days on testnet |
| `nextBatchId` | `uint256` | Starts at 1, so batch id 0 never exists |
| `_batches` | `mapping(uint256 => Batch)` | `Batch { address platform; uint64 createdAt; uint256 total; address[] claimSigners; }` |

**Functions**

| Function | Who can call | What it does |
| --- | --- | --- |
| `constructor(ITreasury, IClaimEscrow, uint64 claimTtl)` | Deployer | Sets the trusted contracts and the expiry |
| `createBatch(address[] claimSigners, uint256[] amounts, bytes32[] emailHashes) → uint256 batchId` | Any platform | Checks there is at least one row, no more than `MAX_ROWS`, and that all three arrays are the same length. Adds up the total, stores the batch, debits the caller's Treasury balance and opens the claims with `expiresAt = now + claimTtl` |
| `getBatch(uint256 batchId) view → (platform, createdAt, total, claimSigners)` | Anyone | Returns `platform = address(0)` for an unknown batch; the web app treats that as "not found" |

`emailHashes` entries are `bytes32(0)` when a row has no email. They are stored for display only and never used to authorize a claim.

**Events:** `BatchCreated(uint256 indexed batchId, address indexed platform, uint256 total, uint256 count)`. The web app reads `batchId` from this event after the transaction.

**Errors:** `ZeroAddress`, `EmptyBatch`, `TooManyRows(count, max)`, `LengthMismatch`. Errors from row checks and balance checks come from ClaimEscrow and Treasury (see below). They pass through unchanged, so viem decodes them by name.

### ClaimEscrow

`contracts/ClaimEscrow.sol`. Holds each payee's AUSD until it is claimed or refunded. It is `Ownable` (the owner is the deployer, used only for `wire`) and uses `ReentrancyGuard`.

**Storage**

| Variable | Type | Meaning |
| --- | --- | --- |
| `ausd` | `IERC20 immutable` | The payout token |
| `treasury` | `ITreasury immutable` | Where refunds go |
| `batchPayout` | `address` | The only address allowed to call `open`. Set once by `wire` |
| `claims` | `mapping(address claimSigner => Claim)` | `Claim { uint256 amount; address platform; Status status; uint64 expiresAt; bytes32 emailHash; }` |

`Status` is `Sent = 0`, `Claimed = 1`, `Refunded = 2`, which matches the web app's `["sent", "claimed", "refunded"]`. A claim record is never deleted. Its non-zero `amount` is how the contract knows a `claimSigner` has already been used.

**Functions**

| Function | Who can call | What it does |
| --- | --- | --- |
| `constructor(IERC20 ausd, ITreasury treasury)` | Deployer | Sets the token and Treasury; the deployer becomes owner |
| `wire(address batchPayout)` | Owner, once | Sets the one contract allowed to open claims |
| `open(batchId, platform, claimSigners[], amounts[], emailHashes[], expiresAt)` | BatchPayout only | Records one `Sent` claim per row. Rejects a zero signer, a zero amount, and a signer that has already been used, including a duplicate within the same batch |
| `getClaim(address claimSigner) view → (amount, platform, status, emailHash)` | Anyone | Returns `amount = 0` for an unknown claim; the web app treats that as "link not valid" |
| `claims(address claimSigner) view` | Anyone | The full record, including `expiresAt` |
| `claim(address claimSigner, address recipient, bytes signature)` | Anyone (a relayer can pay gas) | Checks the signature (see below), marks the claim `Claimed` and sends the AUSD to `recipient` |
| `refund(address claimSigner)` | Anyone, once `block.timestamp >= expiresAt` | Marks the claim `Refunded`, sends the AUSD to the Treasury and calls `Treasury.credit` |

A claim that has expired but hasn't been refunded can still be claimed. Expiry only makes a refund possible; it doesn't cut the payee off. Whichever call lands first wins.

**Events:** `ClaimOpened(claimSigner indexed, platform indexed, batchId indexed, amount, expiresAt)`, `Claimed(claimSigner indexed, recipient indexed, amount)`, `Refunded(claimSigner indexed, platform indexed, amount)`.

**Errors:** `ZeroAddress`, `ZeroAmount`, `AlreadyWired`, `Unauthorized`, `LengthMismatch`, `ClaimSignerUsed(claimSigner)`, `UnknownClaim`, `NotClaimable(status)`, `BadSignature`, `NotExpired(expiresAt)`.

## Claim links and signatures

A claim is unlocked by a one-time key that lives only in the payee's link. The web app side is `apps/web/lib/fanout/claim-keys.ts`, and the tests import that exact file, so the contract is checked against the real client code.

1. When the platform approves a payout, the browser generates a fresh keypair for each row. The address (`claimSigner`) goes onchain in `createBatch`.
2. The private key goes only into the link, `/claim#k=<key>`. Browsers never send the part after `#` to a server.
3. On the claim page, the key signs the recipient address, the ClaimEscrow address and the chain id, as an EIP-191 personal message.
4. `claim(...)` recovers the signer and checks that it equals `claimSigner`.

```solidity
bytes32 digest = keccak256(abi.encode(recipient, address(this), block.chainid));
(address signer, ECDSA.RecoverError err,) =
    ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(digest), signature);
if (err != ECDSA.RecoverError.NoError || signer != claimSigner) revert BadSignature();
c.status = Status.Claimed;           // state first
ausd.safeTransfer(recipient, amount); // then the transfer
```

- **Signing the recipient** means anyone can submit the transaction, but nobody can swap in their own address. This lets a relayer pay gas for payees whose new wallets have no MON.
- **Signing the contract address and chain id** stops the signature from being reused on another deployment or another chain.
- **Setting the status to claimed** stops the same signature from being used twice.
- **`tryRecover`** turns a malformed signature into `BadSignature` instead of an opaque OpenZeppelin error.

## Security design

| Risk | How it's handled |
| --- | --- |
| Anyone draining a platform's balance | `Treasury.debit` only accepts calls from BatchPayout, and BatchPayout always debits `msg.sender`, so a platform can only spend its own balance |
| Anyone creating claims against escrowed money | `ClaimEscrow.open` only accepts calls from BatchPayout |
| Fake refunds | `Treasury.credit` only accepts calls from ClaimEscrow, which only credits after sending the AUSD back |
| The owner swapping in a malicious contract later | `wire` works once and the addresses can never change. After wiring, the owner has no remaining powers |
| Front-running a claim | The signature binds the recipient |
| Replaying a signature | The signature binds the contract and chain, and a claim can only move out of `Sent` once |
| Re-entrancy through token transfers | State changes before every transfer, and `nonReentrant` on `deposit`, `withdraw`, `claim` and `refund` |
| Bad CSV rows locking or losing money | All three arrays must be the same length; no zero amount; no zero, reused or duplicate `claimSigner`; at most 150 rows |
| Tokens that return `false` instead of reverting | All transfers go through `SafeERC20` |

These contracts are unaudited and deployed to testnet only. They assume AUSD is a standard ERC-20: no fee on transfer and no rebasing.

## Gas and limits

- `createBatch` costs about **85k gas per row**. Most of that is three new storage slots per claim, plus one slot for the signer in the batch record.
- A full 150-row batch measured **12.7M gas**. That's under the 16.7M per-transaction cap (EIP-7825), which Hardhat enforces by default. 200 rows ran out of gas.
- The web app must split CSVs with more than 150 rows into several batches.
- Monad charges for the gas limit you set, not the gas actually used, so avoid setting limits far above the estimate.

## Tests

`pnpm test` runs `test/Fanout.ts`: 17 tests on Hardhat's in-process network. Each test starts from a fresh snapshot via `loadFixture`.

| Area | What's covered |
| --- | --- |
| Treasury | Deposit raises the balance and emits `Deposited`; a deposit without approval fails; withdraw works and can't exceed the balance; only BatchPayout can `debit` and only ClaimEscrow can `credit`; `wire` works once and only for the owner |
| BatchPayout | A 150-row batch in one transaction (logs gas); `BatchCreated` with increasing ids; rejects an empty batch, mismatched arrays, 151 rows, a zero amount, a zero signer, a duplicate signer, a reused signer and too little balance; unknown `getBatch` and `getClaim` return zero values; only BatchPayout can `open` |
| ClaimEscrow | A relayer submits a valid claim and the payee is paid without spending gas; `Claimed` is emitted; rejects a wrong key, a swapped recipient, garbage signature bytes and a second attempt; rejects signatures made for another contract or chain; rejects unknown claims and a zero recipient; refund fails before expiry, works after it, credits the platform (which can then withdraw), and blocks any later claim or refund; an expired claim can still be claimed until someone refunds it |

## Deploying

`pnpm deploy:monad` runs `ignition/modules/Fanout.ts`, which does these steps in order:

1. `Treasury(ausd)`
2. `ClaimEscrow(ausd, Treasury)`
3. `BatchPayout(Treasury, ClaimEscrow, claimTtl)`
4. `ClaimEscrow.wire(BatchPayout)` and `Treasury.wire(BatchPayout, ClaimEscrow)`

| Parameter | Default |
| --- | --- |
| `ausd` | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` (testnet AUSD) |
| `claimTtl` | `2592000` (30 days) |

Override them with `--parameters params.json`, for example `{ "Fanout": { "claimTtl": "3600" } }`.

Ignition remembers what it has already deployed. Running `pnpm deploy:monad` again with unchanged contracts does nothing. After changing a contract, deploy fresh with a new id, then update the addresses here and in the web app:

```bash
pnpm hardhat ignition deploy ignition/modules/Fanout.ts --network monadTestnet --deployment-id fanout-v2
```

To try the module without spending MON, run `pnpm hardhat ignition deploy ignition/modules/Fanout.ts` against the in-process network. It needs a `--parameters` file pointing `ausd` at any address, because testnet AUSD doesn't exist locally.

## Web app integration

The web app (`apps/web`) was written against draft versions of these contracts. Every function name, argument order and return shape it uses is unchanged, so `apps/web/lib/fanout/onchain-client.ts` needs no changes. To switch it from the mock to the live contracts:

1. In `apps/web/.env.local`:
   ```
   NEXT_PUBLIC_USE_MOCK=false
   NEXT_PUBLIC_TREASURY_ADDRESS=0x74a8D547daD96f478135E475360d719df1cA2BFa
   NEXT_PUBLIC_BATCH_PAYOUT_ADDRESS=0x408640A93b9e11C2e7799fd3eB1975b5B7FC10F4
   NEXT_PUBLIC_CLAIM_ESCROW_ADDRESS=0x7AB0E50E02e900dc423AAF5858c8E70289B44F11
   ```
2. Replace the placeholder ABIs in `apps/web/lib/fanout/abis/index.ts` with the deployed ones from `ignition/deployments/chain-10143/artifacts/`. The generated ABIs also include the custom errors, so failed transactions show readable reasons.
3. Split CSVs larger than 150 rows into several `createBatch` calls.
4. Run deposit → CSV → approve → claim on the live site.

Still to do on the web app side:
- **Gas for payees.** `claim` and `send` currently expect the payee's wallet to pay gas, and a new wallet has no MON. The contract already supports a relayer or gas sponsorship, because the signature binds the recipient.
- **History.** Batch lists and payee history need the Envio indexer. It should read the `BatchCreated`, `ClaimOpened`, `Claimed`, `Refunded`, `Deposited` and `Withdrawn` events.

## Open questions

- Is 30 days the right claim expiry? It's a deploy parameter, so changing it means a redeploy but no code change.
- Who pays gas for payee claims and sends: a relayer, or gas sponsored through Privy?
- Does the web app expose `refund` and `withdraw`, or do they stay admin-only for the demo? Anyone can call `refund` after expiry, so a script or cron job could handle it.
