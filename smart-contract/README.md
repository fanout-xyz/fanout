# Fanout — Smart Contracts

Three Solidity contracts on Monad testnet that move the money for Fanout: **Treasury**, **BatchPayout** and **ClaimEscrow**. A platform deposits AUSD once, pays out a whole CSV in one transaction, and each payee claims their share with a one-time link. Unclaimed money goes back to the platform after expiry.

**Status:** 17 tests passing, and two deployments on Monad testnet. The web app is connected to the **tAUSD** deployment, and Privy sign-in works. Next up is the first real deposit → batch → claim run. Target: working end to end on testnet by **Oct 6**.

## Deployed addresses (Monad testnet)

| Deployment | Payout token | Claim verifier (email check) | Used by the web app |
| --- | --- | --- | --- |
| **`monad-v2`** | Our **tAUSD** (anyone can mint) | ✅ Yes | ✅ **Yes, now** |
| `monad-test-ausd` | tAUSD | No: the link alone can claim | No, superseded by `monad-v2` |
| `chain-10143` | Real Agora **AUSD** | No | Not yet. Needed for the Agora "Best Cross-Border Payments" bounty; redeploy it with the verifier before the demo, see [Switching to real AUSD](#switching-to-real-ausd) |

tAUSD exists because Agora's AUSD faucet on Monad testnet is empty (`requestFunds` reverts `InsufficientFunds()`). `monad-v2` reuses the same tAUSD token as `monad-test-ausd`, so wallet balances carry over, but Treasury balances and payouts on the old contracts stay there.

### Active: `monad-v2` (tAUSD + claim verifier), deployed 2026-09-30

| Contract | Address |
| --- | --- |
| tAUSD token (`MockAUSD`) | [`0x34C2CFdE74D0edbABF2F4382CEbD9F600048d17E`](https://testnet.monadscan.com/address/0x34C2CFdE74D0edbABF2F4382CEbD9F600048d17E) (same token as below) |
| Treasury | [`0xF6117E2bbf56bb942DB279B6bec461761ee0De73`](https://testnet.monadscan.com/address/0xF6117E2bbf56bb942DB279B6bec461761ee0De73) |
| ClaimEscrow | [`0xbD1519D8f5602cE5CFed89E505AD81717567fd78`](https://testnet.monadscan.com/address/0xbD1519D8f5602cE5CFed89E505AD81717567fd78) |
| BatchPayout | [`0xd75aCB8BffEc8F8BF38D067e0F26E263954EA783`](https://testnet.monadscan.com/address/0xd75aCB8BffEc8F8BF38D067e0F26E263954EA783) |

Claim verifier: `0x5A115F0E14232D658763b8683B6c0da9fBBe5549` (key: `VERIFIER_PRIVATE_KEY` in `apps/web/.env.local`). Relayer that pays claim gas: `0x3400FC4Bad547bFf9258EC1739f8696634057227` (`RELAYER_PRIVATE_KEY`). Deploy parameters: `ignition/parameters/monad-v2.json`. Deploy tx hashes are in `ignition/deployments/monad-v2/journal.jsonl`.

### Previous: `monad-test-ausd` (tAUSD, no verifier), deployed 2026-09-29

| Contract | Address | Deploy tx |
| --- | --- | --- |
| tAUSD token (`MockAUSD`) | [`0x34C2CFdE74D0edbABF2F4382CEbD9F600048d17E`](https://testnet.monadscan.com/address/0x34C2CFdE74D0edbABF2F4382CEbD9F600048d17E) | [`0xb532…cc5`](https://testnet.monadscan.com/tx/0xb532af2c2c3adb66b8d79443370f96b2785cbc2ad8a289f1a037eb860fb55cc5) |
| Treasury | [`0x2ca2f7d60d3b7e97ffdF2A8949e874025bA8554C`](https://testnet.monadscan.com/address/0x2ca2f7d60d3b7e97ffdF2A8949e874025bA8554C) | [`0x158e…c71e`](https://testnet.monadscan.com/tx/0x158e1fd54da2c743a5538e9f5b0573073149c749362e7a2655d2b0c0c3e2c71e) |
| ClaimEscrow | [`0xCE20c4883A5f7bE23AB8b441E2Ea123c3eEe289D`](https://testnet.monadscan.com/address/0xCE20c4883A5f7bE23AB8b441E2Ea123c3eEe289D) | [`0x691b…9da8`](https://testnet.monadscan.com/tx/0x691b82e3d3da2c2dfef6893737e932a47a6549f509e10b9250762df1ca8f9da8) |
| BatchPayout | [`0x40E848Fc0F8a6d2779fCEF1DCaE329e274a4Def9`](https://testnet.monadscan.com/address/0x40E848Fc0F8a6d2779fCEF1DCaE329e274a4Def9) | [`0x01ac…c85b`](https://testnet.monadscan.com/tx/0x01ac7a8b1cfa6d78099b19edda87856bc6638779bc1797909845e5d6c1b8c85b) |

Wiring: `ClaimEscrow.wire` [`0xc3cd…4d9a`](https://testnet.monadscan.com/tx/0xc3cd246287583e0901c0061113031718e262d443ec04050c46daaf0d2f064d9a), `Treasury.wire` [`0x86fc…719d`](https://testnet.monadscan.com/tx/0x86fc6a7b5e118084171c136777671022c4fbe7b0a6a3953916f954918d9e719d). Blocks 66636371 to 66636425. The token is named "Fanout Test AUSD" with symbol `tAUSD`, so explorers and wallets can't mistake it for Agora's token. Its `mint(address, amount)` is open to anyone. 10,000 tAUSD were minted to the first platform wallet, `0xA80f…9C0` ([tx](https://testnet.monadscan.com/tx/0xf52ce879bc3159278e32a21c071ec7ea7dbc7b01eb1b1215e908f2e743a65b76)).

### Real AUSD: `chain-10143`, deployed 2026-09-29

| Contract | Address | Deploy tx |
| --- | --- | --- |
| Treasury | [`0x74a8D547daD96f478135E475360d719df1cA2BFa`](https://testnet.monadscan.com/address/0x74a8D547daD96f478135E475360d719df1cA2BFa) | [`0x62f8…98dd`](https://testnet.monadscan.com/tx/0x62f857b967162d0d970fbc70324373f02128815ca8088a353d23c3366a4198dd) |
| ClaimEscrow | [`0x7AB0E50E02e900dc423AAF5858c8E70289B44F11`](https://testnet.monadscan.com/address/0x7AB0E50E02e900dc423AAF5858c8E70289B44F11) | [`0x6e82…74ff`](https://testnet.monadscan.com/tx/0x6e82b4f06a83ffa835aedbb5925910f3c94eb3953ee118c177f24a4fdf1374ff) |
| BatchPayout | [`0x408640A93b9e11C2e7799fd3eB1975b5B7FC10F4`](https://testnet.monadscan.com/address/0x408640A93b9e11C2e7799fd3eB1975b5B7FC10F4) | [`0xe362…c32c`](https://testnet.monadscan.com/tx/0xe36217f20d10d6cfb869d324d1030c67ed8870d243f90ef95503410d46ffc32c) |

Wiring: `ClaimEscrow.wire` [`0xbff8…a1bf`](https://testnet.monadscan.com/tx/0xbff8e33f2dc7ecf9978b59558a56803d5a1e519799e36eb7eacfab781e19a1bf), `Treasury.wire` [`0xb8c3…ae37`](https://testnet.monadscan.com/tx/0xb8c33747b28a0a3794088502b647cb4d9f27f51d29dbc31ebfd5c7c4b23bae37). Blocks 66494877 to 66494919. Payout token: Agora AUSD [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadscan.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC). Agora's faucet for it is `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`: 10,000 AUSD per request, once a minute, up to 100,000 per wallet. It was empty as of 2026-09-29.

### Shared settings

| Setting | Value |
| --- | --- |
| Network | Monad testnet, chain id `10143`, RPC `https://testnet-rpc.monad.xyz`, explorer [Monadscan](https://testnet.monadscan.com) |
| Token decimals | 6 ($1 = `1_000_000`) for both AUSD and tAUSD |
| Deployer / owner | `0x978D459587b9807375E7A02ff403BED7E68d0b0e` (testnet-only wallet) |
| Claim expiry (`claimTtl`) | 30 days (`2592000` seconds) |
| Max rows per batch (`MAX_ROWS`) | 150 |
| Compiler | solc 0.8.30, EVM target `cancun`, optimizer on (200 runs) |

Both deployments were checked onchain after deploy: each contract points at the right token and at the other two contracts. Each deploy record lives in `ignition/deployments/<deployment-id>/`: `deployed_addresses.json`, `journal.jsonl` (every transaction) and `artifacts/` (the exact ABIs and bytecode deployed).

## Quick start

```bash
pnpm install                 # from the repo root (this package is in the pnpm workspace)
cd smart-contract
pnpm build                   # compile contracts
pnpm test                    # 17 tests on Hardhat's in-process network
pnpm typecheck               # tsc over the config, tests and deploy module
pnpm deploy:monad:test-ausd # deploy tAUSD + contracts to Monad testnet (needs .env, see below)
pnpm deploy:monad            # deploy contracts for real Agora AUSD
pnpm export-abis             # copy ABIs + addresses into the web app (see Web app integration)
```

The deployer key comes from `.env`, which is gitignored. Copy `.env.example` and fill it in:

```
MONAD_PRIVATE_KEY=0x...      # testnet-only wallet with MON from the Monad testnet faucet
# MONAD_RPC_URL=             # optional; defaults to https://testnet-rpc.monad.xyz
```

`hardhat.config.ts` loads `.env` with `dotenv`. Instead of the file, you can set the key as an environment variable, or store it encrypted with `pnpm hardhat keystore set MONAD_PRIVATE_KEY`. Each deploy used about 0.25–0.3 MON.

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
│       └── MockAUSD.sol          # 6-decimal ERC-20 with public mint: tests, and "tAUSD" on testnet
├── test/
│   └── Fanout.ts                 # node:test + viem; signs claims with the web app's claim-keys.ts
├── ignition/
│   ├── modules/
│   │   ├── Fanout.ts             # deploy + wire for real AUSD; exports deployFanout()
│   │   └── FanoutTestAusd.ts     # deploys tAUSD, then the same contracts for it
│   └── deployments/              # deploy records (commit these)
│       ├── monad-test-ausd/      # active: tAUSD
│       └── chain-10143/          # real AUSD
├── scripts/
│   └── export-abis.ts            # writes ABIs + addresses to apps/web/lib/fanout/abis/contracts.generated.ts
├── hardhat.config.ts             # compiler settings + monadTestnet network
├── tsconfig.json                 # strict; "preserve" modules so tests can import apps/web
├── .env.example                  # template for the deployer key
└── package.json                  # build / test / typecheck / deploy / export-abis scripts
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
| `verifier` | `address` | Must co-sign every claim (see [Claim links and signatures](#claim-links-and-signatures)). The owner can rotate it with `setVerifier` |
| `claims` | `mapping(address claimSigner => Claim)` | `Claim { uint256 amount; address platform; Status status; uint64 expiresAt; bytes32 emailHash; }` |

`Status` is `Sent = 0`, `Claimed = 1`, `Refunded = 2`, which matches the web app's `["sent", "claimed", "refunded"]`. A claim record is never deleted. Its non-zero `amount` is how the contract knows a `claimSigner` has already been used.

**Functions**

| Function | Who can call | What it does |
| --- | --- | --- |
| `constructor(IERC20 ausd, ITreasury treasury, address verifier)` | Deployer | Sets the token, Treasury and claim verifier; the deployer becomes owner |
| `wire(address batchPayout)` | Owner, once | Sets the one contract allowed to open claims |
| `setVerifier(address verifier)` | Owner | Rotates the claim verifier, e.g. if its key leaks. Old co-signatures stop working |
| `open(batchId, platform, claimSigners[], amounts[], emailHashes[], expiresAt)` | BatchPayout only | Records one `Sent` claim per row. Rejects a zero signer, a zero amount, and a signer that has already been used, including a duplicate within the same batch |
| `getClaim(address claimSigner) view → (amount, platform, status, emailHash)` | Anyone | Returns `amount = 0` for an unknown claim; the web app treats that as "link not valid" |
| `claims(address claimSigner) view` | Anyone | The full record, including `expiresAt` |
| `claim(address claimSigner, address recipient, bytes signature, bytes verification)` | Anyone (our relayer pays gas) | Checks the link signature and the verifier's co-signature (see below), marks the claim `Claimed` and sends the AUSD to `recipient` |
| `refund(address claimSigner)` | Anyone, once `block.timestamp >= expiresAt` | Marks the claim `Refunded`, sends the AUSD to the Treasury and calls `Treasury.credit` |

A claim that has expired but hasn't been refunded can still be claimed. Expiry only makes a refund possible; it doesn't cut the payee off. Whichever call lands first wins.

**Events:** `ClaimOpened(claimSigner indexed, platform indexed, batchId indexed, amount, expiresAt)`, `Claimed(claimSigner indexed, recipient indexed, amount)`, `Refunded(claimSigner indexed, platform indexed, amount)`, `VerifierChanged(verifier indexed)`.

**Errors:** `ZeroAddress`, `ZeroAmount`, `AlreadyWired`, `Unauthorized`, `LengthMismatch`, `ClaimSignerUsed(claimSigner)`, `UnknownClaim`, `NotClaimable(status)`, `BadSignature`, `BadVerification`, `NotExpired(expiresAt)`.

## Claim links and signatures

A claim is unlocked by a one-time key that lives only in the payee's link. The web app side is `apps/web/lib/fanout/claim-keys.ts`, and the tests import that exact file, so the contract is checked against the real client code.

1. When the platform approves a payout, the browser generates a fresh keypair for each row. The address (`claimSigner`) goes onchain in `createBatch`.
2. The private key goes only into the link, `/claim#k=<key>`. Browsers never send the part after `#` to a server.
3. On the claim page, the key signs the recipient address, the ClaimEscrow address and the chain id, as an EIP-191 personal message.
4. `claim(...)` recovers the signer and checks that it equals `claimSigner`.
5. **The verifier co-signs.** The claim page sends the claim to the web app's relayer (`apps/web/app/api/claim`, `lib/fanout/relayer.ts`) with the payee's Privy session token. The server looks up the payee's **verified** emails in Privy, and only if one of them hashes to the claim's onchain `emailHash` does it sign `keccak256(abi.encode(VERIFY_TAG, claimSigner, recipient, address(this), block.chainid))` with the verifier key. The contract rejects any claim without that co-signature (`BadVerification`).

So a leaked or forwarded link is useless without access to the payee's inbox, and the verifier key alone is useless without the link. Calling the contract directly doesn't skip the check.

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
| Front-running a claim | Both signatures bind the recipient |
| A leaked or forwarded claim link | Useless alone: every claim also needs the verifier's co-signature, which the server only gives after checking the claimer signed in with the email the payment was sent to |
| The verifier key leaking | Useless without the link too. The owner rotates it with `setVerifier`; keep it only on the server |
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

Both deploy modules call the same `deployFanout()` in `ignition/modules/Fanout.ts`, which does these steps in order:

1. `Treasury(ausd)`
2. `ClaimEscrow(ausd, Treasury)`
3. `BatchPayout(Treasury, ClaimEscrow, claimTtl)`
4. `ClaimEscrow.wire(BatchPayout)` and `Treasury.wire(BatchPayout, ClaimEscrow)`

| Command | Module | Token | Deployment id |
| --- | --- | --- | --- |
| `pnpm deploy:monad:test-ausd` | `FanoutTestAusd.ts` | Deploys `MockAUSD` (tAUSD) first, then uses it | `monad-test-ausd` |
| `pnpm deploy:monad` | `Fanout.ts` | Parameter `ausd`, default real Agora AUSD | `chain-10143` |

`claimTtl` defaults to `2592000` (30 days). Override it with `--parameters params.json`, for example `{ "Fanout": { "claimTtl": "3600" } }`, using the module id as the key.

Ignition remembers what it has already deployed. Running a deploy again with unchanged contracts does nothing. After changing a contract, deploy fresh with a new `--deployment-id`, then run `pnpm export-abis <new-id>` and update the addresses here:

```bash
pnpm hardhat ignition deploy ignition/modules/FanoutTestAusd.ts --network monadTestnet --deployment-id monad-test-ausd-v2
```

To try a module without spending MON, run it against the in-process network, for example `pnpm hardhat ignition deploy ignition/modules/FanoutTestAusd.ts`.

## Web app integration

The web app (`apps/web`) uses the live contracts when `NEXT_PUBLIC_USE_MOCK=false` in `apps/web/.env.local`. It needs no other contract settings:

- `pnpm export-abis [deployment-id]` writes `apps/web/lib/fanout/abis/contracts.generated.ts`. That file holds the three ABIs (including custom errors, so failed transactions show readable reasons) and the deployed addresses, including the **payout token**, which it reads from the Treasury's constructor arguments. The default deployment id is `monad-test-ausd`.
- `apps/web/lib/config.ts` defaults every address (token, Treasury, BatchPayout, ClaimEscrow) to that file. `NEXT_PUBLIC_*_ADDRESS` env vars still override them, but leave them empty. Setting the token address without matching contracts makes every deposit fail.
- The CSV limit in `apps/web/lib/csv.ts` is 150 rows, matching `MAX_ROWS`.
- Every function name, argument order and return shape the web app uses matches the contracts, so `onchain-client.ts` needed no changes.
- Privy sign-in creates the embedded wallet itself if the user has none (`apps/web/lib/auth/privy.tsx`), and the dashboard sidebar shows the wallet address.

### Switching to real AUSD

When real testnet AUSD is available (the Agora faucet is refilled, or Agora sends some):

1. Redeploy the contracts for real AUSD **with the verifier** (the `chain-10143` deployment predates it): `hardhat ignition deploy ignition/modules/Fanout.ts --network monadTestnet --parameters <file with "verifier"> --deployment-id <new-id>`, then `pnpm export-abis <new-id>`.
2. Restart `pnpm dev`, then get AUSD into the platform wallet (for example, `requestFunds(<wallet>)` on the faucet).
3. Run deposit → batch → claim once, then update the table at the top of this README.

The web app still labels the token "AUSD" either way (`config.stablecoin.symbol`).

### Still to do on the web app side

- **Gas for payees.** Claims go through our relayer, which pays the gas. `send` (payee to anyone) still expects the payee's wallet to pay gas.
- **Rate limiting** on `/api/claim` before a public launch.
- **History.** Batch lists and payee history need the Envio indexer. It should read the `BatchCreated`, `ClaimOpened`, `Claimed`, `Refunded`, `Deposited` and `Withdrawn` events.

## Open questions

- When will Agora refill the Monad testnet AUSD faucet? We asked on Discord on 2026-09-29. If there's no answer by around Oct 3, try another channel. Also confirm whether the bounty requires real AUSD in the demo.
- Is 30 days the right claim expiry? It's a deploy parameter, so changing it means a redeploy but no code change.
- Who pays gas for payee claims and sends: a relayer, or gas sponsored through Privy?
- Does the web app expose `refund` and `withdraw`, or do they stay admin-only for the demo? Anyone can call `refund` after expiry, so a script or cron job could handle it.
