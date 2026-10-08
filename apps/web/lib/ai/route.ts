import "server-only";
import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { privyClient, SessionExpired, verifiedUser } from "@/lib/auth/privy-server";
import { config } from "@/lib/config";
import { aiMode, aiSettings, AiUnavailable, chatJson, type AiMode, type ChatJsonRequest } from "./provider";
import { RateLimiter } from "./rate-limit";
import { AiInvalid, type Check } from "./validate";

/** A refusal whose message is safe to show (bad input, too large, ...). */
export class AiRefused extends Error {
  override name = "AiRefused";
}

export type AiAsk = <T>(req: ChatJsonRequest & { schema: Check<T>; demo: () => unknown }) => Promise<T>;

export type AiRouteContext = {
  body: Record<string, unknown>;
  mode: Exclude<AiMode, "off">;
  /** Asks the provider (or, in demo mode, the deterministic stand-in) and validates the answer. */
  ask: AiAsk;
};

type Options = {
  /** For logs only. */
  name: string;
  /** Request body limit in bytes. */
  maxBodyBytes: number;
  /** Platform features need a signed-in session; the payee letter is checked by its passport instead. */
  requireSession: boolean;
  perIp: RateLimiter;
  perSession?: RateLimiter;
  run: (ctx: AiRouteContext) => Promise<unknown>;
};

/**
 * Shared shape of every /api/ai route: hidden when AI is off, a body size cap, per-IP and per-session
 * limits, a signed-in session for platform features, and errors mapped to safe messages. Nothing the
 * user sent is logged.
 */
export async function aiRoute(request: Request, opts: Options): Promise<Response> {
  const mode = aiMode();
  if (mode === "off") return NextResponse.json({ error: "Not found." }, { status: 404 });

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (opts.perIp.limited(ip)) return tooMany();

  const text = await request.text().catch(() => "");
  if (text.length > opts.maxBodyBytes) {
    return NextResponse.json({ error: "That's too much to read at once. Try a smaller file." }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    if (opts.requireSession) {
      const session = await sessionKey(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null, body.account);
      if (opts.perSession?.limited(session)) return tooMany();
    }
    const ask: AiAsk = async ({ schema, demo, ...req }) => {
      const settings = aiSettings();
      const raw = settings ? await chatJson(settings, req) : demo();
      return schema(raw, "");
    };
    return NextResponse.json(await opts.run({ body, mode, ask }));
  } catch (err) {
    if (err instanceof AiRefused) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof SessionExpired) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof AiUnavailable) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof AiInvalid) {
      console.error(`[ai:${opts.name}] answer refused:`, err.message);
      return NextResponse.json({ error: "Our assistant's answer didn't check out, so nothing was changed. Try again." }, { status: 502 });
    }
    console.error(`[ai:${opts.name}]`, err instanceof Error ? err.name : "error");
    return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
  }
}

const tooMany = () => NextResponse.json({ error: "Too many tries. Wait a minute and try again." }, { status: 429 });

/** Who is asking: the signed-in platform account. Throws AiRefused or SessionExpired. */
async function sessionKey(accessToken: string | null, mockAccount: unknown): Promise<string> {
  if (config.useMock) {
    // Mock mode has no real sign-in to check (same as the claim emails); local demos only.
    if (typeof mockAccount !== "string" || !isAddress(mockAccount)) throw new AiRefused("Sign in to use the assistant.");
    return `mock:${getAddress(mockAccount)}`;
  }
  const privy = privyClient();
  if (!privy) {
    console.error("[ai] PRIVY_APP_SECRET is not set");
    throw new AiRefused("The assistant isn't available right now.");
  }
  if (!accessToken) throw new AiRefused("Sign in to use the assistant.");
  const { wallets } = await verifiedUser(privy, accessToken);
  const first = [...wallets].sort()[0];
  if (!first) throw new AiRefused("Sign in to use the assistant.");
  return `privy:${first}`;
}
