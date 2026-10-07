import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, hashTypedData, keccak256, toHex, zeroHash, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

// Same signing code the web app uses, so the contracts are tested against the real client.
import { createBatchTypedData, signCreateBatch, type CreateBatchAuthorization } from "../../apps/web/lib/fanout/batch-authorization.ts";
import { generateClaimKey, signClaim, signVerification, type ClaimKey } from "../../apps/web/lib/fanout/claim-keys.ts";
import { randomNonce, signAuthorization, type Authorization, type TokenDomain } from "../../apps/web/lib/fanout/erc3009.ts";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();

const usd = (n: number) => BigInt(n) * 1_000_000n;
const MINUTE = 60n;
const DAY = 24n * 60n * MINUTE;
const MIN_WINDOW = 5n * MINUTE;
const MAX_WINDOW = 90n * DAY;
const DEFAULT_WINDOW = 30n * DAY;
const FIRST_BATCH_ID = 1001n;
const SENT = 0;
const CLAIMED = 1;
const REFUNDED = 2;

async function deploy() {
  const [deployer, platform, relayer, recipient, stranger] = await viem.getWalletClients();
  // Accounts that only ever sign: they hold AUSD and no gas money, like a passkey account paying by email.
  const payer = privateKeyToAccount(generatePrivateKey());
  const otherPayer = privateKeyToAccount(generatePrivateKey());
  const chainId = await publicClient.getChainId();

  const ausd = await viem.deployContract("MockAUSD3009");
  const treasury = await viem.deployContract("Treasury", [ausd.address]);
  const verifierKey = generatePrivateKey();
  const escrow = await viem.deployContract("ClaimEscrow", [ausd.address, treasury.address, privateKeyToAccount(verifierKey).address]);
  const batchPayout = await viem.deployContract("BatchPayout", [treasury.address, escrow.address, FIRST_BATCH_ID]);
  await treasury.write.wire([batchPayout.address, escrow.address]);
  await escrow.write.wire([batchPayout.address]);

  const as = <T extends "Treasury" | "BatchPayout" | "ClaimEscrow">(name: T, address: Address, wallet: typeof relayer) =>
    viem.getContractAt(name, address, { client: { wallet } });
  const asPlatform = {
    ausd: await viem.getContractAt("MockAUSD3009", ausd.address, { client: { wallet: platform } }),
    treasury: await as("Treasury", treasury.address, platform),
    batchPayout: await as("BatchPayout", batchPayout.address, platform),
  };
  const asRelayer = {
    treasury: await as("Treasury", treasury.address, relayer),
    batchPayout: await as("BatchPayout", batchPayout.address, relayer),
    escrow: await as("ClaimEscrow", escrow.address, relayer),
  };

  await ausd.write.mint([platform.account.address, usd(10_000)]);
  await asPlatform.ausd.write.approve([treasury.address, usd(10_000)]);
  await asPlatform.treasury.write.deposit([usd(1_000)]);
  await ausd.write.mint([payer.address, usd(500)]);
  await ausd.write.mint([otherPayer.address, usd(500)]);

  const tokenDomain: TokenDomain = { name: "Agora Dollar", version: "1", chainId, verifyingContract: ausd.address };
  return {
    deployer, platform, relayer, recipient, stranger, payer, otherPayer, chainId, verifierKey,
    ausd, treasury, escrow, batchPayout, asPlatform, asRelayer, tokenDomain,
  };
}

type Fixture = Awaited<ReturnType<typeof deploy>>;

const now = async () => BigInt((await publicClient.getBlock()).timestamp);

function rows(amounts: bigint[]) {
  const keys = amounts.map(() => generateClaimKey());
  return {
    keys,
    signers: keys.map((k) => k.claimSigner),
    amounts,
    emailHashes: amounts.map((_, i) => keccak256(toHex(`payee${i}-${Math.random()}@example.com`))),
  };
}
type Rows = ReturnType<typeof rows>;

/** An ERC-3009 ReceiveWithAuthorization from `from` to the Treasury, as the wallet signs it. */
async function depositAuth(f: Fixture, from: PrivateKeyAccount, value: bigint, overrides: Partial<Authorization> = {}, signer = from) {
  const auth: Authorization = {
    from: from.address,
    to: f.treasury.address,
    value,
    validAfter: 0n,
    validBefore: (await now()) + 600n,
    nonce: randomNonce(),
    ...overrides,
  };
  const signature = await signAuthorization(signer, "ReceiveWithAuthorization", f.tokenDomain, auth);
  return { auth, signature };
}

/** A CreateBatch authorization for `r`, signed by `signer` (the platform unless overridden). */
async function batchAuth(
  f: Fixture,
  platform: PrivateKeyAccount,
  r: Rows,
  overrides: Partial<CreateBatchAuthorization> = {},
  opts: { signer?: PrivateKeyAccount; batchPayout?: Address } = {},
) {
  const auth: CreateBatchAuthorization = {
    platform: platform.address,
    claimSigners: r.signers,
    amounts: r.amounts,
    emailHashes: r.emailHashes,
    claimWindow: 0n,
    nonce: randomNonce(),
    deadline: (await now()) + 600n,
    ...overrides,
  };
  const signature = await signCreateBatch(opts.signer ?? platform, opts.batchPayout ?? f.batchPayout.address, f.chainId, auth);
  return { auth, signature };
}

const forArgs = (a: CreateBatchAuthorization, signature: Hex, r: { signers: readonly Address[]; amounts: readonly bigint[]; emailHashes: readonly Hex[] } = { signers: a.claimSigners, amounts: a.amounts, emailHashes: a.emailHashes }, claimWindow = a.claimWindow, platform = a.platform) =>
  [platform, [...r.signers], [...r.amounts], [...r.emailHashes], claimWindow, { nonce: a.nonce, deadline: a.deadline, signature }] as const;

const depositArg = (d: Authorization, signature: Hex) => ({ validAfter: d.validAfter, validBefore: d.validBefore, nonce: d.nonce, signature });

async function claimRow(f: Fixture, key: ClaimKey) {
  const recipient = f.recipient.account.address;
  const message = { recipient, claimContract: f.escrow.address, chainId: f.chainId };
  const signature = await signClaim(key.privateKey, message);
  const verification = await signVerification(f.verifierKey, { ...message, claimSigner: key.claimSigner });
  return f.asRelayer.escrow.write.claim([key.claimSigner, recipient, signature, verification]);
}

async function expiresAtOf(f: Fixture, claimSigner: Address) {
  const [, , , expiresAt] = await f.escrow.read.claims([claimSigner]);
  return expiresAt;
}

/** Treasury AUSD == sum of platform balances; ClaimEscrow AUSD == sum of open (sent) claims. */
async function assertInvariants(f: Fixture, platforms: Address[], claimSigners: Address[]) {
  let balances = 0n;
  for (const p of new Set(platforms.map((a) => a.toLowerCase() as Address))) balances += await f.treasury.read.balanceOf([p]);
  assert.equal(await f.ausd.read.balanceOf([f.treasury.address]), balances, "Treasury AUSD == sum of balances");

  let open = 0n;
  for (const s of claimSigners) {
    const [amount, , status] = await f.escrow.read.claims([s]);
    if (status === SENT) open += amount;
  }
  assert.equal(await f.ausd.read.balanceOf([f.escrow.address]), open, "Escrow AUSD == sum of open claims");
}

describe("Treasury.depositWithAuthorization", () => {
  it("credits the signer, not the relayer that submits it", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { auth, signature } = await depositAuth(f, f.payer, usd(120));

    await viem.assertions.emitWithArgs(
      f.asRelayer.treasury.write.depositWithAuthorization([auth.from, auth.value, auth.validAfter, auth.validBefore, auth.nonce, signature]),
      f.treasury,
      "Deposited",
      [getAddress(f.payer.address), usd(120)],
    );
    assert.equal(await f.treasury.read.balanceOf([f.payer.address]), usd(120));
    assert.equal(await f.treasury.read.balanceOf([f.relayer.account.address]), 0n);
    assert.equal(await f.ausd.read.balanceOf([f.payer.address]), usd(380));
    await assertInvariants(f, [f.platform.account.address, f.payer.address, f.relayer.account.address], []);
  });

  it("rejects a wrong signer, a changed amount or payee, and an authorization made out to someone else", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const deposit = (a: Authorization, signature: Hex, from = a.from, value = a.value) =>
      f.asRelayer.treasury.write.depositWithAuthorization([from, value, a.validAfter, a.validBefore, a.nonce, signature]);

    // Signed by someone other than `from`.
    const forged = await depositAuth(f, f.payer, usd(10), {}, f.otherPayer);
    await viem.assertions.revertWithCustomError(deposit(forged.auth, forged.signature), f.ausd, "InvalidSignature");
    // A valid signature, but the submitter changes the amount or names another payer.
    const ok = await depositAuth(f, f.payer, usd(10));
    await viem.assertions.revertWithCustomError(deposit(ok.auth, ok.signature, ok.auth.from, usd(11)), f.ausd, "InvalidSignature");
    await viem.assertions.revertWithCustomError(deposit(ok.auth, ok.signature, f.otherPayer.address), f.ausd, "InvalidSignature");
    // An authorization to pay someone else can't be turned into a deposit.
    const elsewhere = await depositAuth(f, f.payer, usd(10), { to: f.relayer.account.address });
    await viem.assertions.revertWithCustomError(deposit(elsewhere.auth, elsewhere.signature), f.ausd, "InvalidSignature");

    assert.equal(await f.treasury.read.balanceOf([f.payer.address]), 0n);
    assert.equal(await f.ausd.read.balanceOf([f.payer.address]), usd(500));
  });

  it("can't be replayed", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { auth, signature } = await depositAuth(f, f.payer, usd(10));
    const args = [auth.from, auth.value, auth.validAfter, auth.validBefore, auth.nonce, signature] as const;
    await f.asRelayer.treasury.write.depositWithAuthorization([...args]);
    await viem.assertions.revertWithCustomError(f.asRelayer.treasury.write.depositWithAuthorization([...args]), f.ausd, "UsedOrCanceledAuthorization");
    assert.equal(await f.treasury.read.balanceOf([f.payer.address]), usd(10));
  });

  it("only works inside its time window", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const t = await now();
    const late = await depositAuth(f, f.payer, usd(10), { validBefore: t + 60n });
    await networkHelpers.time.increase(120);
    await viem.assertions.revertWithCustomError(
      f.asRelayer.treasury.write.depositWithAuthorization([late.auth.from, late.auth.value, late.auth.validAfter, late.auth.validBefore, late.auth.nonce, late.signature]),
      f.ausd,
      "AuthorizationExpired",
    );
    const early = await depositAuth(f, f.payer, usd(10), { validAfter: (await now()) + 3_600n, validBefore: (await now()) + 7_200n });
    await viem.assertions.revertWithCustomError(
      f.asRelayer.treasury.write.depositWithAuthorization([early.auth.from, early.auth.value, early.auth.validAfter, early.auth.validBefore, early.auth.nonce, early.signature]),
      f.ausd,
      "AuthorizationNotYetValid",
    );
  });

  it("rejects zero amounts and an empty payer", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { auth, signature } = await depositAuth(f, f.payer, usd(10));
    await viem.assertions.revertWithCustomError(
      f.asRelayer.treasury.write.depositWithAuthorization([auth.from, 0n, auth.validAfter, auth.validBefore, auth.nonce, signature]),
      f.treasury,
      "ZeroAmount",
    );
    await viem.assertions.revertWithCustomError(
      f.asRelayer.treasury.write.depositWithAuthorization(["0x0000000000000000000000000000000000000000", auth.value, auth.validAfter, auth.validBefore, auth.nonce, signature]),
      f.treasury,
      "ZeroAddress",
    );
  });

  it("the plain deposit still credits msg.sender", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    await viem.assertions.emitWithArgs(f.asPlatform.treasury.write.deposit([usd(5)]), f.treasury, "Deposited", [getAddress(f.platform.account.address), usd(5)]);
    assert.equal(await f.treasury.read.balanceOf([f.platform.account.address]), usd(1_005));
  });
});

describe("BatchPayout claim windows", () => {
  it("numbers batches from firstBatchId", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    assert.equal(await f.batchPayout.read.nextBatchId(), FIRST_BATCH_ID);
    const r = rows([usd(1)]);
    await viem.assertions.emitWithArgs(
      f.asPlatform.batchPayout.write.createBatch([r.signers, r.amounts, r.emailHashes]),
      f.batchPayout,
      "BatchCreated",
      [FIRST_BATCH_ID, getAddress(f.platform.account.address), usd(1), 1n],
    );
  });

  it("defaults to 30 days, with the three-argument createBatch or a window of 0", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const a = rows([usd(1)]);
    await f.asPlatform.batchPayout.write.createBatch([a.signers, a.amounts, a.emailHashes]);
    assert.equal(await expiresAtOf(f, a.signers[0]), (await now()) + DEFAULT_WINDOW);

    const b = rows([usd(1)]);
    await f.asPlatform.batchPayout.write.createBatch([b.signers, b.amounts, b.emailHashes, 0n]);
    assert.equal(await expiresAtOf(f, b.signers[0]), (await now()) + DEFAULT_WINDOW);
  });

  it("sets each batch's expiry from its own window, at the bounds and in between", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    for (const window of [MIN_WINDOW, 10n * MINUTE, DAY, 7n * DAY, MAX_WINDOW]) {
      const r = rows([usd(1), usd(2)]);
      await f.asPlatform.batchPayout.write.createBatch([r.signers, r.amounts, r.emailHashes, window]);
      const expected = (await now()) + window;
      assert.equal(await expiresAtOf(f, r.signers[0]), expected);
      assert.equal(await expiresAtOf(f, r.signers[1]), expected);
    }
  });

  it("rejects a window outside 5 minutes to 90 days", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const r = rows([usd(1)]);
    for (const window of [1n, MIN_WINDOW - 1n, MAX_WINDOW + 1n, 2n ** 64n - 1n]) {
      await viem.assertions.revertWithCustomErrorWithArgs(
        f.asPlatform.batchPayout.write.createBatch([r.signers, r.amounts, r.emailHashes, window]),
        f.batchPayout,
        "ClaimWindowOutOfRange",
        [window, MIN_WINDOW, MAX_WINDOW],
      );
    }
    assert.equal(await f.treasury.read.balanceOf([f.platform.account.address]), usd(1_000));
  });

  it("refunds after a short window, to the platform's balance", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const r = rows([usd(30)]);
    await f.asPlatform.batchPayout.write.createBatch([r.signers, r.amounts, r.emailHashes, 10n * MINUTE]);
    await viem.assertions.revertWithCustomError(f.asRelayer.escrow.write.refund([r.signers[0]]), f.escrow, "NotExpired");

    await networkHelpers.time.increase(10n * MINUTE);
    await viem.assertions.emitWithArgs(f.asRelayer.escrow.write.refund([r.signers[0]]), f.escrow, "Refunded", [
      getAddress(r.signers[0]),
      getAddress(f.platform.account.address),
      usd(30),
    ]);
    assert.equal(await f.treasury.read.balanceOf([f.platform.account.address]), usd(1_000));
    await assertInvariants(f, [f.platform.account.address], r.signers);
  });
});

describe("ClaimEscrow.refundMany", () => {
  it("refunds only the expired, unclaimed rows and skips the rest", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const short = rows([usd(10), usd(20), usd(30)]);
    const long = rows([usd(40)]);
    await f.asPlatform.batchPayout.write.createBatch([short.signers, short.amounts, short.emailHashes, MIN_WINDOW]);
    await f.asPlatform.batchPayout.write.createBatch([long.signers, long.amounts, long.emailHashes, DAY]);
    await claimRow(f, short.keys[0]);
    await networkHelpers.time.increase(MIN_WINDOW);

    const list = [...short.signers, ...long.signers, generateClaimKey().claimSigner];
    const { result } = await f.asRelayer.escrow.simulate.refundMany([list]);
    assert.equal(result, 2n);
    await f.asRelayer.escrow.write.refundMany([list]);

    const status = async (s: Address) => (await f.escrow.read.claims([s]))[2];
    assert.deepEqual(
      await Promise.all(list.slice(0, 4).map(status)),
      [CLAIMED, REFUNDED, REFUNDED, SENT],
    );
    assert.equal(await f.treasury.read.balanceOf([f.platform.account.address]), usd(1_000) - usd(10) - usd(40));
    await assertInvariants(f, [f.platform.account.address], list);

    // Nothing left to refund: a second call is a no-op, not a revert.
    const again = await f.asRelayer.escrow.simulate.refundMany([list]);
    assert.equal(again.result, 0n);
  });
});

describe("BatchPayout.createBatchFor", () => {
  it("a relayer creates the batch with the platform's signature; the platform's balance pays", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const d = await depositAuth(f, f.payer, usd(100));
    await f.asRelayer.treasury.write.depositWithAuthorization([d.auth.from, d.auth.value, d.auth.validAfter, d.auth.validBefore, d.auth.nonce, d.signature]);

    const r = rows([usd(60), usd(40)]);
    const { auth, signature } = await batchAuth(f, f.payer, r, { claimWindow: DAY });
    const hash = await f.asRelayer.batchPayout.write.createBatchFor(forArgs(auth, signature));
    await viem.assertions.emitWithArgs(Promise.resolve(hash), f.batchPayout, "BatchCreated", [FIRST_BATCH_ID, getAddress(f.payer.address), usd(100), 2n]);
    await viem.assertions.emitWithArgs(Promise.resolve(hash), f.batchPayout, "BatchAuthorizationUsed", [getAddress(f.payer.address), auth.nonce]);

    const [platform, , total, signers] = await f.batchPayout.read.getBatch([FIRST_BATCH_ID]);
    assert.equal(platform, getAddress(f.payer.address));
    assert.equal(total, usd(100));
    assert.deepEqual(signers, r.signers.map((s) => getAddress(s)));
    assert.equal(await f.treasury.read.balanceOf([f.payer.address]), 0n);
    assert.equal(await f.treasury.read.balanceOf([f.relayer.account.address]), 0n);
    assert.equal(await expiresAtOf(f, r.signers[0]), (await now()) + DAY);
    assert.equal(await f.batchPayout.read.authorizationState([f.payer.address, auth.nonce]), true);
  });

  it("matches the digest the contract computes", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const r = rows([usd(1), usd(2)]);
    const { auth } = await batchAuth(f, f.payer, r, { claimWindow: 600n });
    const onchain = await f.batchPayout.read.createBatchDigest([auth.platform, r.signers, r.amounts, r.emailHashes, auth.claimWindow, auth.nonce, auth.deadline]);
    assert.equal(onchain, hashTypedData(createBatchTypedData(f.batchPayout.address, f.chainId, auth)));
  });

  it("rejects tampered rows, window, platform or signer", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const d = await depositAuth(f, f.payer, usd(300));
    await f.asRelayer.treasury.write.depositWithAuthorization([d.auth.from, d.auth.value, d.auth.validAfter, d.auth.validBefore, d.auth.nonce, d.signature]);

    const r = rows([usd(10), usd(20)]);
    const { auth, signature } = await batchAuth(f, f.payer, r, { claimWindow: DAY });
    const other = generateClaimKey().claimSigner;
    const bad = (args: ReturnType<typeof forArgs>) =>
      viem.assertions.revertWithCustomError(f.asRelayer.batchPayout.write.createBatchFor(args), f.batchPayout, "BadAuthorization");

    await bad(forArgs(auth, signature, { ...r, amounts: [usd(10), usd(21)] }));
    await bad(forArgs(auth, signature, { ...r, signers: [r.signers[0], other] }));
    await bad(forArgs(auth, signature, { ...r, signers: [r.signers[1], r.signers[0]] }));
    await bad(forArgs(auth, signature, { ...r, emailHashes: [r.emailHashes[0], zeroHash] }));
    await bad(forArgs(auth, signature, { signers: [r.signers[0]], amounts: [usd(10)], emailHashes: [r.emailHashes[0]] }));
    await bad(forArgs(auth, signature, undefined, MIN_WINDOW));
    await bad(forArgs(auth, signature, undefined, undefined, f.otherPayer.address));
    await bad(forArgs({ ...auth, deadline: auth.deadline + 1n }, signature));
    await bad(forArgs({ ...auth, nonce: randomNonce() }, signature));
    // Signed by someone else for the payer, or for another BatchPayout (domain).
    const forged = await batchAuth(f, f.payer, r, {}, { signer: f.otherPayer });
    await bad(forArgs(forged.auth, forged.signature));
    const elsewhere = await batchAuth(f, f.payer, r, {}, { batchPayout: f.treasury.address });
    await bad(forArgs(elsewhere.auth, elsewhere.signature));
    await bad(forArgs(auth, "0x1234"));

    // Nothing moved, and the untouched authorization still works.
    assert.equal(await f.treasury.read.balanceOf([f.payer.address]), usd(300));
    await f.asRelayer.batchPayout.write.createBatchFor(forArgs(auth, signature));
    assert.equal(await f.treasury.read.balanceOf([f.payer.address]), usd(270));
  });

  it("can't be replayed, used after its deadline, or used once cancelled", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const d = await depositAuth(f, f.payer, usd(300));
    await f.asRelayer.treasury.write.depositWithAuthorization([d.auth.from, d.auth.value, d.auth.validAfter, d.auth.validBefore, d.auth.nonce, d.signature]);

    const r = rows([usd(10)]);
    const { auth, signature } = await batchAuth(f, f.payer, r);
    await f.asRelayer.batchPayout.write.createBatchFor(forArgs(auth, signature));
    await viem.assertions.revertWithCustomErrorWithArgs(
      f.asRelayer.batchPayout.write.createBatchFor(forArgs(auth, signature)),
      f.batchPayout,
      "AuthorizationAlreadyUsed",
      [getAddress(f.payer.address), auth.nonce],
    );

    const late = await batchAuth(f, f.payer, rows([usd(10)]), { deadline: (await now()) + 60n });
    await networkHelpers.time.increase(61);
    await viem.assertions.revertWithCustomErrorWithArgs(
      f.asRelayer.batchPayout.write.createBatchFor(forArgs(late.auth, late.signature)),
      f.batchPayout,
      "AuthorizationExpired",
      [late.auth.deadline],
    );

    // A platform can void an authorization it signed from its own account.
    const platformAccount = f.platform.account.address;
    const pr = rows([usd(5)]);
    const nonce = randomNonce();
    await f.asPlatform.batchPayout.write.cancelAuthorization([nonce]);
    const auth2: CreateBatchAuthorization = { platform: platformAccount, claimSigners: pr.signers, amounts: pr.amounts, emailHashes: pr.emailHashes, claimWindow: 0n, nonce, deadline: (await now()) + 600n };
    const sig2 = await f.platform.signTypedData({ ...createBatchTypedData(f.batchPayout.address, f.chainId, auth2), account: f.platform.account });
    await viem.assertions.revertWithCustomError(f.asRelayer.batchPayout.write.createBatchFor(forArgs(auth2, sig2)), f.batchPayout, "AuthorizationAlreadyUsed");
    await viem.assertions.revertWithCustomError(f.asPlatform.batchPayout.write.cancelAuthorization([nonce]), f.batchPayout, "AuthorizationAlreadyUsed");
  });

  it("fails without enough balance, and checks rows like createBatch", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const r = rows([usd(10)]);
    const { auth, signature } = await batchAuth(f, f.payer, r);
    await viem.assertions.revertWithCustomErrorWithArgs(
      f.asRelayer.batchPayout.write.createBatchFor(forArgs(auth, signature)),
      f.treasury,
      "InsufficientBalance",
      [0n, usd(10)],
    );
    const empty = await batchAuth(f, f.payer, { keys: [], signers: [], amounts: [], emailHashes: [] });
    await viem.assertions.revertWithCustomError(f.asRelayer.batchPayout.write.createBatchFor(forArgs(empty.auth, empty.signature)), f.batchPayout, "EmptyBatch");
    const zero = await batchAuth(f, f.payer, r, { platform: "0x0000000000000000000000000000000000000000" });
    await viem.assertions.revertWithCustomError(f.asRelayer.batchPayout.write.createBatchFor(forArgs(zero.auth, zero.signature)), f.batchPayout, "ZeroAddress");
    const window = await batchAuth(f, f.payer, r, { claimWindow: MAX_WINDOW + 1n });
    await viem.assertions.revertWithCustomError(f.asRelayer.batchPayout.write.createBatchFor(forArgs(window.auth, window.signature)), f.batchPayout, "ClaimWindowOutOfRange");
  });
});

describe("BatchPayout.depositAndCreateBatchFor (pay by email, no gas)", () => {
  async function payByEmail(f: Fixture, payer: PrivateKeyAccount, amount: bigint, claimWindow = 0n) {
    const r = rows([amount]);
    const d = await depositAuth(f, payer, amount);
    const b = await batchAuth(f, payer, r, { claimWindow });
    return { r, d, b, args: [...forArgs(b.auth, b.signature), depositArg(d.auth, d.signature)] as const };
  }

  it("deposits and pays in one relayed transaction; the payer spends no gas", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { r, args } = await payByEmail(f, f.payer, usd(75), 10n * MINUTE);
    await viem.assertions.balancesHaveChanged(f.asRelayer.batchPayout.write.depositAndCreateBatchFor(args), [{ address: f.payer.address, amount: 0n }]);

    assert.equal(await f.ausd.read.balanceOf([f.payer.address]), usd(425));
    assert.equal(await f.treasury.read.balanceOf([f.payer.address]), 0n);
    const [amount, platform, status, , emailHash] = await f.escrow.read.claims([r.signers[0]]);
    assert.deepEqual([amount, platform, status, emailHash], [usd(75), getAddress(f.payer.address), SENT, r.emailHashes[0]]);
    assert.equal(await expiresAtOf(f, r.signers[0]), (await now()) + 10n * MINUTE);
    await assertInvariants(f, [f.platform.account.address, f.payer.address], r.signers);

    // The payee claims it.
    await claimRow(f, r.keys[0]);
    assert.equal(await f.ausd.read.balanceOf([f.recipient.account.address]), usd(75));
  });

  it("an unclaimed payment is refunded to the payer's balance, not the relayer's", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { r, args } = await payByEmail(f, f.payer, usd(50), MIN_WINDOW);
    await f.asRelayer.batchPayout.write.depositAndCreateBatchFor(args);
    await networkHelpers.time.increase(MIN_WINDOW);
    await f.asRelayer.escrow.write.refundMany([r.signers]);
    assert.equal(await f.treasury.read.balanceOf([f.payer.address]), usd(50));
    assert.equal(await f.treasury.read.balanceOf([f.relayer.account.address]), 0n);
    await assertInvariants(f, [f.platform.account.address, f.payer.address, f.relayer.account.address], r.signers);
  });

  it("is all or nothing: a failing batch leaves the deposit unused", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const first = await payByEmail(f, f.payer, usd(10));
    await f.asRelayer.batchPayout.write.depositAndCreateBatchFor(first.args);

    // Reuses a claim signer, so ClaimEscrow.open reverts after the deposit step.
    const r = { ...rows([usd(20)]), signers: first.r.signers };
    const d = await depositAuth(f, f.payer, usd(20));
    const b = await batchAuth(f, f.payer, r);
    await viem.assertions.revertWithCustomError(
      f.asRelayer.batchPayout.write.depositAndCreateBatchFor([...forArgs(b.auth, b.signature), depositArg(d.auth, d.signature)]),
      f.escrow,
      "ClaimSignerUsed",
    );
    assert.equal(await f.ausd.read.balanceOf([f.payer.address]), usd(490));
    assert.equal(await f.treasury.read.balanceOf([f.payer.address]), 0n);
    assert.equal(await f.ausd.read.authorizationState([f.payer.address, d.auth.nonce]), false);
    assert.equal(await f.batchPayout.read.authorizationState([f.payer.address, b.auth.nonce]), false);
  });

  it("the deposit must be for exactly the batch total, from the platform", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const r = rows([usd(10), usd(5)]);
    const b = await batchAuth(f, f.payer, r);
    const tooSmall = await depositAuth(f, f.payer, usd(10));
    await viem.assertions.revertWithCustomError(
      f.asRelayer.batchPayout.write.depositAndCreateBatchFor([...forArgs(b.auth, b.signature), depositArg(tooSmall.auth, tooSmall.signature)]),
      f.ausd,
      "InvalidSignature",
    );
    // Someone else's deposit can't fund the payer's batch.
    const others = await depositAuth(f, f.otherPayer, usd(15));
    await viem.assertions.revertWithCustomError(
      f.asRelayer.batchPayout.write.depositAndCreateBatchFor([...forArgs(b.auth, b.signature), depositArg(others.auth, others.signature)]),
      f.ausd,
      "InvalidSignature",
    );
    assert.equal(await f.ausd.read.balanceOf([f.otherPayer.address]), usd(500));
  });

  it("if someone submits the deposit on its own first, createBatchFor still finishes the payment", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { d, b, args } = await payByEmail(f, f.payer, usd(40));
    await f.asRelayer.treasury.write.depositWithAuthorization([d.auth.from, d.auth.value, d.auth.validAfter, d.auth.validBefore, d.auth.nonce, d.signature]);
    await viem.assertions.revertWithCustomError(f.asRelayer.batchPayout.write.depositAndCreateBatchFor(args), f.ausd, "UsedOrCanceledAuthorization");
    await f.asRelayer.batchPayout.write.createBatchFor(forArgs(b.auth, b.signature));
    assert.equal(await f.treasury.read.balanceOf([f.payer.address]), 0n);
  });
});

describe("invariants", () => {
  it("hold through a random mix of deposits, payouts, claims, refunds and withdrawals", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const platforms: Address[] = [f.platform.account.address, f.payer.address, f.otherPayer.address];
    const open: ClaimKey[] = [];
    const allSigners: Address[] = [];
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const windows = [MIN_WINDOW, 10n * MINUTE, DAY, 0n];
    const succeeded = new Set<number>();

    for (let step = 0; step < 80; step++) {
      const action = rand(7);
      const payer = rand(2) ? f.payer : f.otherPayer;
      const amount = usd(1 + rand(20));
      try {
        if (action === 0) {
          await f.asPlatform.treasury.write.deposit([amount]);
        } else if (action === 1) {
          const d = await depositAuth(f, payer, amount);
          await f.asRelayer.treasury.write.depositWithAuthorization([d.auth.from, d.auth.value, d.auth.validAfter, d.auth.validBefore, d.auth.nonce, d.signature]);
        } else if (action === 2) {
          const r = rows(Array.from({ length: 1 + rand(3) }, () => usd(1 + rand(5))));
          await f.asPlatform.batchPayout.write.createBatch([r.signers, r.amounts, r.emailHashes, windows[rand(windows.length)]]);
          open.push(...r.keys);
          allSigners.push(...r.signers);
        } else if (action === 3) {
          const r = rows([amount]);
          const d = await depositAuth(f, payer, amount);
          const b = await batchAuth(f, payer, r, { claimWindow: windows[rand(windows.length)] });
          await f.asRelayer.batchPayout.write.depositAndCreateBatchFor([...forArgs(b.auth, b.signature), depositArg(d.auth, d.signature)]);
          open.push(...r.keys);
          allSigners.push(...r.signers);
        } else if (action === 4 && open.length) {
          await claimRow(f, open.splice(rand(open.length), 1)[0]);
        } else if (action === 5) {
          await networkHelpers.time.increase(windows[rand(3)]);
          await f.asRelayer.escrow.write.refundMany([allSigners]);
        } else {
          await f.asPlatform.treasury.write.withdraw([usd(1)]);
        }
        succeeded.add(action);
      } catch {
        // Reverts (e.g. not enough balance) change nothing; the invariants must still hold.
      }
      await assertInvariants(f, platforms, allSigners);
    }
    // The run exercised every kind of step at least once.
    assert.deepEqual([...succeeded].sort(), [0, 1, 2, 3, 4, 5, 6]);
    const statuses = await Promise.all(allSigners.map(async (s) => (await f.escrow.read.claims([s]))[2]));
    assert.ok(statuses.includes(CLAIMED) && statuses.includes(REFUNDED), "some rows were claimed and some refunded");
  });
});
