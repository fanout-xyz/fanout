import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { accountFromPrf } from "./passkey-account";

describe("accountFromPrf", () => {
  it("derives the standard first Ethereum account of the PRF's BIP-39 phrase", async () => {
    const prf = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
    const expected = mnemonicToAccount(entropyToMnemonic(prf, wordlist)); // m/44'/60'/0'/0/0
    const acct = accountFromPrf(prf.slice());
    expect(acct.address).toBe(expected.address);

    // It signs like a normal account, so claims, sends and the relayer need no changes.
    const sig = await acct.account.signMessage({ message: "fanout" });
    expect(sig).toBe(await expected.signMessage({ message: "fanout" }));
    acct.end();
  });

  it("gives the same account for the same passkey and a different one for another", () => {
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(2);
    expect(accountFromPrf(a.slice()).address).toBe(accountFromPrf(a.slice()).address);
    expect(accountFromPrf(a.slice()).address).not.toBe(accountFromPrf(b.slice()).address);
  });
});
