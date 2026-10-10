import { AiRefused, aiRoute } from "@/lib/ai/route";
import { RateLimiter } from "@/lib/ai/rate-limit";
import { demoSheetReading, sheetReadingSchema, sheetUserMessage, SHEET_SYSTEM_PROMPT, validSheetRequest } from "@/lib/assist/sheet-ai";

const perIp = new RateLimiter(20, 60 * 60_000);
const perSession = new RateLimiter(10, 10 * 60_000);

/**
 * POST { headers, rows, account? } -> SheetReading (lib/assist/proposal.ts). Signed-in platforms only.
 * The table, emails included, goes to the AI provider to read the columns; nothing is stored or logged.
 */
export function POST(request: Request) {
  return aiRoute(request, {
    name: "read-sheet",
    maxBodyBytes: 300_000,
    requireSession: true,
    perIp,
    perSession,
    run: async ({ body, ask }) => {
      const table = validSheetRequest(body);
      if (!table) throw new AiRefused("That table is too big or couldn't be read. Up to 400 rows and 40 columns.");
      return ask({
        system: SHEET_SYSTEM_PROMPT,
        user: sheetUserMessage(table),
        maxTokens: 8000,
        schema: sheetReadingSchema(table.headers.length, table.rows.length),
        demo: () => demoSheetReading(table),
      });
    },
  });
}
