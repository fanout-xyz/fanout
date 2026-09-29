import { describe, expect, it } from "vitest";
import { checkSend, shortAddress } from "./send-validation";

const D = 6;
const bal = 100_000_000n; // $100.00
const me = "0x1111111111111111111111111111111111111111";
const friend = "0x52908400098527886E0F7030069857D2E4169EE7"; // valid EIP-55 checksum

describe("checkSend", () => {
  it("accepts a valid send and checksums the address", () => {
    const r = checkSend({ amount: "25.50", to: friend.toLowerCase() }, bal, me, D);
    expect(r).toEqual({ ok: true, amount: 25_500_000n, to: friend });
  });

  it("allows sending the whole balance", () => {
    expect(checkSend({ amount: "$100", to: friend }, bal, me, D).ok).toBe(true);
  });

  it("rejects bad amounts", () => {
    const e = (amount: string) => (checkSend({ amount, to: friend }, bal, me, D) as { errors: { amount?: string } }).errors.amount;
    expect(e("")).toMatch(/how much/);
    expect(e("abc")).toMatch(/in dollars/);
    expect(e("0")).toMatch(/more than \$0.00/);
    expect(e("100.01")).toMatch(/You have \$100.00/);
  });

  it("rejects bad addresses, checksum typos, zero and self", () => {
    const e = (to: string) => (checkSend({ amount: "1", to }, bal, me, D) as { errors: { to?: string } }).errors.to;
    expect(e("")).toMatch(/Paste/);
    expect(e("0x123")).toMatch(/42 characters/);
    expect(e("0x52908400098527886E0F7030069857D2E4169Ee7")).toMatch(/typo/); // one letter's case flipped
    expect(e("0x0000000000000000000000000000000000000000")).toMatch(/can't receive/);
    expect(e(me)).toMatch(/your own account/);
  });

  it("shortens addresses", () => {
    expect(shortAddress(friend)).toBe("0x5290…9EE7");
    expect(shortAddress(friend.toLowerCase())).toBe("0x5290…9EE7");
  });
});
