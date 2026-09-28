import { describe, expect, it } from "vitest";
import { formatUsd, parseUsd } from "./money";

describe("money", () => {
  it("formats base units as dollars", () => {
    expect(formatUsd(1_234_560_000n, 6)).toBe("$1,234.56");
    expect(formatUsd(0n, 6)).toBe("$0.00");
    expect(formatUsd(999n, 6)).toBe("$0.00"); // truncates sub-cent dust
    expect(formatUsd(5n, 0)).toBe("$5.00");
  });

  it("parses dollar strings into base units", () => {
    expect(parseUsd("1,234.56", 6)).toBe(1_234_560_000n);
    expect(parseUsd("$20", 6)).toBe(20_000_000n);
    expect(parseUsd(" 0.5 ", 6)).toBe(500_000n);
    expect(parseUsd("1.234", 6)).toBeNull();
    expect(parseUsd("-5", 6)).toBeNull();
    expect(parseUsd("abc", 6)).toBeNull();
    expect(parseUsd("", 6)).toBeNull();
  });
});
