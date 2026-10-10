import { AiRefused, aiRoute } from "@/lib/ai/route";
import { RateLimiter } from "@/lib/ai/rate-limit";
import { demoLetter, letterFacts, letterSchema, letterUserMessage, LETTER_SYSTEM_PROMPT, parseLetterOptions } from "@/lib/assist/letter-ai";
import { decodePassport, passportSignaturesValid } from "@/lib/payee/passport";

const perIp = new RateLimiter(10, 60 * 60_000);
const perAccount = new RateLimiter(5, 10 * 60_000);

/**
 * POST { passport, language, audience } -> { letter } with a {verify_link} placeholder.
 * passport is an encoded, signed Earnings Passport (lib/payee/passport.ts): only a payee holding
 * one can ask, and only its statement's period, monthly floor and platform count go to the AI.
 */
export function POST(request: Request) {
  return aiRoute(request, {
    name: "passport-letter",
    maxBodyBytes: 4_000,
    requireSession: false,
    perIp,
    run: async ({ body, ask }) => {
      const options = parseLetterOptions(body);
      const passport = typeof body.passport === "string" ? decodePassport(body.passport) : null;
      if (!options || !passport) throw new AiRefused("Bad request.");
      if (!(await passportSignaturesValid(passport))) throw new AiRefused("This passport couldn't be checked. Create it again.");
      if (perAccount.limited(passport.statement.account.toLowerCase())) throw new AiRefused("Too many letters. Wait a few minutes and try again.");
      const facts = letterFacts(passport.statement, options.language, options.audience);
      return ask({
        system: LETTER_SYSTEM_PROMPT,
        user: letterUserMessage(facts),
        maxTokens: 4000,
        schema: letterSchema(facts, passport.statement.issuedAt, passport.statement.months),
        // The stand-in only writes English.
        demo: () => demoLetter(letterFacts(passport.statement, "en", options.audience)),
      });
    },
  });
}
