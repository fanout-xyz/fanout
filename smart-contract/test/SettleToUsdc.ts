import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Same signing code the web app uses, so the contract is tested against the real client.
import { randomSalt, signSettle, type SettleAuthorization, type TokenDomain } from "../../apps/web/lib/fanout/usdc-settle.ts";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();

const usd = (n: number) => BigInt(n) * 1_000_000n;
/** 1 AUSD (6 decimals) is 1 USDC (18 decimals) on the pair. */
const asUsdc = (ausdAmount: bigint) => ausdAmount * 10n ** 12n;

async function deploy() {
  const [, relayer, stranger] = await viem.getWalletClients();
  const payee = privateKeyToAccount(generatePrivateKey());
  const chainId = await publicClient.getChainId();

  const ausd = await viem.deployContract("MockAUSD3009");
  const usdc = await viem.deployContract("MockUSDC");
  const pair = await viem.deployContract("MockStableSwapPair", [ausd.address, usdc.address]);
  const settle = await viem.deployContract("SettleToUsdc", [ausd.address, usdc.address, pair.address]);
  await pair.write.setApprovedSwapper([settle.address]);

  await usdc.write.mint([pair.address, asUsdc(usd(1_000_000))]);
  await ausd.write.mint([payee.address, usd(500)]);

  const asRelayer = await viem.getContractAt("SettleToUsdc", settle.address, { client: { wallet: relayer } });
  const domain: TokenDomain = { name: "Agora Dollar", version: "1", chainId, verifyingContract: ausd.address };
  return { relayer, stranger, payee, ausd, usdc, pair, settle, asRelayer, domain };
}

type Fixture = Awaited<ReturnType<typeof deploy>>;

async function authorize(f: Fixture, overrides: Partial<SettleAuthorization> = {}) {
  const now = BigInt((await publicClient.getBlock()).timestamp);
  const auth: SettleAuthorization = {
    from: f.payee.address,
    value: usd(100),
    validAfter: 0n,
    validBefore: now + 600n,
    salt: randomSalt(),
    minOut: asUsdc(usd(100)),
    ...overrides,
  };
  const signature = await signSettle(f.payee, f.domain, f.settle.address, auth);
  return { auth, signature };
}

const args = (a: SettleAuthorization, signature: `0x${string}`, overrides: { from?: Address; minOut?: bigint } = {}) =>
  [overrides.from ?? a.from, a.value, a.validAfter, a.validBefore, a.salt, overrides.minOut ?? a.minOut, signature] as const;

describe("SettleToUsdc", () => {
  it("swaps the payee's AUSD to USDC, paid to the payee, with the relayer paying gas", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { auth, signature } = await authorize(f);

    await viem.assertions.emitWithArgs(f.asRelayer.write.settle(args(auth, signature)), f.settle, "SettledToUsdc", [
      getAddress(f.payee.address),
      usd(100),
      asUsdc(usd(100)),
    ]);

    assert.equal(await f.ausd.read.balanceOf([f.payee.address]), usd(400));
    assert.equal(await f.usdc.read.balanceOf([f.payee.address]), asUsdc(usd(100)));
    // Nothing stays behind or goes to whoever submitted it.
    assert.equal(await f.ausd.read.balanceOf([f.settle.address]), 0n);
    assert.equal(await f.usdc.read.balanceOf([f.settle.address]), 0n);
    assert.equal(await f.usdc.read.balanceOf([f.relayer.account.address]), 0n);
  });

  it("only ever pays the signer: naming another `from` fails the signature check", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { auth, signature } = await authorize(f);
    await f.ausd.write.mint([f.stranger.account.address, usd(100)]);

    await viem.assertions.revertWithCustomError(
      f.asRelayer.write.settle(args(auth, signature, { from: f.stranger.account.address })),
      f.ausd,
      "InvalidSignature",
    );
    assert.equal(await f.usdc.read.balanceOf([f.stranger.account.address]), 0n);
  });

  it("rejects a lowered minimum: the signature binds minOut through the nonce", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { auth, signature } = await authorize(f);

    await viem.assertions.revertWithCustomError(f.asRelayer.write.settle(args(auth, signature, { minOut: 0n })), f.ausd, "InvalidSignature");
    assert.equal(await f.ausd.read.balanceOf([f.payee.address]), usd(500));
  });

  it("reverts, moving nothing, when the pair would pay less than the signed minimum", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { auth, signature } = await authorize(f, { minOut: asUsdc(usd(100)) + 1n });

    await viem.assertions.revertWithCustomError(f.asRelayer.write.settle(args(auth, signature)), f.pair, "InsufficientOutputAmount");
    assert.equal(await f.ausd.read.balanceOf([f.payee.address]), usd(500));
  });

  it("rejects an expired authorization", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { auth, signature } = await authorize(f);
    await networkHelpers.time.increase(601);

    await viem.assertions.revertWithCustomError(f.asRelayer.write.settle(args(auth, signature)), f.ausd, "AuthorizationExpired");
  });

  it("can't be replayed", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { auth, signature } = await authorize(f);
    await f.asRelayer.write.settle(args(auth, signature));

    await viem.assertions.revertWithCustomError(f.asRelayer.write.settle(args(auth, signature)), f.ausd, "UsedOrCanceledAuthorization");
    assert.equal(await f.ausd.read.balanceOf([f.payee.address]), usd(400));
  });

  it("fails while the contract lacks the pair's APPROVED_SWAPPER role", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const unapproved = await viem.deployContract("SettleToUsdc", [f.ausd.address, f.usdc.address, f.pair.address]);
    assert.equal(await f.pair.read.hasRole(["APPROVED_SWAPPER", unapproved.address]), false);

    const now = BigInt((await publicClient.getBlock()).timestamp);
    const auth: SettleAuthorization = { from: f.payee.address, value: usd(10), validAfter: 0n, validBefore: now + 600n, salt: randomSalt(), minOut: 0n };
    const signature = await signSettle(f.payee, f.domain, unapproved.address, auth);

    await viem.assertions.revertWithCustomError(unapproved.write.settle(args(auth, signature)), f.pair, "AddressIsNotRole");
    assert.equal(await f.ausd.read.balanceOf([f.payee.address]), usd(500));
  });

  it("rejects zero amounts and empty addresses", async () => {
    const f = await networkHelpers.loadFixture(deploy);
    const { auth, signature } = await authorize(f, { value: 0n });
    await viem.assertions.revertWithCustomError(f.asRelayer.write.settle(args(auth, signature)), f.settle, "ZeroAmount");
    await viem.assertions.revertWithCustomError(
      viem.deployContract("SettleToUsdc", [f.ausd.address, f.usdc.address, "0x0000000000000000000000000000000000000000"]),
      f.settle,
      "ZeroAddress",
    );
  });
});
