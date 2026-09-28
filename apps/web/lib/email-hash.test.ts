import { keccak256, toBytes } from "viem";
import { expect, it } from "vitest";
import { hashEmail } from "./email-hash";

it("hashes the lowercased, trimmed email", () => {
  expect(hashEmail("  Ana@Example.COM ")).toBe(keccak256(toBytes("ana@example.com")));
});
