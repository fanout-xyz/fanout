import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { concat, encodeAbiParameters, getAddress, keccak256, pad, toFunctionSelector, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { signCreateBatch, type CreateBatchAuthorization } from "../../apps/web/lib/fanout/batch-authorization.ts";
import { generateClaimKey, signClaim, signVerification, type ClaimKey } from "../../apps/web/lib/fanout/claim-keys.ts";
import { randomNonce } from "../../apps/web/lib/fanout/erc3009.ts";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();

const usd = (n: number) => BigInt(n) * 1_000_000n;
const MINUTE = 60n;
const DAY = 24n * 60n * MINUTE;
const FIRST_BATCH_ID = 1001n;
const SENT = 0;
const CLAIMED = 1;
const REFUNDED = 2;
const REFUND_EXPIRED = 1;
const CREATE_BATCH = 2;

// The report format the CRE workflows produce (cre/shared/report.ts): abi.encode(uint8 kind, bytes body).
const report = (kind: number, body: Hex) => encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [kind, body]);
const refundReport = (signers: readonly Address[]) =>
  report(REFUND_EXPIRED, encodeAbiParameters([{ type: "address[]" }], [[...signers]]));

const AUTH_TUPLE = {
  type: "tuple",
  components: [
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint256" },
    { name: "signature", type: "bytes" },
  ],
} as const;
function createBatchReport(a: CreateBatchAuthorization, signature: Hex) {
  const body = encodeAbiParameters(
    [{ type: "address" }, { type: "address[]" }, { type: "uint256[]" }, { type: "bytes32[]" }, { type: "uint64" }, AUTH_TUPLE],
    [a.platform, [...a.claimSigners], [...a.amounts], [...a.emailHashes], a.claimWindow, { nonce: a.nonce, deadline: a.deadline, signature }],
  );
  return report(CREATE_BATCH, body);
}

/** Forwarder metadata: workflowId (32) | workflowName (10) | workflowOwner (20) | reportId (2). */
const metadata = (workflowId: Hex, owner: Address) => concat([workflowId, pad("0x01", { size: 10 }), owner, "0x0001"]);
const NO_METADATA = "0x" as Hex;

async function deploy() {
  const [deployer, platform, forwarder, stranger, recipient, workflowOwner] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  const ausd = await viem.deployContract("MockAUSD3009");
  const treasury = await viem.deployContract("Treasury", [ausd.address]);
  const verifierKey = generatePrivateKey();
  const escrow = await viem.deployContract("ClaimEscrow", [ausd.address, treasury.address, privateKeyToAccount(verifierKey).address]);
  const batchPayout = await viem.deployContract("BatchPayout", [treasury.address, escrow.address, FIRST_BATCH_ID]);
  await treasury.write.wire([batchPayout.address, escrow.address]);
  await escrow.write.wire([batchPayout.address]);
  const keeper = await viem.deployContract("FanoutKeeper", [escrow.address, batchPayout.address, forwarder.account.address]);

  const asPlatform = {
    ausd: await viem.getContractAt("MockAUSD3009", ausd.address, { client: { wallet: platform } }),
    treasury: await viem.getContractAt("Treasury", treasury.address, { client: { wallet: platform } }),
    batchPayout: await viem.getContractAt("BatchPayout", batchPayout.address, { client: { wallet: platform } }),
  };
  const asForwarder = await viem.getContractAt("FanoutKeeper", keeper.address, { client: { wallet: forwarder } });
  const asStranger = await viem.getContractAt("FanoutKeeper", keeper.address, { client: { wallet: stranger } });
  const escrowAsRecipient = await viem.getContractAt("ClaimEscrow", escrow.address, { client: { wallet: recipient } });

  await ausd.write.mint([platform.account.address, usd(10_000)]);
  await asPlatform.ausd.write.approve([treasury.address, usd(10_000)]);
  await asPlatform.treasury.write.deposit([usd(1_000)]);

  return {
    deployer, platform, forwarder, stranger, recipient, workflowOwner, chainId, verifierKey,
    ausd, treasury, escrow, batchPayout, keeper, asPlatform, asForwarder, asStranger, escrowAsRecipient,
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

async function claimRow(f: Fixture, key: ClaimKey) {
  const recipient = f.recipient.account.address;
  const message = { recipient, claimContract: f.escrow.address, chainId: f.chainId };
  const signature = await signClaim(key.privateKey, message);
  const verification = await signVerification(f.verifierKey, { ...message, claimSigner: key.claimSigner });
  return f.escrowAsRecipient.write.claim([key.claimSigner, recipient, signature, verification]);
}

const statusOf = async (f: Fixture, s: Address) => (await f.escrow.read.claims([s]))[2];

describe("FanoutKeeper", () => {
  it("is a CRE receiver (ERC-165)", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    // IReceiver's only own function is onReport, so its interface id is that selector.
    const iReceiver = toFunctionSelector("onReport(bytes,bytes)");
    assert.equal(await f.keeper.read.supportsInterface([iReceiver]), true);
    assert.equal(await f.keeper.read.supportsInterface(["0x01ffc9a7"]), true);
    assert.equal(await f.keeper.read.supportsInterface(["0xffffffff"]), false);
  });

  it("only the configured forwarder can deliver a report", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomErrorWithArgs(
      f.asStranger.write.onReport([NO_METADATA, refundReport([])]),
      f.keeper,
      "InvalidSender",
      [getAddress(f.stranger.account.address)],
    );
    await f.asForwarder.write.onReport([NO_METADATA, refundReport([])]);

    // The owner can move it to another forwarder (simulation to production); the old one is then refused.
    await viem.assertions.revertWithCustomError(f.asStranger.write.setForwarder([f.stranger.account.address]), f.keeper, "OwnableUnauthorizedAccount");
    await viem.assertions.revertWithCustomError(f.keeper.write.setForwarder(["0x0000000000000000000000000000000000000000"]), f.keeper, "ZeroAddress");
    await f.keeper.write.setForwarder([f.stranger.account.address]);
    await viem.assertions.revertWithCustomError(f.asForwarder.write.onReport([NO_METADATA, refundReport([])]), f.keeper, "InvalidSender");
    await f.asStranger.write.onReport([NO_METADATA, refundReport([])]);
  });

  it("refunds the decoded claim signers through ClaimEscrow.refundMany, to the paying platform", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const short = rows([usd(10), usd(20), usd(30)]);
    const long = rows([usd(40)]);
    await f.asPlatform.batchPayout.write.createBatch([short.signers, short.amounts, short.emailHashes, 5n * MINUTE]);
    await f.asPlatform.batchPayout.write.createBatch([long.signers, long.amounts, long.emailHashes, DAY]);
    await claimRow(f, short.keys[0]);
    await networkHelpers.time.increase(5n * MINUTE);

    // Claimed, two expired, one not expired yet, and one unknown signer: only the two expired rows move.
    const list = [...short.signers, ...long.signers, generateClaimKey().claimSigner];
    const hash = await f.asForwarder.write.onReport([NO_METADATA, refundReport(list)]);
    await viem.assertions.emitWithArgs(Promise.resolve(hash), f.keeper, "ExpiredRefunded", [5n, 2n]);
    await viem.assertions.emitWithArgs(Promise.resolve(hash), f.escrow, "Refunded", [getAddress(short.signers[1]), getAddress(f.platform.account.address), usd(20)]);

    assert.deepEqual(await Promise.all(list.slice(0, 4).map((s) => statusOf(f, s))), [CLAIMED, REFUNDED, REFUNDED, SENT]);
    assert.equal(await f.treasury.read.balanceOf([f.platform.account.address]), usd(1_000) - usd(10) - usd(40));
    assert.equal(await f.ausd.read.balanceOf([f.keeper.address]), 0n);

    // Delivered again (a retry, or the next run before the indexer catches up): a no-op, not a revert.
    const again = await f.asForwarder.write.onReport([NO_METADATA, refundReport(list)]);
    await viem.assertions.emitWithArgs(Promise.resolve(again), f.keeper, "ExpiredRefunded", [5n, 0n]);
  });

  it("skips rows whose claim window hasn't passed", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const r = rows([usd(10), usd(20)]);
    await f.asPlatform.batchPayout.write.createBatch([r.signers, r.amounts, r.emailHashes, DAY]);
    await networkHelpers.time.increase(DAY - 10n);
    const hash = await f.asForwarder.write.onReport([NO_METADATA, refundReport(r.signers)]);
    await viem.assertions.emitWithArgs(Promise.resolve(hash), f.keeper, "ExpiredRefunded", [2n, 0n]);
    assert.deepEqual(await Promise.all(r.signers.map((s) => statusOf(f, s))), [SENT, SENT]);
    assert.equal(await f.treasury.read.balanceOf([f.platform.account.address]), usd(1_000) - usd(30));
  });

  it("rejects malformed reports", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(f.asForwarder.write.onReport([NO_METADATA, "0x"]), f.keeper, "EmptyReport");
    // Not abi.encode(uint8, bytes): the decoder reverts.
    await viem.assertions.revert(f.asForwarder.write.onReport([NO_METADATA, "0xdeadbeef"]));
    await viem.assertions.revert(
      f.asForwarder.write.onReport([NO_METADATA, report(REFUND_EXPIRED, "0x1234")]),
    );
    // A kind byte out of uint8 range.
    await viem.assertions.revert(
      f.asForwarder.write.onReport([NO_METADATA, encodeAbiParameters([{ type: "uint256" }, { type: "bytes" }], [256n, "0x"])]),
    );
    await viem.assertions.revertWithCustomErrorWithArgs(
      f.asForwarder.write.onReport([NO_METADATA, report(7, "0x")]),
      f.keeper,
      "UnknownReportKind",
      [7],
    );
    // CREATE_BATCH whose body is a refund list.
    await viem.assertions.revert(
      f.asForwarder.write.onReport([NO_METADATA, report(CREATE_BATCH, encodeAbiParameters([{ type: "address[]" }], [[f.platform.account.address]]))]),
    );
  });

  it("creates a scheduled payout from the platform's pre-signed CreateBatch authorization", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    // Signed ahead of time with a deadline days away; the keeper submits it when it's due.
    const r = rows([usd(5), usd(7)]);
    const auth: CreateBatchAuthorization = {
      platform: f.platform.account.address,
      claimSigners: r.signers,
      amounts: r.amounts,
      emailHashes: r.emailHashes,
      claimWindow: DAY,
      nonce: randomNonce(),
      deadline: (await now()) + 7n * DAY,
    };
    const signature = await signCreateBatch(f.platform, f.batchPayout.address, f.chainId, auth);

    const hash = await f.asForwarder.write.onReport([NO_METADATA, createBatchReport(auth, signature)]);
    await viem.assertions.emitWithArgs(Promise.resolve(hash), f.keeper, "ScheduledBatchCreated", [getAddress(f.platform.account.address), auth.nonce, FIRST_BATCH_ID]);
    const [platform, , total, signers] = await f.batchPayout.read.getBatch([FIRST_BATCH_ID]);
    assert.equal(platform, getAddress(f.platform.account.address));
    assert.equal(total, usd(12));
    assert.deepEqual(signers, r.signers.map((s) => getAddress(s)));
    assert.equal(await f.treasury.read.balanceOf([f.platform.account.address]), usd(1_000) - usd(12));

    // Each authorization works once, so a repeated delivery can't pay twice.
    await viem.assertions.revertWithCustomError(
      f.asForwarder.write.onReport([NO_METADATA, createBatchReport(auth, signature)]),
      f.batchPayout,
      "AuthorizationAlreadyUsed",
    );
    // BatchPayout's checks still apply: a changed amount breaks the signature.
    const tampered = { ...auth, nonce: randomNonce(), amounts: [usd(500), usd(7)] };
    const other = await signCreateBatch(f.platform, f.batchPayout.address, f.chainId, { ...tampered, amounts: auth.amounts });
    await viem.assertions.revertWithCustomError(
      f.asForwarder.write.onReport([NO_METADATA, createBatchReport(tampered, other)]),
      f.batchPayout,
      "BadAuthorization",
    );
    // And so does the deadline.
    const late = { ...auth, nonce: randomNonce(), deadline: (await now()) + 60n };
    const lateSig = await signCreateBatch(f.platform, f.batchPayout.address, f.chainId, late);
    await networkHelpers.time.increase(120n);
    await viem.assertions.revertWithCustomError(
      f.asForwarder.write.onReport([NO_METADATA, createBatchReport(late, lateSig)]),
      f.batchPayout,
      "AuthorizationExpired",
    );
  });

  it("once configured, accepts only the expected workflow owner and workflow ids", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const owner = getAddress(f.workflowOwner.account.address);
    const refundId = keccak256(toHex("refund-expired"));
    const scheduleId = keccak256(toHex("scheduled-payouts"));
    const empty = refundReport([]);

    await viem.assertions.revertWithCustomError(f.asStranger.write.setExpectedWorkflowOwner([owner]), f.keeper, "OwnableUnauthorizedAccount");
    await viem.assertions.revertWithCustomError(f.asStranger.write.setWorkflowIdAllowed([refundId, true]), f.keeper, "OwnableUnauthorizedAccount");
    await f.keeper.write.setExpectedWorkflowOwner([owner]);

    await viem.assertions.revertWithCustomErrorWithArgs(f.asForwarder.write.onReport([NO_METADATA, empty]), f.keeper, "MetadataTooShort", [0n]);
    await viem.assertions.revertWithCustomErrorWithArgs(
      f.asForwarder.write.onReport([metadata(refundId, getAddress(f.stranger.account.address)), empty]),
      f.keeper,
      "InvalidWorkflowOwner",
      [getAddress(f.stranger.account.address)],
    );
    await f.asForwarder.write.onReport([metadata(refundId, owner), empty]);
    // The 62-byte form some tooling sends works too.
    await f.asForwarder.write.onReport([concat([refundId, pad("0x01", { size: 10 }), owner]), empty]);

    await f.keeper.write.setWorkflowIdAllowed([refundId, true]);
    await f.keeper.write.setWorkflowIdAllowed([scheduleId, true]);
    assert.equal(await f.keeper.read.allowedWorkflowCount(), 2n);
    await f.asForwarder.write.onReport([metadata(scheduleId, owner), empty]);
    const unknownId = keccak256(toHex("other"));
    await viem.assertions.revertWithCustomErrorWithArgs(
      f.asForwarder.write.onReport([metadata(unknownId, owner), empty]),
      f.keeper,
      "InvalidWorkflowId",
      [unknownId],
    );

    await f.keeper.write.setWorkflowIdAllowed([scheduleId, false]);
    await f.keeper.write.setWorkflowIdAllowed([scheduleId, false]);
    assert.equal(await f.keeper.read.allowedWorkflowCount(), 1n);
    await viem.assertions.revertWithCustomError(f.asForwarder.write.onReport([metadata(scheduleId, owner), empty]), f.keeper, "InvalidWorkflowId");

    // Turning both checks off again (simulation: the mock forwarder sends no metadata).
    await f.keeper.write.setWorkflowIdAllowed([refundId, false]);
    await f.keeper.write.setExpectedWorkflowOwner(["0x0000000000000000000000000000000000000000"]);
    await f.asForwarder.write.onReport([NO_METADATA, empty]);
  });

  it("rejects zero addresses at deploy", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const zero = "0x0000000000000000000000000000000000000000";
    await viem.assertions.revertWithCustomError(viem.deployContract("FanoutKeeper", [zero, f.batchPayout.address, f.forwarder.account.address]), f.keeper, "ZeroAddress");
    await viem.assertions.revertWithCustomError(viem.deployContract("FanoutKeeper", [f.escrow.address, f.batchPayout.address, zero]), f.keeper, "ZeroAddress");
  });
});
