import { describe, expect, it } from "vitest";
import { formatLocal, guessLocalCurrency, isLocalCurrency, rateAgeLabel } from "./fx";

describe("fx", () => {
  it("guesses the currency from the time zone first", () => {
    expect(guessLocalCurrency("Africa/Lagos", ["en-US"])).toBe("NGN");
    expect(guessLocalCurrency("Asia/Karachi", ["en-US"])).toBe("PKR");
    expect(guessLocalCurrency("Asia/Dhaka", [])).toBe("BDT");
    expect(guessLocalCurrency("Europe/Berlin", ["de-DE"])).toBe("EUR");
  });

  it("falls back to the language region, and to nothing for US dollars", () => {
    expect(guessLocalCurrency("Etc/UTC", ["en-NG", "en"])).toBe("NGN");
    expect(guessLocalCurrency(undefined, ["en", "fil-PH"])).toBe("PHP");
    expect(guessLocalCurrency("America/New_York", ["en-US"])).toBeNull();
    expect(guessLocalCurrency(undefined, ["not a tag"])).toBeNull();
  });

  it("formats local amounts: whole units when large, cents when small", () => {
    expect(formatLocal(5_000, 1480, "NGN")).toBe("₦74,000");
    expect(formatLocal(5_000, 0.86, "EUR")).toBe("€43.00");
    expect(formatLocal(1_234, 278.4, "PKR")).toMatch(/^Rs\s?3,435$/);
  });

  it("checks currency codes", () => {
    expect(isLocalCurrency("NGN")).toBe(true);
    expect(isLocalCurrency("USD")).toBe(false);
    expect(isLocalCurrency(null)).toBe(false);
  });

  it("labels how fresh the rate is", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(rateAgeLabel("2026-10-01T00:02:31Z", now)).toBe("at today's rate");
    expect(rateAgeLabel("2026-09-28T00:00:00Z", now)).toBe("at the rate on Sep 28");
    expect(rateAgeLabel("garbage", now)).toBe("at the latest rate");
  });
});
