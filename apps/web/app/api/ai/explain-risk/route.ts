import { AiRefused, aiRoute } from "@/lib/ai/route";
import { RateLimiter } from "@/lib/ai/rate-limit";
import { demoRiskExplanation, riskExplanationSchema, riskUserMessage, RISK_SYSTEM_PROMPT, validRiskRequest } from "@/lib/assist/risk-ai";

const perIp = new RateLimiter(30, 60 * 60_000);
const perSession = new RateLimiter(20, 10 * 60_000);

/**
 * POST { reasons: [{ kind, facts }], account? } -> { explanation }. Signed-in platforms only.
 * Only rule names and numbers go to the AI provider: no emails, names or amounts per person.
 */
export function POST(request: Request) {
  return aiRoute(request, {
    name: "explain-risk",
    maxBodyBytes: 4_000,
    requireSession: true,
    perIp,
    perSession,
    run: async ({ body, ask }) => {
      const reasons = validRiskRequest(body);
      if (!reasons) throw new AiRefused("Bad request.");
      return ask({
        system: RISK_SYSTEM_PROMPT,
        user: riskUserMessage(reasons),
        maxTokens: 2000,
        schema: riskExplanationSchema(reasons),
        demo: () => demoRiskExplanation(reasons),
      });
    },
  });
}
