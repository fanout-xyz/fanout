import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, keccak256, toHex, zeroAddress, zeroHash, type Address } from "viem";

// Same signing code the claim page uses, so the contract is tested against the real client.
import { generateClaimKey, signClaim, signVerification, type ClaimKey } from "../../apps/web/lib/fanout/claim-keys.ts";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();

const usd = (n: number) => BigInt(n) * 1_000_000n;
const TTL = 30n * 24n * 60n * 60n;
const SENT = 0;
const CLAIMED = 1;
const REFUNDED = 2;

async function deploy() {
  const [deployer, platform, payee, relayer, stranger] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  const ausd = await viem.deployContract("MockAUSD");
  const treasury = await viem.deployContract("Treasury", [ausd.address]);
  const verifierKey = generatePrivateKey();
  const escrow = await viem.deployContract("ClaimEscrow", [ausd.address, treasury.address, privateKeyToAccount(verifierKey).address]);
  const batchPayout = await viem.deployContract("BatchPayout", [treasury.address, escrow.address, 0n]);
  await treasury.write.wire([batchPayout.address, escrow.address]);
  await escrow.write.wire([batchPayout.address]);

  const asPlatform = {
    ausd: await viem.getContractAt("MockAUSD", ausd.address, { client: { wallet: platform } }),
    treasury: await viem.getContractAt("Treasury", treasury.address, { client: { wallet: platform } }),
    batchPayout: await viem.getContractAt("BatchPayout", batchPayout.address, { client: { wallet: platform } }),
  };
  const asRelayer = {
    escrow: await viem.getContractAt("ClaimEscrow", escrow.address, { client: { wallet: relayer } }),
  };

  await ausd.write.mint([platform.account.address, usd(10_000)]);
  await asPlatform.ausd.write.approve([treasury.address, usd(10_000)]);
  await asPlatform.treasury.write.deposit([usd(1_000)]);

  return { deployer, platform, payee, relayer, stranger, chainId, verifierKey, ausd, treasury, escrow, batchPayout, asPlatform, asRelayer };
}

type Fixture = Awaited<ReturnType<typeof deploy>>;

function rows(amounts: bigint[]) {
  const keys = amounts.map(() => generateClaimKey());
  const signers = keys.map((k) => k.claimSigner);
  const emailHashes = amounts.map((_, i) => (i % 2 ? zeroHash : keccak256(toHex(`payee${i}@example.com`))));
  return { keys, signers, amounts, emailHashes };
}

/** Deploys, then pays out one batch. Returns the fixture plus the batch's keys. */
async function deployWithBatch() {
  const f = await deploy();
  const batch = rows([usd(100), usd(50), usd(25)]);
  await f.asPlatform.batchPayout.write.createBatch([batch.signers, batch.amounts, batch.emailHashes]);
  return { ...f, batch };
}

function sign(f: Fixture, key: ClaimKey, recipient: Address, overrides: { claimContract?: Address; chainId?: number } = {}) {
  return signClaim(key.privateKey, {
    recipient,
    claimContract: overrides.claimContract ?? f.escrow.address,
    chainId: overrides.chainId ?? f.chainId,
  });
}

/** The verifier's co-signature, as the server issues it after checking the claimer's email. */
function verify(f: Fixture, claimSigner: Address, recipient: Address, overrides: { verifierKey?: `0x${string}` } = {}) {
  return signVerification(overrides.verifierKey ?? f.verifierKey, { claimSigner, recipient, claimContract: f.escrow.address, chainId: f.chainId });
}

describe("Treasury", () => {
  it("deposit raises the platform's balance and emits Deposited", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    assert.equal(await f.treasury.read.balanceOf([f.platform.account.address]), usd(1_000));

    await viem.assertions.emitWithArgs(f.asPlatform.treasury.write.deposit([usd(5)]), f.treasury, "Deposited", [
      getAddress(f.platform.account.address),
      usd(5),
    ]);
    assert.equal(await f.treasury.read.balanceOf([f.platform.account.address]), usd(1_005));
    assert.equal(await f.ausd.read.balanceOf([f.treasury.address]), usd(1_005));
  });

  it("deposit without approval fails", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    await f.ausd.write.mint([f.stranger.account.address, usd(10)]);
    const treasury = await viem.getContractAt("Treasury", f.treasury.address, { client: { wallet: f.stranger } });
    await viem.assertions.revertWithCustomError(treasury.write.deposit([usd(10)]), f.ausd, "ERC20InsufficientAllowance");
  });

  it("withdraw returns unused balance and can't exceed it", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const before = await f.ausd.read.balanceOf([f.platform.account.address]);

    await f.asPlatform.treasury.write.withdraw([usd(400)]);
    assert.equal(await f.treasury.read.balanceOf([f.platform.account.address]), usd(600));
    assert.equal(await f.ausd.read.balanceOf([f.platform.account.address]), before + usd(400));

    await viem.assertions.revertWithCustomErrorWithArgs(
      f.asPlatform.treasury.write.withdraw([usd(601)]),
      f.treasury,
      "InsufficientBalance",
      [usd(600), usd(601)],
    );
  });

  it("only BatchPayout can debit and only ClaimEscrow can credit", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const treasury = await viem.getContractAt("Treasury", f.treasury.address, { client: { wallet: f.platform } });
    await viem.assertions.revertWithCustomError(treasury.write.debit([f.platform.account.address, 1n]), f.treasury, "Unauthorized");
    await viem.assertions.revertWithCustomError(treasury.write.credit([f.platform.account.address, 1n]), f.treasury, "Unauthorized");
  });

  it("can only be wired once, by the owner", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(f.treasury.write.wire([f.stranger.account.address, f.stranger.account.address]), f.treasury, "AlreadyWired");
    await viem.assertions.revertWithCustomError(f.escrow.write.wire([f.stranger.account.address]), f.escrow, "AlreadyWired");

    const fresh = await viem.deployContract("Treasury", [f.ausd.address]);
    const asStranger = await viem.getContractAt("Treasury", fresh.address, { client: { wallet: f.stranger } });
    await viem.assertions.revertWithCustomError(asStranger.write.wire([f.stranger.account.address, f.stranger.account.address]), fresh, "OwnableUnauthorizedAccount");
  });
});

describe("BatchPayout", () => {
  it("creates a 150-row batch in one transaction", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const batch = rows(Array.from({ length: 150 }, (_, i) => usd(1) + BigInt(i)));
    const total = batch.amounts.reduce((a, b) => a + b, 0n);

    const hash = await f.asPlatform.batchPayout.write.createBatch([batch.signers, batch.amounts, batch.emailHashes]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`      gas for 150 rows: ${receipt.gasUsed}`);

    const [platform, createdAt, onchainTotal, signers] = await f.batchPayout.read.getBatch([1n]);
    assert.equal(platform, getAddress(f.platform.account.address));
    assert.ok(createdAt > 0n);
    assert.equal(onchainTotal, total);
    assert.deepEqual(signers, batch.signers.map((s) => getAddress(s)));

    assert.equal(await f.treasury.read.balanceOf([f.platform.account.address]), usd(1_000) - total);
    assert.equal(await f.ausd.read.balanceOf([f.escrow.address]), total);

    const [amount, claimPlatform, status, emailHash] = await f.escrow.read.getClaim([batch.signers[0]]);
    assert.deepEqual([amount, claimPlatform, status, emailHash], [batch.amounts[0], getAddress(f.platform.account.address), SENT, batch.emailHashes[0]]);
  });

  it("a full batch with an email on every row fits Monad's per-transaction gas limit", async () => {
    // Monad caps a transaction at 30M gas (docs.monad.xyz/developer-essentials/gas-pricing).
    // Gas here is the Ethereum (Cancun) schedule; Monad prices storage per page and cold access
    // higher, so the margin we require leaves room for that difference.
    const MONAD_TX_GAS_LIMIT = 30_000_000n;
    const f = await networkHelpers.loadFixture(deploy);
    const gasFor = async (n: number) => {
      const batch = rows(Array.from({ length: n }, () => usd(1)));
      const emailHashes = batch.signers.map((s) => keccak256(toHex(`${s}@fanout.tech`)));
      const hash = await f.asPlatform.batchPayout.write.createBatch([batch.signers, batch.amounts, emailHashes]);
      return (await publicClient.waitForTransactionReceipt({ hash })).gasUsed;
    };

    const one = await gasFor(1);
    const full = await gasFor(150);
    const perRow = (full - one) / 149n;
    const maxRows = 1n + (MONAD_TX_GAS_LIMIT - one) / perRow;
    console.log(
      `      150 rows, every email set: ${full} gas (${(Number(full) / 1e6).toFixed(2)}M), ` +
        `${((Number(full) * 100) / Number(MONAD_TX_GAS_LIMIT)).toFixed(0)}% of Monad's 30M; ` +
        `~${perRow} gas per row, so ~${maxRows} rows would hit the cap`,
    );
    assert.ok(full * 10n < MONAD_TX_GAS_LIMIT * 6n, "a full batch should use under 60% of the per-transaction limit");
  });

  it("emits BatchCreated with increasing ids", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const a = rows([usd(1), usd(2)]);
    await viem.assertions.emitWithArgs(
      f.asPlatform.batchPayout.write.createBatch([a.signers, a.amounts, a.emailHashes]),
      f.batchPayout,
      "BatchCreated",
      [1n, getAddress(f.platform.account.address), usd(3), 2n],
    );
    const b = rows([usd(4)]);
    await viem.assertions.emitWithArgs(
      f.asPlatform.batchPayout.write.createBatch([b.signers, b.amounts, b.emailHashes]),
      f.batchPayout,
      "BatchCreated",
      [2n, getAddress(f.platform.account.address), usd(4), 1n],
    );
  });

  it("rejects bad input", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const bp = f.asPlatform.batchPayout;
    const ok = rows([usd(1), usd(2)]);

    await viem.assertions.revertWithCustomError(bp.write.createBatch([[], [], []]), f.batchPayout, "EmptyBatch");
    await viem.assertions.revertWithCustomError(bp.write.createBatch([ok.signers, [usd(1)], ok.emailHashes]), f.batchPayout, "LengthMismatch");
    await viem.assertions.revertWithCustomError(bp.write.createBatch([ok.signers, ok.amounts, [zeroHash]]), f.batchPayout, "LengthMismatch");

    const tooMany = rows(Array.from({ length: 151 }, () => 1n));
    await viem.assertions.revertWithCustomErrorWithArgs(
      bp.write.createBatch([tooMany.signers, tooMany.amounts, tooMany.emailHashes]),
      f.batchPayout,
      "TooManyRows",
      [151n, 150n],
    );

    await viem.assertions.revertWithCustomError(bp.write.createBatch([ok.signers, [usd(1), 0n], ok.emailHashes]), f.escrow, "ZeroAmount");
    await viem.assertions.revertWithCustomError(bp.write.createBatch([[ok.signers[0], zeroAddress], ok.amounts, ok.emailHashes]), f.escrow, "ZeroAddress");

    await viem.assertions.revertWithCustomErrorWithArgs(
      bp.write.createBatch([[ok.signers[0], ok.signers[0]], ok.amounts, ok.emailHashes]),
      f.escrow,
      "ClaimSignerUsed",
      [getAddress(ok.signers[0])],
    );

    await bp.write.createBatch([ok.signers, ok.amounts, ok.emailHashes]);
    await viem.assertions.revertWithCustomErrorWithArgs(
      bp.write.createBatch([[ok.signers[1]], [usd(1)], [zeroHash]]),
      f.escrow,
      "ClaimSignerUsed",
      [getAddress(ok.signers[1])],
    );

    const big = rows([usd(998)]);
    await viem.assertions.revertWithCustomErrorWithArgs(
      bp.write.createBatch([big.signers, big.amounts, big.emailHashes]),
      f.treasury,
      "InsufficientBalance",
      [usd(997), usd(998)],
    );
  });

  it("getBatch and getClaim return zero values for unknown ids", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const [platform, createdAt, total, signers] = await f.batchPayout.read.getBatch([42n]);
    assert.deepEqual([platform, createdAt, total, signers], [zeroAddress, 0n, 0n, []]);

    const [amount, claimPlatform, status, emailHash] = await f.escrow.read.getClaim([generateClaimKey().claimSigner]);
    assert.deepEqual([amount, claimPlatform, status, emailHash], [0n, zeroAddress, 0, zeroHash]);
  });

  it("only BatchPayout can open claims", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const escrow = await viem.getContractAt("ClaimEscrow", f.escrow.address, { client: { wallet: f.platform } });
    const r = rows([usd(1)]);
    await viem.assertions.revertWithCustomError(
      escrow.write.open([1n, f.platform.account.address, r.signers, r.amounts, r.emailHashes, 0n]),
      f.escrow,
      "Unauthorized",
    );
  });
});

describe("ClaimEscrow", () => {
  it("a relayer submits a valid claim; the payee gets paid and status is claimed", async () => {
    const f = await networkHelpers.loadFixture(deployWithBatch);
    const key = f.batch.keys[0];
    const recipient = f.payee.account.address;
    const signature = await sign(f, key, recipient);

    await viem.assertions.balancesHaveChanged(f.asRelayer.escrow.write.claim([key.claimSigner, recipient, signature, await verify(f, key.claimSigner, recipient)]), [
      { address: recipient, amount: 0n },
    ]); // native MON: the payee spends no gas
    assert.equal(await f.ausd.read.balanceOf([recipient]), usd(100));

    const [, , status] = await f.escrow.read.getClaim([key.claimSigner]);
    assert.equal(status, CLAIMED);
  });

  it("emits Claimed", async () => {
    const f = await networkHelpers.loadFixture(deployWithBatch);
    const key = f.batch.keys[1];
    const recipient = f.payee.account.address;
    await viem.assertions.emitWithArgs(
      f.asRelayer.escrow.write.claim([key.claimSigner, recipient, await sign(f, key, recipient), await verify(f, key.claimSigner, recipient)]),
      f.escrow,
      "Claimed",
      [getAddress(key.claimSigner), getAddress(recipient), usd(50)],
    );
  });

  it("rejects a wrong key, a swapped recipient, and a second attempt", async () => {
    const f = await networkHelpers.loadFixture(deployWithBatch);
    const [key, otherKey] = f.batch.keys;
    const recipient = f.payee.account.address;
    const attacker = f.stranger.account.address;
    const claim = f.asRelayer.escrow.write.claim;

    // Signed by another row's key.
    await viem.assertions.revertWithCustomError(claim([key.claimSigner, recipient, await sign(f, otherKey, recipient), await verify(f, key.claimSigner, recipient)]), f.escrow, "BadSignature");
    // Valid signature for the payee, but a front-runner swaps in their own address.
    const signature = await sign(f, key, recipient);
    await viem.assertions.revertWithCustomError(claim([key.claimSigner, attacker, signature, await verify(f, key.claimSigner, attacker)]), f.escrow, "BadSignature");
    // Garbage signature bytes.
    await viem.assertions.revertWithCustomError(claim([key.claimSigner, recipient, "0x1234", await verify(f, key.claimSigner, recipient)]), f.escrow, "BadSignature");

    await claim([key.claimSigner, recipient, signature, await verify(f, key.claimSigner, recipient)]);
    await viem.assertions.revertWithCustomErrorWithArgs(claim([key.claimSigner, recipient, signature, await verify(f, key.claimSigner, recipient)]), f.escrow, "NotClaimable", [CLAIMED]);
  });

  it("rejects a signature made for another contract or chain", async () => {
    const f = await networkHelpers.loadFixture(deployWithBatch);
    const key = f.batch.keys[0];
    const recipient = f.payee.account.address;
    const claim = f.asRelayer.escrow.write.claim;

    const otherContract = await sign(f, key, recipient, { claimContract: f.treasury.address });
    await viem.assertions.revertWithCustomError(claim([key.claimSigner, recipient, otherContract, await verify(f, key.claimSigner, recipient)]), f.escrow, "BadSignature");

    const otherChain = await sign(f, key, recipient, { chainId: f.chainId === 1 ? 10143 : 1 });
    await viem.assertions.revertWithCustomError(claim([key.claimSigner, recipient, otherChain, await verify(f, key.claimSigner, recipient)]), f.escrow, "BadSignature");
  });

  it("rejects unknown claims and a zero recipient", async () => {
    const f = await networkHelpers.loadFixture(deployWithBatch);
    const unknown = generateClaimKey();
    const recipient = f.payee.account.address;
    await viem.assertions.revertWithCustomError(
      f.asRelayer.escrow.write.claim([unknown.claimSigner, recipient, await sign(f, unknown, recipient), await verify(f, unknown.claimSigner, recipient)]),
      f.escrow,
      "UnknownClaim",
    );
    const key = f.batch.keys[0];
    await viem.assertions.revertWithCustomError(
      f.asRelayer.escrow.write.claim([key.claimSigner, zeroAddress, await sign(f, key, zeroAddress), await verify(f, key.claimSigner, zeroAddress)]),
      f.escrow,
      "ZeroAddress",
    );
  });

  it("rejects a claim without a valid verifier co-signature", async () => {
    const f = await networkHelpers.loadFixture(deployWithBatch);
    const [key, otherKey] = f.batch.keys;
    const recipient = f.payee.account.address;
    const signature = await sign(f, key, recipient);
    const claim = f.asRelayer.escrow.write.claim;
    const bad = (verification: `0x${string}`) =>
      viem.assertions.revertWithCustomError(claim([key.claimSigner, recipient, signature, verification]), f.escrow, "BadVerification");

    // A leaked link alone: no co-signature, a garbage one, or one from a key that isn't the verifier.
    await bad("0x");
    await bad("0x1234");
    await bad(await verify(f, key.claimSigner, recipient, { verifierKey: generatePrivateKey() }));
    // The verifier approved someone else's claim, or this claim for a different recipient.
    await bad(await verify(f, otherKey.claimSigner, recipient));
    await bad(await verify(f, key.claimSigner, f.stranger.account.address));
    // A link-key signature can't stand in for the verifier's.
    await bad(signature);

    const [, , status] = await f.escrow.read.getClaim([key.claimSigner]);
    assert.equal(status, SENT);
  });

  it("the owner can rotate the verifier; old co-signatures stop working", async () => {
    const f = await networkHelpers.loadFixture(deployWithBatch);
    const key = f.batch.keys[0];
    const recipient = f.payee.account.address;
    const signature = await sign(f, key, recipient);
    const oldVerification = await verify(f, key.claimSigner, recipient);

    const newKey = generatePrivateKey();
    const newVerifier = privateKeyToAccount(newKey).address;
    await viem.assertions.revertWithCustomError(f.asRelayer.escrow.write.setVerifier([newVerifier]), f.escrow, "OwnableUnauthorizedAccount");
    await viem.assertions.revertWithCustomError(f.escrow.write.setVerifier([zeroAddress]), f.escrow, "ZeroAddress");
    await viem.assertions.emitWithArgs(f.escrow.write.setVerifier([newVerifier]), f.escrow, "VerifierChanged", [newVerifier]);

    const claim = f.asRelayer.escrow.write.claim;
    await viem.assertions.revertWithCustomError(claim([key.claimSigner, recipient, signature, oldVerification]), f.escrow, "BadVerification");
    await claim([key.claimSigner, recipient, signature, await verify(f, key.claimSigner, recipient, { verifierKey: newKey })]);
    assert.equal(await f.ausd.read.balanceOf([recipient]), usd(100));
  });

  it("refund fails before expiry, works after, and credits the platform", async () => {
    const f = await networkHelpers.loadFixture(deployWithBatch);
    const key = f.batch.keys[0];
    const platform = f.platform.account.address;
    const balanceBefore = await f.treasury.read.balanceOf([platform]);

    await viem.assertions.revertWithCustomError(f.asRelayer.escrow.write.refund([key.claimSigner]), f.escrow, "NotExpired");

    await networkHelpers.time.increase(TTL);
    await viem.assertions.emitWithArgs(f.asRelayer.escrow.write.refund([key.claimSigner]), f.escrow, "Refunded", [
      getAddress(key.claimSigner),
      getAddress(platform),
      usd(100),
    ]);

    assert.equal(await f.treasury.read.balanceOf([platform]), balanceBefore + usd(100));
    assert.equal(await f.ausd.read.balanceOf([f.treasury.address]), balanceBefore + usd(100));
    const [, , status] = await f.escrow.read.getClaim([key.claimSigner]);
    assert.equal(status, REFUNDED);

    // Refunded money can be withdrawn, and the claim link is dead.
    await f.asPlatform.treasury.write.withdraw([balanceBefore + usd(100)]);
    const recipient = f.payee.account.address;
    await viem.assertions.revertWithCustomErrorWithArgs(
      f.asRelayer.escrow.write.claim([key.claimSigner, recipient, await sign(f, key, recipient), await verify(f, key.claimSigner, recipient)]),
      f.escrow,
      "NotClaimable",
      [REFUNDED],
    );
    await viem.assertions.revertWithCustomErrorWithArgs(f.asRelayer.escrow.write.refund([key.claimSigner]), f.escrow, "NotClaimable", [REFUNDED]);
  });

  it("an expired claim can still be claimed until someone refunds it", async () => {
    const f = await networkHelpers.loadFixture(deployWithBatch);
    const key = f.batch.keys[2];
    const recipient = f.payee.account.address;
    await networkHelpers.time.increase(TTL * 2n);
    await f.asRelayer.escrow.write.claim([key.claimSigner, recipient, await sign(f, key, recipient), await verify(f, key.claimSigner, recipient)]);
    assert.equal(await f.ausd.read.balanceOf([recipient]), usd(25));
    await viem.assertions.revertWithCustomErrorWithArgs(f.asRelayer.escrow.write.refund([key.claimSigner]), f.escrow, "NotClaimable", [CLAIMED]);
  });
});
