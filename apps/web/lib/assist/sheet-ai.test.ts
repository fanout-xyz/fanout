import { describe, expect, it } from "vitest";
import { AiInvalid } from "@/lib/ai/validate";
import { demoSheetReading, sheetReadingSchema, validSheetRequest } from "./sheet-ai";

const good = {
  columns: { email: 1, amount: 2, name: 0, note: null, currency: null, country: null, language: null },
  decimalSeparator: ",",
  fileCurrency: null,
  amounts: [{ row: 3, value: "1200.00" }],
};

describe("sheetReadingSchema", () => {
  const schema = sheetReadingSchema(4, 10);

  it("accepts a well-formed answer", () => {
    expect(schema(good, "")).toEqual(good);
  });

  it("treats missing optional columns as null", () => {
    const columns = { email: 1, amount: 2 };
    expect(schema({ ...good, columns }, "").columns).toMatchObject({ name: null, note: null, language: null });
  });

  it.each([
    ["an out-of-range column", { ...good, columns: { ...good.columns, amount: 4 } }],
    ["email and amount in one column", { ...good, columns: { ...good.columns, amount: 1 } }],
    ["a fractional column index", { ...good, columns: { ...good.columns, email: 0.5 } }],
    ["an unknown separator", { ...good, decimalSeparator: ";" }],
    ["a lowercase currency", { ...good, fileCurrency: "eur" }],
    ["an amount with arithmetic", { ...good, amounts: [{ row: 0, value: "100+20" }] }],
    ["an amount without cents", { ...good, amounts: [{ row: 0, value: "1200" }] }],
    ["a row that doesn't exist", { ...good, amounts: [{ row: 10, value: "1.00" }] }],
    ["a string instead of an object", "columns: email=1"],
    ["more amounts than rows", { ...good, amounts: Array.from({ length: 11 }, (_, i) => ({ row: i % 10, value: "1.00" })) }],
  ])("refuses %s", (_label, answer) => {
    expect(() => schema(answer, "")).toThrow(AiInvalid);
  });
});

describe("validSheetRequest", () => {
  it("accepts a rectangular table within limits", () => {
    expect(validSheetRequest({ headers: ["a", "b"], rows: [["1", "2"]] })).not.toBeNull();
  });

  it("refuses ragged, oversized or non-text tables", () => {
    expect(validSheetRequest({ headers: ["a", "b"], rows: [["1"]] })).toBeNull();
    expect(validSheetRequest({ headers: ["a", "b"], rows: [] })).toBeNull();
    expect(validSheetRequest({ headers: ["a", "b"], rows: [["x".repeat(121), "1"]] })).toBeNull();
    expect(validSheetRequest({ headers: ["a", "b"], rows: [[1, 2]] })).toBeNull();
    expect(validSheetRequest({ headers: ["a"], rows: [["1"]] })).toBeNull();
  });
});

describe("demoSheetReading", () => {
  it("finds columns by header and content", () => {
    const r = demoSheetReading({
      headers: ["Creator", "Contact", "Gross", "Net payout", "País"],
      rows: [
        ["Ana", "ana@x.com", "100", "90,50", "Brasil"],
        ["Bo", "bo@x.com", "50", "45,00", "México"],
      ],
    });
    expect(r.columns).toMatchObject({ email: 1, amount: 3, name: 0, country: 4 });
    expect(r.decimalSeparator).toBe(",");
    // Its output passes the same schema as the AI's.
    expect(() => sheetReadingSchema(5, 2)(r, "")).not.toThrow();
  });
});
