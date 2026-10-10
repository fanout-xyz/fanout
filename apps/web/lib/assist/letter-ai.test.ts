import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { AiInvalid } from "@/lib/ai/validate";
import { linkMessage, passportSignaturesValid, statementMessage, type Passport, type PassportStatement } from "@/lib/payee/passport";
import { demoLetter, letterFacts, letterSchema, letterUserMessage, LETTER_LINK, numbersIn, parseLetterOptions } from "./letter-ai";

const statement: PassportStatement = {
  v: 1,
  account: "0x7564105E977516C53bE337314c7E53838967bDaC",
  passportKey: "0x5CbDd86a2FA8Dc4bDdd8a8f69dBa48572EeC07FB",
  months: ["2026-08", "2026-09", "2026-10"],
  minMonthlyUsd: 1200,
  platforms: 2,
  issuedAt: Date.UTC(2026, 9, 10),
};
const facts = letterFacts(statement, "en", "landlord");
const schema = letterSchema(facts, statement.issuedAt, statement.months);
const body = (middle: string) =>
  `Dear landlord,\n\n${middle}\n\nFanout checked this against the payouts I received. You can check it here:\n\n${LETTER_LINK}\n\nKind regards,\n[Your name]`;

describe("letterFacts", () => {
  it("uses only the statement's period, floor and platform count", () => {
    expect(facts).toEqual({
      language: "en",
      audience: "landlord",
      firstMonth: "August 2026",
      lastMonth: "October 2026",
      months: 3,
      minMonthlyUsd: 1200,
      platforms: 2,
      issued: "October 10, 2026",
    });
    const sent = letterUserMessage(facts);
    expect(sent).not.toContain(statement.account);
    expect(sent).not.toContain("@");
    expect(letterFacts(statement, "es", "lender").firstMonth).toBe("agosto de 2026");
  });

  it("reads the options", () => {
    expect(parseLetterOptions({ language: "Spanish", audience: "lender" })).toEqual({ language: "es", audience: "lender" });
    expect(parseLetterOptions({ language: "es", audience: "boss" })).toBeNull();
    expect(parseLetterOptions({ language: "xx", audience: "lender" })).toBeNull();
  });
});

describe("letterSchema", () => {
  it("accepts a letter that only uses the passport's numbers", () => {
    const text = body("From August 2026 to October 2026 I earned at least $1,200 every month from 2 platforms. It was checked on October 10, 2026, over 3 months.");
    expect(schema({ letter: text }, "").letter).toBe(text);
  });

  it("refuses invented amounts, payments, links and emails", () => {
    expect(() => schema({ letter: body("I earned at least $1,200 a month, including one payment of $450 in September 2026.") }, "")).toThrow(AiInvalid);
    expect(() => schema({ letter: body("I earned at least $1,500 every month from 2 platforms during 2026, which is plenty.") }, "")).toThrow(AiInvalid);
    expect(() => schema({ letter: body("Check https://evil.example for details about my income of $1,200 in 2026 for 3 months.") }, "")).toThrow(AiInvalid);
    expect(() => schema({ letter: body("Write to me at me@example.com about my income of $1,200 in 2026 for 3 months please.") }, "")).toThrow(AiInvalid);
    expect(() => schema({ letter: "Too short." }, "")).toThrow(AiInvalid);
  });

  it("reads native digits, and adds the link when the draft left it out", () => {
    expect(numbersIn("১,২০০ and ٢ and 1.200,00")).toEqual([1200, 2, 1200]);
    const bengali = "প্রিয় বাড়িওয়ালা, আমি প্রতি মাসে অন্তত $১,২০০ আয় করেছি, ২টি প্ল্যাটফর্ম থেকে, ২০২৬ সালে। ".repeat(4);
    expect(() => schema({ letter: bengali }, "")).not.toThrow();
    expect(schema({ letter: bengali }, "").letter.endsWith(LETTER_LINK)).toBe(true);
    expect(() => schema({ letter: bengali.replace("১,২০০", "১,৫০০") }, "")).toThrow(AiInvalid);
  });

  it("passes the demo letter", () => {
    expect(() => schema(demoLetter(facts), "")).not.toThrow();
    expect(demoLetter(letterFacts({ ...statement, months: ["2026-10"] }, "en", "other")).letter).toContain("To whom it may concern");
  });
});

describe("passportSignaturesValid", () => {
  it("accepts a properly signed passport and refuses a changed one", async () => {
    const account = privateKeyToAccount(`0x${"44".repeat(32)}`);
    const key = privateKeyToAccount(`0x${"33".repeat(32)}`);
    const s = { ...statement, account: account.address, passportKey: key.address };
    const passport: Passport = {
      statement: s,
      link: await account.signMessage({ message: linkMessage(s.account, s.passportKey) }),
      sig: await key.signMessage({ message: statementMessage(s) }),
    };
    expect(await passportSignaturesValid(passport)).toBe(true);
    expect(await passportSignaturesValid({ ...passport, statement: { ...s, minMonthlyUsd: 5000 } })).toBe(false);
  });
});
