import { describe, expect, it } from "vitest";
import { AiInvalid } from "@/lib/ai/validate";
import { demoRiskExplanation, riskExplanationSchema, validRiskRequest, type RiskFacts } from "./risk-ai";

const reasons: RiskFacts = [
  { kind: "total-high", facts: { total_usd: 4000, usual_total_usd: 1000, times: 4 } },
  { kind: "new-payee-large", facts: { new_large_count: 1, largest_usd: 900.5, usual_per_person_usd: 100 } },
];

describe("validRiskRequest", () => {
  it("accepts rule names with numbers", () => {
    expect(validRiskRequest({ reasons })).toEqual(reasons);
  });

  it("refuses unknown rules, text facts and too many reasons", () => {
    expect(validRiskRequest({ reasons: [{ kind: "made-up", facts: {} }] })).toBeNull();
    expect(validRiskRequest({ reasons: [{ kind: "total-high", facts: { email: "a@x.com" } }] })).toBeNull();
    expect(validRiskRequest({ reasons: Array(6).fill(reasons[0]) })).toBeNull();
    expect(validRiskRequest({ reasons: [] })).toBeNull();
  });
});

describe("riskExplanationSchema", () => {
  const schema = riskExplanationSchema(reasons);

  it("accepts wording that only uses the given numbers", () => {
    const text = "At $4,000 this is four times your usual $1,000 payout, and one new person gets $901. Check it's the right file.";
    expect(schema({ explanation: text }, "")).toEqual({ explanation: text });
  });

  it("refuses invented dollar amounts, links and empty answers", () => {
    expect(() => schema({ explanation: "This is $5,000 more than usual, so check the file." }, "")).toThrow(AiInvalid);
    expect(() => schema({ explanation: "Learn more at https://example.com about this." }, "")).toThrow(AiInvalid);
    expect(() => schema({ explanation: "" }, "")).toThrow(AiInvalid);
    expect(() => schema({ text: "missing field" }, "")).toThrow(AiInvalid);
  });

  it("passes the demo wording", () => {
    expect(() => schema(demoRiskExplanation(reasons), "")).not.toThrow();
  });
});
