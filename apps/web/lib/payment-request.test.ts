import { describe, expect, it } from "vitest";
import { cleanRequestNote, parsePaymentRequest, payLink, requestFromParams, walletBase } from "./payment-request";

const to = "0x7D50A711cdCE73c9575Ce24B444f93bC0485a850";
const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";

describe("payLink", () => {
  it("puts who, how much and what for in the link", () => {
    const link = payLink("https://wallet.fanout.tech", { to, amount: 20_500_000n, note: "Lunch on Friday" });
    expect(link).toBe(`https://wallet.fanout.tech/pay?to=${to}&amount=20.50&note=Lunch+on+Friday`);
  });

  it("leaves out an empty amount and a note that carries a link", () => {
    expect(payLink("https://wallet.fanout.tech", { to, amount: 0n, note: "see https://evil.example" })).toBe(
      `https://wallet.fanout.tech/pay?to=${to}`,
    );
  });

  it("round-trips through the parser", () => {
    const link = payLink("https://wallet.fanout.tech", { to, amount: 1_234_560_000n, note: "Rent" });
    expect(parsePaymentRequest(link)).toEqual({ to, amount: 1_234_560_000n, note: "Rent" });
  });
});

describe("walletBase", () => {
  it("sends every fanout.tech page's links to wallet.fanout.tech", () => {
    expect(walletBase({ hostname: "demo.fanout.tech", origin: "https://demo.fanout.tech" })).toBe("https://wallet.fanout.tech");
    expect(walletBase({ hostname: "localhost", origin: "http://localhost:3000" })).toBe("http://localhost:3000");
  });
});

describe("parsePaymentRequest", () => {
  it("reads a plain address, checksummed", () => {
    expect(parsePaymentRequest(`  ${to.toLowerCase()} `)).toEqual({ to });
  });

  it("reads ethereum: URIs, including an AUSD transfer with an amount", () => {
    expect(parsePaymentRequest(`ethereum:${to}@10143`)).toEqual({ to });
    expect(parsePaymentRequest(`ethereum:${AUSD}@10143/transfer?address=${to}&uint256=5000000`)).toEqual({ to, amount: 5_000_000n });
  });

  it("refuses transfers of other tokens, so nobody pays the wrong currency by accident", () => {
    expect(parsePaymentRequest(`ethereum:0x0000000000000000000000000000000000000001/transfer?address=${to}&uint256=5`)).toBeNull();
  });

  it("refuses things that aren't payment requests", () => {
    for (const text of ["", "hello", "0x123", `https://wallet.fanout.tech/balance?to=${to}`, "javascript:alert(1)", `https://x.test/pay?to=0x${"0".repeat(40)}`]) {
      expect(parsePaymentRequest(text)).toBeNull();
    }
  });
});

describe("requestFromParams", () => {
  it("ignores a bad amount but keeps the rest", () => {
    expect(requestFromParams(new URLSearchParams({ to, amount: "abc", note: "Tea" }))).toEqual({ to, note: "Tea" });
  });

  it("needs a valid address", () => {
    expect(requestFromParams(new URLSearchParams({ amount: "5" }))).toBeNull();
  });
});

describe("cleanRequestNote", () => {
  it("keeps notes short and on one line", () => {
    expect(cleanRequestNote("  For\n the  taxi  ")).toBe("For the taxi");
    expect(cleanRequestNote("x".repeat(200))).toHaveLength(80);
  });
});
