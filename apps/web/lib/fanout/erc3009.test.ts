import { createWalletClient, encodeAbiParameters, hashTypedData, http, keccak256, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { authorizationTypedData, randomNonce, signAuthorization, type Authorization, type TokenDomain } from "./erc3009";
import { settleTypedData, signSettle } from "./usdc-settle";

const domain: TokenDomain = { name: "Agora Dollar", version: "1", chainId: 10143, verifyingContract: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" };
const payee = privateKeyToAccount(generatePrivateKey());
const friend = privateKeyToAccount(generatePrivateKey()).address;
const settleContract = "0xA1ac3cBe75697e4Ad7C5fF393EbC3AE9fa67DeC2";

const fields = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

const auth = (): Authorization => ({ from: payee.address, to: friend, value: 25_000_000n, validAfter: 0n, validBefore: 1_900_000_000n, nonce: randomNonce() });

describe("ERC-3009 authorizations", () => {
  it("signs TransferWithAuthorization exactly as ERC-3009 defines it", async () => {
    const a = auth();
    const signature = await signAuthorization(payee, "TransferWithAuthorization", domain, a);
    const standard = { domain, types: { TransferWithAuthorization: fields }, primaryType: "TransferWithAuthorization" as const, message: a };
    expect(hashTypedData(authorizationTypedData("TransferWithAuthorization", domain, a))).toBe(hashTypedData(standard));
    expect(await recoverTypedDataAddress({ ...standard, signature })).toBe(payee.address);
  });

  it("signs the same with a wallet client as with a local account", async () => {
    const a = auth();
    const wc = createWalletClient({ account: payee, transport: http("http://127.0.0.1:1") });
    expect(await signAuthorization(wc, "TransferWithAuthorization", domain, a)).toBe(await signAuthorization(payee, "TransferWithAuthorization", domain, a));
  });

  it("keeps the USDC settle signature unchanged: ReceiveWithAuthorization to the settle contract, nonce binding minOut", async () => {
    const s = { from: payee.address, value: 10_000_000n, validAfter: 0n, validBefore: 1_900_000_000n, salt: randomNonce(), minOut: 9_990_000n };
    const nonce = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }, { type: "uint256" }], [settleContract, s.salt, s.minOut]));
    const standard = {
      domain,
      types: { ReceiveWithAuthorization: fields },
      primaryType: "ReceiveWithAuthorization" as const,
      message: { from: s.from, to: settleContract, value: s.value, validAfter: s.validAfter, validBefore: s.validBefore, nonce },
    } as const;
    expect(hashTypedData(settleTypedData(domain, settleContract, s))).toBe(hashTypedData(standard));
    expect(await recoverTypedDataAddress({ ...standard, signature: await signSettle(payee, domain, settleContract, s) })).toBe(payee.address);
  });

  it("makes a fresh 32-byte nonce every time", () => {
    const [a, b] = [randomNonce(), randomNonce()];
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
