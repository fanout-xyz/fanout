import "server-only";
import { AiInvalid } from "./validate";

/**
 * The AI provider: any OpenAI-compatible chat completions API, Kimi (Moonshot) by default.
 *
 * Env (server only, never NEXT_PUBLIC):
 *   AI_API_KEY   the provider's key. Unset = every AI feature is hidden (except the mock, below).
 *   AI_BASE_URL  default https://api.moonshot.ai/v1
 *   AI_MODEL     default kimi-k3
 *
 * With NEXT_PUBLIC_USE_MOCK on and no key, the features use a deterministic stand-in instead
 * ("demo"), so the UI works and can be tested without a provider.
 *
 * The AI only proposes. Nothing it returns signs or sends anything: every answer is checked against
 * a schema (validate.ts), and payout rows then go through the same checks as a CSV upload.
 */

export const DEFAULT_AI_BASE_URL = "https://api.moonshot.ai/v1";
export const DEFAULT_AI_MODEL = "kimi-k3";
/** Generous enough for a reasoning model on low effort; the route returns well before Vercel's limit. */
export const AI_TIMEOUT_MS = 45_000;

export type AiSettings = { apiKey: string; baseUrl: string; model: string };
export type AiMode = "live" | "demo" | "off";

type Env = Record<string, string | undefined>;

export function aiSettings(env: Env = process.env): AiSettings | null {
  const apiKey = env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.AI_BASE_URL?.trim() || DEFAULT_AI_BASE_URL).replace(/\/+$/, ""),
    model: env.AI_MODEL?.trim() || DEFAULT_AI_MODEL,
  };
}

export function aiMode(env: Env = process.env): AiMode {
  if (aiSettings(env)) return "live";
  return env.NEXT_PUBLIC_USE_MOCK !== "false" ? "demo" : "off";
}

/** The provider couldn't be reached, timed out, or refused. Safe message for the user. */
export class AiUnavailable extends Error {
  override name = "AiUnavailable";
}

export type ChatJsonRequest = {
  system: string;
  user: string;
  /** Output budget. Small: every answer here is a short JSON object. */
  maxTokens?: number;
};

/**
 * The request body. JSON mode (response_format json_object) is part of the OpenAI-compatible API;
 * the schema itself is in the system prompt and enforced on our side. On Moonshot, Kimi K3 always
 * reasons, so ask for low effort, and Kimi K2 models get thinking turned off: these answers are
 * short and structured.
 */
export function chatRequestBody(settings: AiSettings, req: ChatJsonRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    response_format: { type: "json_object" },
    max_tokens: req.maxTokens ?? 8000,
  };
  const moonshot = /(^|\.)(moonshot\.(ai|cn)|kimi\.ai)$/i.test(hostOf(settings.baseUrl));
  if (moonshot && /^kimi-k3/i.test(settings.model)) body.reasoning_effort = "low";
  if (moonshot && /^kimi-k2/i.test(settings.model)) body.thinking = { type: "disabled" };
  return body;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Pulls the JSON object out of a chat completion. Tolerates a ```json fence around it. */
export function parseCompletion(body: unknown): unknown {
  const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new AiInvalid("response is empty");
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    throw new AiInvalid("response is not JSON");
  }
}

export async function chatJson(
  settings: AiSettings,
  req: ChatJsonRequest,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(chatRequestBody(settings, req)),
      signal: AbortSignal.timeout(opts.timeoutMs ?? AI_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    console.error("[ai] request failed", timedOut ? "timeout" : "network");
    throw new AiUnavailable(timedOut ? "Our assistant took too long. Try again." : "Couldn't reach our assistant. Try again.");
  }
  if (!res.ok) {
    // Status only: the request held the user's data.
    console.error("[ai] provider returned", res.status);
    throw new AiUnavailable(res.status === 429 ? "Our assistant is busy. Try again in a minute." : "Our assistant isn't available right now. Try again.");
  }
  return parseCompletion(await res.json().catch(() => null));
}
