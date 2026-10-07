# Fanout — Smart Contracts

Three Solidity contracts on Monad testnet that move the money for Fanout: **Treasury**, **BatchPayout** and **ClaimEscrow**. A platform deposits AUSD once, pays out a whole CSV in one transaction, and each payee claims their share with a one-time link. Unclaimed money goes back to the platform after expiry.

A fourth, standalone contract, **SettleToUsdc**, lets a payee take their dollars as USDC instead of AUSD, changed instantly and without fees through Agora's AUSD/USDC stable-swap pair. It doesn't touch the three payout contracts.

**Status:** 54 tests passing. The web app uses the **`monad-v3`** deployment (gasless deposits and payouts, a claim window per payout, refunding a whole payout at once); see [v3](#v3-monad-v3).

## Deployed addresses (Monad testnet)

| Deployment | Payout token | Claim verifier (email check) | Used by the web app |
| --- | --- | --- | --- |
| **`monad-v3`** | Real Agora **AUSD** | ✅ Yes | ✅ **Yes, now** |
| `monad-ausd` | Real Agora **AUSD** | ✅ Yes | No, superseded by `monad-v3` |
| `monad-v2` | Our **tAUSD** (anyone can mint) | ✅ Yes | No, superseded by `monad-ausd` |
| `monad-test-ausd` | tAUSD | No: the link alone can claim | No |
| `chain-10143` | Real AUSD | No | No |

**Getting test AUSD.** Agora's faucet on Monad testnet was refilled after 2026-09-30 (it held 1 billion AUSD on 2026-10-01). Call `requestFunds(<recipient>)` on [`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`](https://testnet.monadscan.com/address/0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C): 10,000 AUSD per call, once a minute per caller (`MaxFrequencyExceeded` otherwise), up to 100,000 per wallet. The argument is the recipient; anyone can pay the gas.

### Active: `monad-v3`, deployed 2026-10-07

| Contract | Address |
| --- | --- |
| AUSD (Agora) | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadscan.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) |
| Treasury | [`0xecC2616C45a55AEA2d33374E4B99D64d0900255c`](https://testnet.monadscan.com/address/0xecC2616C45a55AEA2d33374E4B99D64d0900255c) |
| ClaimEscrow | [`0x15DaAD3E6200051AE2F956ba32cD8033e82d40B6`](https://testnet.monadscan.com/address/0x15DaAD3E6200051AE2F956ba32cD8033e82d40B6) |
| BatchPayout | [`0x01aD7B7A7Ab17ffE4fDFE4644828167702338386`](https://testnet.monadscan.com/address/0x01aD7B7A7Ab17ffE4fDFE4644828167702338386) |

Deployed at block 68874807 with verifier `0x5A115F0E14232D658763b8683B6c0da9fBBe5549` and `firstBatchId` 1001. Checked on chain after deploy: Treasury points at this BatchPayout and ClaimEscrow, ClaimEscrow at this BatchPayout and verifier, both use Agora AUSD, `nextBatchId` is 1001, and the claim window bounds are 300 seconds to 7,776,000 seconds (90 days). Tx hashes in `ignition/deployments/monad-v3/journal.jsonl`.

### Previous: `monad-ausd` (real AUSD + claim verifier), deployed 2026-10-01

| Contract | Address |
| --- | --- |
| AUSD (Agora) | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadscan.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) |
| Treasury | [`0x245C9b855fd63395BccEC46f7Bac2671e18e79fE`](https://testnet.monadscan.com/address/0x245C9b855fd63395BccEC46f7Bac2671e18e79fE) |
| ClaimEscrow | [`0xf1de07BFfAF3D3D4279399D63049F0C01b8aFD11`](https://testnet.monadscan.com/address/0xf1de07BFfAF3D3D4279399D63049F0C01b8aFD11) |
| BatchPayout | [`0xfc15b4f0811C6F88e8D572cFB01fCE5b166FE3dF`](https://testnet.monadscan.com/address/0xfc15b4f0811C6F88e8D572cFB01fCE5b166FE3dF) |

Same claim verifier (`0x5A115F0E14232D658763b8683B6c0da9fBBe5549`) and relayer as `monad-v2`. Deploy parameters: `ignition/parameters/monad-ausd.json`; tx hashes in `ignition/deployments/monad-ausd/journal.jsonl`. Checked on chain after deploy: wiring, verifier and 30-day TTL correct; a real-AUSD deposit, batch and verified claim went through, and a claim with only the link signature was refused.

### SettleToUsdc (USDC for payees): `monad-settle-usdc`

| Contract | Address |
| --- | --- |
| SettleToUsdc | [`0xA1ac3cBe75697e4Ad7C5fF393EbC3AE9fa67DeC2`](https://testnet.monadscan.com/address/0xA1ac3cBe75697e4Ad7C5fF393EbC3AE9fa67DeC2) (deployment id `monad-settle-usdc`; holds `APPROVED_SWAPPER`, [tx](https://testnet.monadscan.com/tx/0xff652220606227ef34bf1d97f299bea64df1c25e2e5bd372e16eddac4cd13ab8)) |
| Agora AUSD/USDC pair | [`0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae`](https://testnet.monadscan.com/address/0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae) (token0 = USDC stand-in, token1 = AUSD, fee 0) |
| USDC stand-in on the pair (CTK, 18 decimals) | [`0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D`](https://testnet.monadscan.com/address/0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D) |
| Agora whitelister (grants `APPROVED_SWAPPER`) | [`0x7c10F56d6f04a51376393a1C3670e966863F6BD5`](https://testnet.monadscan.com/address/0x7c10F56d6f04a51376393a1C3670e966863F6BD5) |

On Monad mainnet the same contract would be deployed with AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`, Agora's AUSD/USDC pair `0xf33286E3222D1c829dACeac48c0Ec651F6452470` and that pair's USDC (see Agora's [protocol deployments](https://docs.agora.finance/instant-settlement/protocol-deployments.md)).

### Previous: `monad-v2` (tAUSD + claim verifier), deployed 2026-09-30

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
| Claim expiry | `monad-ausd` and older: 30 days for every payout (`claimTtl`, `2592000` seconds). v3: chosen per payout, 5 minutes to 90 days, default 30 days |
| Max rows per batch (`MAX_ROWS`) | 150 |
| Compiler | solc 0.8.30, EVM target `cancun`, optimizer on (200 runs) |

Both deployments were checked onchain after deploy: each contract points at the right token and at the other two contracts. Each deploy record lives in `ignition/deployments/<deployment-id>/`: `deployed_addresses.json`, `journal.jsonl` (every transaction) and `artifacts/` (the exact ABIs and bytecode deployed).

## Quick start

```bash
pnpm install                 # from the repo root (this package is in the pnpm workspace)
cd smart-contract
pnpm build                   # compile contracts
pnpm test                    # 54 tests on Hardhat's in-process network
pnpm typecheck               # tsc over the config, tests and deploy module
pnpm deploy:monad:test-ausd # deploy tAUSD + contracts to Monad testnet (needs .env, see below)
pnpm deploy:monad            # deploy contracts for real Agora AUSD
pnpm deploy:monad:v3         # deploy the v3 contracts as monad-v3 (see Deploying v3)
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
│   ├── Treasury.sol              # per-platform AUSD balances: deposit (or with an ERC-3009 authorization), withdraw, debit, credit
│   ├── BatchPayout.sol           # one CSV → one transaction → many claims; per-payout claim window; signed payouts for a relayer
│   ├── ClaimEscrow.sol           # holds each payee's AUSD; claim with a signature, refund (one or many) after expiry
│   ├── SettleToUsdc.sol          # a payee's AUSD -> USDC through Agora's stable-swap pair, relayer pays gas
│   ├── interfaces/
│   │   ├── ITreasury.sol         # what BatchPayout and ClaimEscrow call on Treasury
│   │   ├── IClaimEscrow.sol      # what BatchPayout calls on ClaimEscrow
│   │   ├── IERC3009.sol          # AUSD's receiveWithAuthorization (bytes signature)
│   │   └── IAgoraStableSwapPair.sol # the parts of Agora's pair SettleToUsdc uses
│   └── test/
│       ├── MockAUSD.sol          # 6-decimal ERC-20 with public mint: tests, and "tAUSD" on testnet
│       ├── MockAUSD3009.sol      # MockAUSD + ERC-3009, same EIP-712 domain as Agora AUSD
│       ├── MockUSDC.sol          # 18-decimal mintable ERC-20
│       └── MockStableSwapPair.sol # 1:1 pair with Agora's role check and error names
├── test/
│   ├── Fanout.ts                 # node:test + viem; signs claims with the web app's claim-keys.ts
│   ├── FanoutV3.ts               # v3: gasless deposits and payouts, claim windows, refundMany, invariants
│   ├── AbiFragments.ts           # the web app's hand-written v3 ABI fragments match the contracts
│   └── SettleToUsdc.ts           # signs with the web app's usdc-settle.ts
├── ignition/
│   ├── modules/
│   │   ├── Fanout.ts             # deploy + wire for real AUSD; exports deployFanout()
│   │   ├── FanoutTestAusd.ts     # deploys tAUSD, then the same contracts for it
│   │   └── SettleToUsdc.ts       # deploys SettleToUsdc (parameters: ignition/parameters/monad-settle-usdc.json)
│   ├── parameters/               # deploy parameters per deployment id (monad-v3.json, monad-ausd.json, ...)
│   └── deployments/              # deploy records (commit these): monad-ausd (active), monad-v2, monad-test-ausd, chain-10143
├── scripts/
│   ├── export-abis.ts            # writes ABIs + addresses to apps/web/lib/fanout/abis/contracts.generated.ts
│   └── approve-swapper.ts        # grants SettleToUsdc the pair's APPROVED_SWAPPER role, then checks it
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
2. **Batch.** The platform calls `BatchPayout.createBatch(claimSigners, amounts, emailHashes)`. In one transaction, BatchPayout checks the rows, stores the batch, and calls `Treasury.debit`, which lowers the platform's balance and moves the total to ClaimEscrow. It then calls `ClaimEscrow.open`, which opens one claim per row with a 30-day expiry (on v3, the payout's own claim window).
3. **Claim.** The payee opens `/claim#k=<key>`. Their browser uses the one-time key to sign their wallet address, and anyone can submit `ClaimEscrow.claim(...)`. The AUSD goes straight to the payee's wallet.
4. **Refund.** Once a claim has expired, anyone can call `ClaimEscrow.refund(claimSigner)` (on v3 also `refundMany` for a whole payout). The AUSD goes back to the Treasury and is added back to the platform's balance, where it can be used for another batch or withdrawn.

On v3, steps 1 and 2 can also be signed by the platform and submitted by someone else (our relayer), who pays the gas: see [v3](#v3-monad-v3).

Money only ever sits in two places: the Treasury (deposited but not yet paid out) and the ClaimEscrow (paid out but not yet claimed or refunded). At any time, the Treasury's AUSD balance equals the sum of all platform balances. The ClaimEscrow's AUSD balance equals the sum of all claims that are still in the sent state.

## v3 (`monad-v3`)

The current contract code. Compared with `monad-ausd`, it adds gasless deposits and payouts and a claim window per payout. Everything else, including `deposit`, the three-argument `createBatch`, claims and their signatures, and every event, works as before. The contracts are still not upgradeable, so v3 is a new deployment next to the old one.

**API changes**

| Contract | Change |
| --- | --- |
| Treasury | New `depositWithAuthorization(address from, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)` |
| BatchPayout | Constructor is now `(ITreasury, IClaimEscrow, uint256 firstBatchId)`; `claimTtl` is gone |
| BatchPayout | New overload `createBatch(address[] claimSigners, uint256[] amounts, bytes32[] emailHashes, uint64 claimWindow) → batchId` |
| BatchPayout | New `createBatchFor(address platform, address[] claimSigners, uint256[] amounts, bytes32[] emailHashes, uint64 claimWindow, (bytes32 nonce, uint256 deadline, bytes signature) auth) → batchId` |
| BatchPayout | New `depositAndCreateBatchFor(platform, claimSigners, amounts, emailHashes, claimWindow, auth, (uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature) deposit) → batchId` |
| BatchPayout | New `cancelAuthorization(bytes32 nonce)`, `createBatchDigest(...) view`, `authorizationState(platform, nonce) view`, constants `MIN_CLAIM_WINDOW`, `MAX_CLAIM_WINDOW`, `DEFAULT_CLAIM_WINDOW`, `CREATE_BATCH_TYPEHASH` |
| BatchPayout | New events `BatchAuthorizationUsed(platform indexed, nonce indexed)`, `BatchAuthorizationCanceled(platform indexed, nonce indexed)`; new errors `ClaimWindowOutOfRange(claimWindow, min, max)`, `AuthorizationExpired(deadline)`, `AuthorizationAlreadyUsed(platform, nonce)`, `BadAuthorization` |
| ClaimEscrow | New `refundMany(address[] claimSigners) → uint256 refunded` |

**Gasless deposits.** `Treasury.depositWithAuthorization` calls AUSD's ERC-3009 `receiveWithAuthorization` (the `bytes signature` overload; EIP-712 domain `Agora Dollar`, version `1`). The payer signs a `ReceiveWithAuthorization` with `to` = the Treasury. AUSD checks the signature, the time window and the nonce, and only the Treasury can redeem an authorization made out to it. The balance always goes to `from`, never to the caller, so anyone (our relayer) can submit it.

**Payouts signed by the platform.** For `createBatchFor` the platform signs this EIP-712 message (domain `Fanout BatchPayout`, version `1`, the chain id, the BatchPayout address):

```
CreateBatch(address platform,address[] claimSigners,uint256[] amounts,bytes32[] emailHashes,uint64 claimWindow,bytes32 nonce,uint256 deadline)
```

The arrays are encoded the EIP-712 way (keccak256 of their 32-byte words), so a wallet can show every row. BatchPayout checks the deadline, that the nonce is unused, and the signature (`SignatureChecker`, so EOAs and ERC-1271 smart accounts both work), then marks the nonce used and emits `BatchAuthorizationUsed`. Changing any row, the order of rows, the window, the platform or the deadline breaks the signature. Nonces are random 32-byte values, so a platform can sign several payouts in any order; it can void one it no longer wants with `cancelAuthorization`. The payout is debited from, and refunds return to, `platform`'s balance, never the submitter's. The web app signs with `apps/web/lib/fanout/batch-authorization.ts`, which the tests use too.

`depositAndCreateBatchFor` checks the CreateBatch authorization, deposits exactly the batch total with the deposit authorization, then creates the payout, all in one transaction: if any step fails, nothing moves and neither nonce is used. That is how paying by email works on v3: an account holding only AUSD signs twice and the relayer submits it, so the account needs no MON. If someone submits the deposit authorization on its own first, the combined call reverts (`UsedOrCanceledAuthorization`), the money waits in the payer's Treasury balance, and `createBatchFor` with the same CreateBatch signature finishes the payment; the relayer does this automatically.

**Claim windows.** Each payout chooses when its unclaimed rows can be refunded: `claimWindow` seconds after creation, from `MIN_CLAIM_WINDOW` (5 minutes) to `MAX_CLAIM_WINDOW` (90 days). `0`, or the original three-argument `createBatch`, means `DEFAULT_CLAIM_WINDOW` (30 days). Each claim's `expiresAt` (in `claims()` and the `ClaimOpened` event) is the payout's window end. As before, an expired claim can still be claimed until it is refunded.

**Refunding a payout.** Anyone can call `refundMany(claimSigners)` once claims have expired. It refunds every listed claim that is still unclaimed and past its expiry, skips the rest (so a claim landing first doesn't make it fail), and returns how many it refunded. The dashboard's "Return unclaimed money" button sends it from the platform's own account, which pays the fee: the money only goes back to that platform, the platform already pays for its payouts, and a relayer endpoint anyone could call would let strangers spend the relayer's MON. On older deployments the button sends `refund` once per row instead.

**Payout ids.** `firstBatchId` (1001 for `monad-v3`) starts v3 payout numbers after `monad-ausd`'s (7 so far), so both deployments can share one indexer.

### Deploying v3

1. **Deploy.** From `smart-contract/` with `MONAD_PRIVATE_KEY` set (testnet-only key with about 0.3 MON):
   ```bash
   pnpm deploy:monad:v3   # Fanout.ts with ignition/parameters/monad-v3.json, deployment id monad-v3
   ```
   Parameters: AUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, verifier `0x5A115F0E14232D658763b8683B6c0da9fBBe5549` (same `VERIFIER_PRIVATE_KEY` as now), `firstBatchId` 1001. Commit `ignition/deployments/monad-v3/`. Check onchain: `Treasury.batchPayout`/`claimEscrow`, `ClaimEscrow.batchPayout`/`verifier`, `BatchPayout.nextBatchId() == 1001`.
2. **Web app.** `pnpm export-abis monad-v3`, then commit `apps/web/lib/fanout/abis/contracts.generated.ts`. The app now uses the v3 addresses and turns on claim windows and gasless paying by email (it detects `createBatchFor` in the generated ABI; no env flag needed). Update the address table at the top of this README and the root README's "Onchain proof".
3. **Indexer.** In `indexer/config.yaml`, uncomment the three `monad-v3` addresses and fill them in from `ignition/deployments/monad-v3/deployed_addresses.json`; keep `start_block`. Run `pnpm codegen` and `pnpm test` in `indexer/`, then redeploy the hosted indexer (it resyncs from scratch).
4. **Vercel env.** Set `NEXT_PUBLIC_INDEXER_URL` to the new indexer URL. Leave `NEXT_PUBLIC_TREASURY_ADDRESS`, `NEXT_PUBLIC_BATCH_PAYOUT_ADDRESS`, `NEXT_PUBLIC_CLAIM_ESCROW_ADDRESS` and `NEXT_PUBLIC_PAYOUT_CONTRACTS` empty (or, to switch before committing the generated file, set the three addresses and `NEXT_PUBLIC_PAYOUT_CONTRACTS=v3`). `RELAYER_PRIVATE_KEY`, `VERIFIER_PRIVATE_KEY` and `PRIVY_APP_SECRET` stay as they are; the relayer now also pays the gas for paying by email. Redeploy. Until steps 2 to 4 happen, the app keeps working against `monad-ausd` exactly as before.
5. **Afterwards.** Once nothing uses the older flow, `/api/relay/fees` (MON top-ups for paying by email from the payer's own account) and `RELAYER_FEE_TOPUP_MON` can be removed.

**What happens to `monad-ausd`.** Nothing moves automatically, and its contracts keep working: they have no owner powers left and can't be paused. Platform balances stay in the old Treasury and can be withdrawn there (`withdraw`) and deposited into v3. Its open claims keep their 30-day expiry and stay claimable with their links: a claim link signs the ClaimEscrow address, so after the switch those links need the old ClaimEscrow (claim them before switching, or with `NEXT_PUBLIC_*_ADDRESS` pointing at the old contracts). Anyone can still refund them to the old Treasury after expiry. The indexer keeps their history.

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
| `depositWithAuthorization(from, amount, validAfter, validBefore, nonce, signature)` | Anyone (our relayer, or BatchPayout) | v3. Pulls `amount` AUSD from `from` with their ERC-3009 `ReceiveWithAuthorization` to the Treasury and adds it to `from`'s balance |
| `withdraw(uint256 amount)` | Platform | Lowers the caller's balance and sends the AUSD back to them |
| `debit(address platform, uint256 amount)` | BatchPayout only | Lowers `platform`'s balance and sends `amount` AUSD to ClaimEscrow |
| `credit(address platform, uint256 amount)` | ClaimEscrow only | Adds `amount` back to `platform`'s balance. ClaimEscrow sends the AUSD before calling this |
| `balanceOf(address platform) view` | Anyone | The platform's current balance |

**Events:** `Deposited(platform indexed, amount)`, `Withdrawn(platform indexed, amount)`, `Debited(platform indexed, amount)`, `Credited(platform indexed, amount)`.

**Errors:** `ZeroAmount`, `ZeroAddress`, `AlreadyWired`, `Unauthorized`, `InsufficientBalance(balance, needed)`, plus OpenZeppelin's `OwnableUnauthorizedAccount` and the token's own errors (for example, `ERC20InsufficientAllowance` when a deposit wasn't approved).

### BatchPayout

`contracts/BatchPayout.sol`. Turns one approved CSV into many claims in a single transaction. It has no owner and holds no money. This describes v3; `monad-ausd` and older have only the three-argument `createBatch` and a fixed `claimTtl` instead of claim windows.

**Storage**

| Variable | Type | Meaning |
| --- | --- | --- |
| `MAX_ROWS` | `constant = 150` | The most rows one batch can hold |
| `MIN_CLAIM_WINDOW`, `MAX_CLAIM_WINDOW`, `DEFAULT_CLAIM_WINDOW` | `uint64 constant` | 5 minutes, 90 days, 30 days |
| `treasury` | `ITreasury immutable` | Where the money comes from |
| `claimEscrow` | `IClaimEscrow immutable` | Where the claims are opened |
| `nextBatchId` | `uint256` | Starts at `firstBatchId` (1 if 0), so batch id 0 never exists |
| `_batches` | `mapping(uint256 => Batch)` | `Batch { address platform; uint64 createdAt; uint256 total; address[] claimSigners; }` |
| `authorizationState` | `mapping(address => mapping(bytes32 => bool))` | CreateBatch nonces each platform has used or cancelled |

**Functions**

| Function | Who can call | What it does |
| --- | --- | --- |
| `constructor(ITreasury, IClaimEscrow, uint256 firstBatchId)` | Deployer | Sets the trusted contracts and the first payout id |
| `createBatch(address[] claimSigners, uint256[] amounts, bytes32[] emailHashes) → uint256 batchId` | Any platform | Checks there is at least one row, no more than `MAX_ROWS`, and that all three arrays are the same length. Adds up the total, stores the batch, debits the caller's Treasury balance and opens the claims with `expiresAt = now + DEFAULT_CLAIM_WINDOW` |
| `createBatch(claimSigners, amounts, emailHashes, uint64 claimWindow) → batchId` | Any platform | The same with this payout's claim window (0 = default); reverts `ClaimWindowOutOfRange` outside 5 minutes to 90 days |
| `createBatchFor(platform, claimSigners, amounts, emailHashes, claimWindow, auth)` | Anyone (our relayer) | The same, paid from `platform`'s balance, with `platform`'s signed CreateBatch authorization (see [v3](#v3-monad-v3)) |
| `depositAndCreateBatchFor(platform, claimSigners, amounts, emailHashes, claimWindow, auth, deposit)` | Anyone (our relayer) | Deposits the total from `platform` with its ERC-3009 authorization, then `createBatchFor`, in one transaction |
| `cancelAuthorization(bytes32 nonce)` | Platform | Voids a CreateBatch authorization it signed |
| `createBatchDigest(platform, claimSigners, amounts, emailHashes, claimWindow, nonce, deadline) view` | Anyone | The EIP-712 digest the platform signs |
| `getBatch(uint256 batchId) view → (platform, createdAt, total, claimSigners)` | Anyone | Returns `platform = address(0)` for an unknown batch; the web app treats that as "not found" |

`emailHashes` entries are `bytes32(0)` when a row has no email. They are stored for display only and never used to authorize a claim.

**Events:** `BatchCreated(uint256 indexed batchId, address indexed platform, uint256 total, uint256 count)`. The web app reads `batchId` from this event after the transaction. v3 adds `BatchAuthorizationUsed(platform indexed, nonce indexed)` and `BatchAuthorizationCanceled(platform indexed, nonce indexed)`.

**Errors:** `ZeroAddress`, `EmptyBatch`, `TooManyRows(count, max)`, `LengthMismatch`, and on v3 `ClaimWindowOutOfRange(claimWindow, min, max)`, `AuthorizationExpired(deadline)`, `AuthorizationAlreadyUsed(platform, nonce)`, `BadAuthorization`. Errors from row checks and balance checks come from ClaimEscrow and Treasury (see below), and deposit errors from AUSD. They pass through unchanged, so viem decodes them by name.

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
| `refundMany(address[] claimSigners) → uint256 refunded` | Anyone | v3. Refunds each listed claim that is still `Sent` and expired; skips the others instead of reverting |

A claim that has expired but hasn't been refunded can still be claimed. Expiry only makes a refund possible; it doesn't cut the payee off. Whichever call lands first wins.

**Events:** `ClaimOpened(claimSigner indexed, platform indexed, batchId indexed, amount, expiresAt)`, `Claimed(claimSigner indexed, recipient indexed, amount)`, `Refunded(claimSigner indexed, platform indexed, amount)`, `VerifierChanged(verifier indexed)`.

**Errors:** `ZeroAddress`, `ZeroAmount`, `AlreadyWired`, `Unauthorized`, `LengthMismatch`, `ClaimSignerUsed(claimSigner)`, `UnknownClaim`, `NotClaimable(status)`, `BadSignature`, `BadVerification`, `NotExpired(expiresAt)`.

### SettleToUsdc

`contracts/SettleToUsdc.sol`. Changes a payee's AUSD to USDC through Agora's AUSD/USDC stable-swap pair in one transaction that anyone can submit; our relayer submits it and pays the gas. It holds no balance between calls, has no owner and is not upgradeable. It uses `ReentrancyGuard` and `SafeERC20.forceApprove`.

How a settle works:

1. The payee signs one ERC-3009 `ReceiveWithAuthorization` (EIP-712, AUSD's domain: name `Agora Dollar`, version `1`) for `value` AUSD to SettleToUsdc. Its nonce is `keccak256(abi.encode(address(this), salt, minOut))`, so the signature also fixes the least USDC the payee accepts.
2. `settle` calls AUSD's `receiveWithAuthorization` (the `bytes signature` overload), which checks the signature, the time window and that the nonce is unused, then moves the AUSD in.
3. It approves the pair and calls `swapExactTokensForTokens(value, minOut, [AUSD, USDC], from, validBefore)`. The pair pays the USDC straight to `from`.

So the USDC can only ever go to the signer, a submitter who lowers `minOut` breaks the signature, and AUSD's nonce check stops replays. The pair only lets `APPROVED_SWAPPER` callers swap, and only the caller (SettleToUsdc) needs the role, not the payee. The web app side is `apps/web/lib/fanout/usdc-settle.ts`, which the tests also sign with.

| Function | Who can call | What it does |
| --- | --- | --- |
| `constructor(IERC20 ausd, IERC20 usdc, IAgoraStableSwapPair pair)` | Deployer | Sets the two tokens and the pair |
| `settle(from, value, validAfter, validBefore, salt, minOut, signature)` | Anyone (our relayer) | Pulls `value` AUSD with the payee's authorization, swaps it, pays the USDC to `from`; returns the USDC amount |
| `authorizationNonce(salt, minOut)` | View | The ERC-3009 nonce the payee signs |

**Events:** `SettledToUsdc(from indexed, amountIn, amountOut)`.

**Errors:** `ZeroAddress`, `ZeroAmount`, plus whatever AUSD (bad, expired or used authorization) or the pair (`AddressIsNotRole`, `Expired`, `InsufficientOutputAmount`, `InsufficientLiquidity`, `PairIsPaused`, `PriceExpired`) reverts with. Any revert moves nothing.

## Claim links and signatures

A claim is unlocked by a one-time key that lives only in the payee's link. The web app side is `apps/web/lib/fanout/claim-keys.ts`, and the tests import that exact file, so the contract is checked against the real client code.

1. When the platform approves a payout, the browser generates a fresh keypair for each row. The address (`claimSigner`) goes onchain in `createBatch`.
2. The private key goes only into the link, `/claim#k=<key>`. Browsers never send the part after `#` to a server.
3. On the claim page, the key signs the recipient address, the ClaimEscrow address and the chain id, as an EIP-191 personal message.
4. `claim(...)` recovers the signer and checks that it equals `claimSigner`.
5. **The verifier co-signs.** The claim page sends the claim to the web app's relayer (`apps/web/app/api/relay/claim`, `lib/fanout/relayer.ts`) with the payee's Privy session token. The server looks up the payee's **verified** emails in Privy, and only if one of them hashes to the claim's onchain `emailHash` does it sign `keccak256(abi.encode(VERIFY_TAG, claimSigner, recipient, address(this), block.chainid))` with the verifier key. The contract rejects any claim without that co-signature (`BadVerification`).

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
| Anyone draining a platform's balance | `Treasury.debit` only accepts calls from BatchPayout, and BatchPayout debits `msg.sender`, or on v3 a `platform` whose EIP-712 signature covers every row, the window and a deadline, so a platform's balance is only spent as it approved |
| A relayer changing or replaying a signed payout or deposit | The CreateBatch signature fixes the rows, window and deadline, and its nonce works once (`AuthorizationAlreadyUsed`); AUSD does the same for the deposit authorization, which can only credit its signer |
| Anyone creating claims against escrowed money | `ClaimEscrow.open` only accepts calls from BatchPayout |
| Fake refunds | `Treasury.credit` only accepts calls from ClaimEscrow, which only credits after sending the AUSD back |
| The owner swapping in a malicious contract later | `wire` works once and the addresses can never change. After wiring, the owner has no remaining powers |
| Front-running a claim | Both signatures bind the recipient |
| A leaked or forwarded claim link | Useless alone: every claim also needs the verifier's co-signature, which the server only gives after checking the claimer signed in with the email the payment was sent to |
| The verifier key leaking | Useless without the link too. The owner rotates it with `setVerifier`; keep it only on the server |
| Replaying a signature | The signature binds the contract and chain, and a claim can only move out of `Sent` once |
| Re-entrancy through token transfers | State changes before every transfer, and `nonReentrant` on `deposit`, `depositWithAuthorization`, `withdraw`, `claim`, `refund` and `refundMany` |
| Bad CSV rows locking or losing money | All three arrays must be the same length; no zero amount; no zero, reused or duplicate `claimSigner`; at most 150 rows |
| Tokens that return `false` instead of reverting | All transfers go through `SafeERC20` |

These contracts are unaudited and deployed to testnet only. They assume AUSD is a standard ERC-20: no fee on transfer and no rebasing.

## Gas and limits

- `createBatch` costs about **94k gas per row** when every row has an email (about 85k when half do). Most of that is three new storage slots per claim, plus one slot for the signer in the batch record.
- A full 150-row batch with an email on every row (the most expensive case) measured **14.2M gas** (12.7M with half the emails empty). Monad caps a transaction at **30M gas** ([Monad docs: gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing)), so a full batch uses about 47% of it; at ~94k per row the cap would be reached around 318 rows. It also fits Ethereum's stricter 16.7M cap (EIP-7825), which Hardhat enforces by default, with about 15% to spare (about 177 rows would reach it). 200 rows ran out of gas under Hardhat.
- These numbers use the Ethereum (Cancun) gas schedule. Monad reprices some operations ([opcode pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing)): cold account access costs more, and storage is priced per 128-slot page. For `createBatch` that difference is small next to the margin above; the test fails if a full batch goes past 60% of the 30M cap.
- The web app must split CSVs with more than 150 rows into several batches.
- Monad charges for the gas limit you set, not the gas actually used, so avoid setting limits far above the estimate. At the 100 gwei minimum base fee a full 150-row payout costs about 1.4 MON, so keep at least 2 MON in the platform account.

## Tests

`pnpm test` runs `test/Fanout.ts`, `test/FanoutV3.ts`, `test/AbiFragments.ts` and `test/SettleToUsdc.ts`: 54 tests on Hardhat's in-process network. Each test starts from a fresh snapshot via `loadFixture`.

| Area | What's covered |
| --- | --- |
| Treasury | Deposit raises the balance and emits `Deposited`; a deposit without approval fails; withdraw works and can't exceed the balance; only BatchPayout can `debit` and only ClaimEscrow can `credit`; `wire` works once and only for the owner |
| BatchPayout | A 150-row batch in one transaction (logs gas); a full batch with an email on every row stays under 60% of Monad's 30M per-transaction gas limit (logs gas per row); `BatchCreated` with increasing ids; rejects an empty batch, mismatched arrays, 151 rows, a zero amount, a zero signer, a duplicate signer, a reused signer and too little balance; unknown `getBatch` and `getClaim` return zero values; only BatchPayout can `open` |
| ClaimEscrow | A relayer submits a valid claim and the payee is paid without spending gas; `Claimed` is emitted; rejects a wrong key, a swapped recipient, garbage signature bytes and a second attempt; rejects signatures made for another contract or chain; rejects unknown claims and a zero recipient; refund fails before expiry, works after it, credits the platform (which can then withdraw), and blocks any later claim or refund; an expired claim can still be claimed until someone refunds it |
| v3: gasless deposits | `depositWithAuthorization` credits the signer, not the relayer; rejects a wrong signer, a changed amount or payer, an authorization made out to someone else, a replay, an expired or not-yet-valid authorization, zero amounts and an empty payer |
| v3: claim windows | Payout ids start at `firstBatchId`; 30 days by default (three-argument `createBatch` or 0); expiry set per payout at the bounds and in between; windows outside 5 minutes to 90 days rejected; refund after a 10-minute window goes to the platform; `refundMany` refunds only expired, unclaimed rows and is a no-op the second time |
| v3: signed payouts | `createBatchFor` with a relayer debits the signer's balance; the digest matches viem's EIP-712 hash; tampered amounts, signers, row order, email hashes, row count, window, platform, deadline or nonce, a forged signer and another contract's domain are rejected and the untouched signature still works; replay, an expired deadline and a cancelled nonce are rejected; balance and row checks still apply |
| v3: pay by email | `depositAndCreateBatchFor` deposits and pays in one relayed transaction with the payer spending no gas; the payee can claim; a refund returns to the payer's balance; a failing batch leaves the deposit unused; the deposit must be the exact total from the platform; if the deposit is submitted alone first, `createBatchFor` finishes |
| v3: invariants | Over 80 random deposits, gasless deposits, payouts, gasless payouts, claims, refunds and withdrawals: Treasury AUSD equals the sum of balances and ClaimEscrow AUSD equals the sum of open claims after every step |
| Web app ABI fragments | The hand-written v3 fragments in `apps/web/lib/fanout/abis/v3.ts` match the compiled contracts |
| SettleToUsdc | A relayer settles the payee's signed authorization and the USDC goes to the payee, with nothing left in the contract or sent to the relayer; naming a different `from` fails the signature; a lowered `minOut` fails the signature (it's in the nonce); a pair quote below the signed minimum reverts and moves nothing; an expired authorization and a replay are rejected; a contract without `APPROVED_SWAPPER` can't swap; zero amounts and addresses are rejected |

## Deploying

Both deploy modules call the same `deployFanout()` in `ignition/modules/Fanout.ts`, which does these steps in order:

1. `Treasury(ausd)`
2. `ClaimEscrow(ausd, Treasury, verifier)`
3. `BatchPayout(Treasury, ClaimEscrow, firstBatchId)`
4. `ClaimEscrow.wire(BatchPayout)` and `Treasury.wire(BatchPayout, ClaimEscrow)`

| Command | Module | Token | Deployment id |
| --- | --- | --- | --- |
| `pnpm deploy:monad:v3` | `Fanout.ts`, `ignition/parameters/monad-v3.json` | Real Agora AUSD | `monad-v3` |
| `pnpm deploy:monad:test-ausd` | `FanoutTestAusd.ts` | Deploys `MockAUSD` (tAUSD) first, then uses it | `monad-test-ausd` |
| `pnpm deploy:monad` | `Fanout.ts` | Parameter `ausd`, default real Agora AUSD | `chain-10143` |

Parameters: `verifier` (required), `ausd`, and `firstBatchId` (default 1), passed with `--parameters params.json`, for example `{ "Fanout": { "verifier": "0x...", "firstBatchId": 1001 } }`, using the module id as the key. The older deployments in `ignition/deployments/` were made from earlier contract code (with `claimTtl`), so re-running their deploy scripts now would not match their records; deploy new code under a new deployment id.

Ignition remembers what it has already deployed. Running a deploy again with unchanged contracts does nothing. After changing a contract, deploy fresh with a new `--deployment-id`, then run `pnpm export-abis <new-id>` and update the addresses here:

```bash
pnpm hardhat ignition deploy ignition/modules/FanoutTestAusd.ts --network monadTestnet --deployment-id monad-test-ausd-v2
```

To try a module without spending MON, run it against the in-process network, for example `pnpm hardhat ignition deploy ignition/modules/FanoutTestAusd.ts`.

### Deploying SettleToUsdc

SettleToUsdc deploys on its own, next to whichever payout deployment the web app uses:

```bash
pnpm deploy:monad:settle-usdc   # ignition/modules/SettleToUsdc.ts, deployment id monad-settle-usdc
pnpm approve-swapper            # whitelister.setApprovedSwapper(<SettleToUsdc>), then checks pair.hasRole("APPROVED_SWAPPER", ...)
```

On testnet the whitelister's `setApprovedSwapper` is open to anyone; on mainnet Agora grants the role. `approve-swapper` reads the address from `ignition/deployments/monad-settle-usdc/deployed_addresses.json` (or `SETTLE_ADDRESS`), and does nothing if the role is already there. Then set `NEXT_PUBLIC_SETTLE_ADDRESS` in the web app (see below) and fill in the table at the top of this README.

## Web app integration

The web app (`apps/web`) uses the live contracts when `NEXT_PUBLIC_USE_MOCK=false` in `apps/web/.env.local`. It needs no other contract settings:

- `pnpm export-abis [deployment-id]` writes `apps/web/lib/fanout/abis/contracts.generated.ts`. That file holds the three ABIs (including custom errors, so failed transactions show readable reasons) and the deployed addresses, including the **payout token**, which it reads from the Treasury's constructor arguments. The default deployment id is `monad-ausd`.
- Until that file comes from a v3 deployment, the app calls v3 functions through hand-written fragments (`apps/web/lib/fanout/abis/v3.ts`, checked by `test/AbiFragments.ts`) and keeps them switched off (`config.payoutsV3`). They switch on when the generated ABI has `createBatchFor`, or with `NEXT_PUBLIC_PAYOUT_CONTRACTS=v3`.
- `apps/web/lib/config.ts` defaults every address (token, Treasury, BatchPayout, ClaimEscrow) to that file. `NEXT_PUBLIC_*_ADDRESS` env vars still override them, but leave them empty. Setting the token address without matching contracts makes every deposit fail.
- The CSV limit in `apps/web/lib/csv.ts` is 150 rows, matching `MAX_ROWS`.
- Privy sign-in creates the embedded wallet itself if the user has none (`apps/web/lib/auth/privy.tsx`), and the dashboard sidebar shows the wallet address.

### USDC for payees

The web app offers "Get it as USDC" after a claim and on the balance page once `NEXT_PUBLIC_SETTLE_ADDRESS` is set (the mock always offers it). `NEXT_PUBLIC_USDC_ADDRESS`, `NEXT_PUBLIC_USDC_DECIMALS` and `NEXT_PUBLIC_AGORA_PAIR_ADDRESS` default to the testnet values above. The payee signs the authorization in the browser and `/api/relay/settle` submits it with `RELAYER_PRIVATE_KEY` (signed-in users only, rate limited, quoted and simulated before any gas is spent). The SettleToUsdc ABI is hand-written in `apps/web/lib/fanout/abis/index.ts`, since `export-abis` reads one payout deployment.

### Switching deployments

The web app uses real AUSD (`monad-ausd`) by default. To point it at another deployment:

1. `pnpm export-abis <deployment-id>` (for example `monad-v2` for tAUSD).
2. Restart `pnpm dev`, then get AUSD into the platform wallet (for example, `requestFunds(<wallet>)` on the faucet).
3. Run deposit → batch → claim once, then update the table at the top of this README.

The web app still labels the token "AUSD" either way (`config.stablecoin.symbol`).

### Still to do on the web app side

- **Gas for payees.** Claims, sends to an address and changes to USDC go through our relayer, which pays the gas. A send is one ERC-3009 `transferWithAuthorization` on AUSD (the `bytes signature` overload) signed by the payee and submitted by `/api/relay/send`, so the payee needs no MON; without a relayer it falls back to a plain `transfer` from the payee's account. Paying someone by email: with v3, the payee signs and `/api/relay/pay-email` submits `depositAndCreateBatchFor`, so no MON is needed; with `monad-ausd` it still runs approve, `deposit` and `createBatch` from the payee's own account after the relayer tops it up with MON (`/api/relay/fees`).
- **Withdraw.** There is no withdraw button yet. A payee who paid by email and was refunded has that money in their Treasury balance; with no MON, they would need a signed withdraw that a relayer submits.
- **Rate limiting** on `/api/claim` before a public launch.
- **History.** Batch lists and payee history need the Envio indexer. It should read the `BatchCreated`, `ClaimOpened`, `Claimed`, `Refunded`, `Deposited` and `Withdrawn` events.

## Open questions

- Should refunds of expired claims happen automatically (a scheduled job calling `refundMany`), or stay a button the platform presses?
