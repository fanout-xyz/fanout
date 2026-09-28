import { expect, it } from "vitest";
import { FANOUT_RESULT_CENTS, WIRE_RESULT_CENTS, afterFees } from "./fees";

it("derives the race amounts from the fee list", () => {
  expect(afterFees(0)).toBe(50_000);
  expect(afterFees(1)).toBe(47_500);
  expect(afterFees(2)).toBe(46_000);
  expect(WIRE_RESULT_CENTS).toBe(44_850); // $460.00 - 2.5% = $448.50
  expect(FANOUT_RESULT_CENTS).toBe(49_990);
});
