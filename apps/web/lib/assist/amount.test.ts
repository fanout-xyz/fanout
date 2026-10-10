import { describe, expect, it } from "vitest";
import { detectCurrency, readAmount } from "./amount";

const value = (raw: string, sep?: "." | ",") => {
  const r = readAmount(raw, sep);
  return r.ok ? r.value : `!${r.reason}`;
};

describe("readAmount", () => {
  it("reads plain and formatted dollar amounts", () => {
    expect(value("20")).toBe("20.00");
    expect(value("$1,200.00")).toBe("1200.00");
    expect(value("1200.5")).toBe("1200.50");
    expect(value(" US$ 45 ")).toBe("45.00");
    expect(value("USD 1,234,567.89")).toBe("1234567.89");
    expect(value("45 dollars")).toBe("45.00");
  });

  it("reads k and m suffixes exactly", () => {
    expect(value("1.2k")).toBe("1200.00");
    expect(value("$3K")).toBe("3000.00");
    expect(value("2.5m")).toBe("2500000.00");
    expect(value("1.2345k")).toBe("1234.50");
    expect(value("1.23456k")).toBe("1234.56");
    expect(value("1.234567k")).toBe("!too-precise");
  });

  it("reads comma decimals and space thousands", () => {
    expect(value("1 200,50")).toBe("1200.50");
    expect(value("1.234,50")).toBe("1234.50");
    expect(value("12,5")).toBe("12.50");
    expect(value("1 200,00")).toBe("1200.00");
    expect(value("50,-")).toBe("50.00");
  });

  it("uses the file's decimal separator for ambiguous values", () => {
    expect(value("1,200")).toBe("1200.00");
    expect(value("1,200", ",")).toBe("1.20");
    expect(value("1.200", ",")).toBe("1200.00");
  });

  it("refuses negatives, empties, words and sub-cent amounts", () => {
    expect(value("")).toBe("!empty");
    expect(value("-5")).toBe("!negative");
    expect(value("(12.00)")).toBe("!negative");
    expect(value("twelve")).toBe("!unreadable");
    expect(value("12.345")).toBe("!too-precise");
    expect(value("1,2,3")).toBe("!unreadable");
  });

  it("flags other currencies without converting them", () => {
    expect(readAmount("€30")).toEqual({ ok: false, reason: "currency", currency: "EUR", value: "30.00" });
    expect(readAmount("R$ 1.200,00")).toMatchObject({ ok: false, reason: "currency", currency: "BRL", value: "1200.00" });
    expect(readAmount("£12")).toMatchObject({ reason: "currency", currency: "GBP" });
    expect(readAmount("₦5,000")).toMatchObject({ reason: "currency", currency: "NGN" });
    expect(readAmount("CA$20")).toMatchObject({ reason: "currency", currency: "CAD" });
  });
});

describe("detectCurrency", () => {
  it("treats a bare $ as dollars", () => {
    expect(detectCurrency("$5")).toBe("USD");
    expect(detectCurrency("5")).toBeNull();
    expect(detectCurrency("5 EUR")).toBe("EUR");
    expect(detectCurrency("1000 JPY")).toBe("JPY");
  });
});
