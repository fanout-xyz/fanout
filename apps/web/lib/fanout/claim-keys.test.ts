import { describe, expect, it } from "vitest";
import {
  buildClaimLink,
  generateClaimKey,
  parseClaimFragment,
  recoverClaimSigner,
  signClaim,
} from "./claim-keys";

const recipient = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const claimContract = "0x3333333333333333333333333333333333333333";

describe("claim keys", () => {
  it("round-trips a key through the link fragment", () => {
    const { privateKey } = generateClaimKey();
    const link = buildClaimLink("https://fanout.test", privateKey);
    expect(link.startsWith("https://fanout.test/claim#k=")).toBe(true);
    expect(parseClaimFragment(new URL(link).hash)).toBe(privateKey);
  });

  it("rejects malformed fragments", () => {
    expect(parseClaimFragment("")).toBeNull();
    expect(parseClaimFragment("#k=zz")).toBeNull();
    expect(parseClaimFragment("#k=1234")).toBeNull();
  });

  it("signature recovers to the claim signer only for the signed message", async () => {
    const { privateKey, claimSigner } = generateClaimKey();
    const msg = { recipient, claimContract, chainId: 10143 } as const;
    const sig = await signClaim(privateKey, msg);
    expect(await recoverClaimSigner(msg, sig)).toBe(claimSigner);
    // Swapped recipient (front-run) or other chain (replay) recovers someone else.
    expect(await recoverClaimSigner({ ...msg, recipient: other }, sig)).not.toBe(claimSigner);
    expect(await recoverClaimSigner({ ...msg, chainId: 1 }, sig)).not.toBe(claimSigner);
  });
});
