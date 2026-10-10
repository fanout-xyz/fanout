import { describe, expect, it, vi } from "vitest";
import { aiMode, aiSettings, AiUnavailable, chatJson, chatRequestBody, parseCompletion } from "./provider";
import { AiInvalid } from "./validate";
import { RateLimiter } from "./rate-limit";

const settings = { apiKey: "test-key", baseUrl: "https://api.moonshot.ai/v1", model: "kimi-k3" };
const completion = (content: string) => ({ choices: [{ message: { role: "assistant", content } }] });

describe("aiSettings / aiMode", () => {
  it("is off without a key outside the mock, and uses Moonshot defaults", () => {
    expect(aiSettings({})).toBeNull();
    expect(aiMode({ NEXT_PUBLIC_USE_MOCK: "false" })).toBe("off");
    expect(aiMode({})).toBe("demo");
    expect(aiSettings({ AI_API_KEY: "k" })).toEqual({ apiKey: "k", baseUrl: "https://api.moonshot.ai/v1", model: "kimi-k3" });
    expect(aiMode({ AI_API_KEY: "k", NEXT_PUBLIC_USE_MOCK: "false" })).toBe("live");
  });

  it("switches providers through env", () => {
    expect(aiSettings({ AI_API_KEY: "k", AI_BASE_URL: "https://other.example/v1/", AI_MODEL: "some-model" })).toEqual({
      apiKey: "k",
      baseUrl: "https://other.example/v1",
      model: "some-model",
    });
  });
});

describe("chatRequestBody", () => {
  it("asks for JSON, and low reasoning effort from Kimi K3", () => {
    const body = chatRequestBody(settings, { system: "s", user: "u" });
    expect(body).toMatchObject({ model: "kimi-k3", response_format: { type: "json_object" }, reasoning_effort: "low" });
    expect(body.messages).toEqual([
      { role: "system", content: "s" },
      { role: "user", content: "u" },
    ]);
  });

  it("turns thinking off for Kimi K2, and sends no Moonshot-only fields elsewhere", () => {
    expect(chatRequestBody({ ...settings, model: "kimi-k2.6" }, { system: "s", user: "u" }).thinking).toEqual({ type: "disabled" });
    const other = chatRequestBody({ ...settings, baseUrl: "https://api.example.com/v1", model: "kimi-k3" }, { system: "s", user: "u" });
    expect(other).not.toHaveProperty("reasoning_effort");
    expect(other).not.toHaveProperty("thinking");
  });
});

describe("parseCompletion", () => {
  it("reads JSON content, with or without a code fence", () => {
    expect(parseCompletion(completion('{"a":1}'))).toEqual({ a: 1 });
    expect(parseCompletion(completion('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
  });

  it("refuses empty or non-JSON answers", () => {
    expect(() => parseCompletion({ choices: [] })).toThrow(AiInvalid);
    expect(() => parseCompletion(completion("Sure! Here's the mapping."))).toThrow(AiInvalid);
  });
});

describe("chatJson", () => {
  it("posts to the chat completions endpoint with the key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(completion('{"ok":true}')), { status: 200 }));
    await expect(chatJson(settings, { system: "s", user: "u" }, { fetchImpl })).resolves.toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
  });

  it("maps provider errors and timeouts to AiUnavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const busy = vi.fn(async () => new Response("{}", { status: 429 }));
    await expect(chatJson(settings, { system: "s", user: "u" }, { fetchImpl: busy })).rejects.toThrow(/busy/);
    const slow = vi.fn(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    await expect(chatJson(settings, { system: "s", user: "u" }, { fetchImpl: slow })).rejects.toThrow(AiUnavailable);
  });
});

describe("RateLimiter", () => {
  it("allows max hits per window", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.limited("a", 0)).toBe(false);
    expect(limiter.limited("a", 10)).toBe(false);
    expect(limiter.limited("a", 20)).toBe(true);
    expect(limiter.limited("b", 20)).toBe(false);
    expect(limiter.limited("a", 1500)).toBe(false);
  });
});
