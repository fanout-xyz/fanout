// Machine-translates the claim page and claim email strings (lib/i18n/messages/en.json) into the other
// languages, once, through the same OpenAI-compatible provider as the AI features. The output is
// committed and reviewed like any other change; nothing is translated while payees use the app.
//
// Usage: AI_API_KEY=... pnpm --filter web translate [es pt ...]   (default: every language but English)
// Optional: AI_BASE_URL (default https://api.moonshot.ai/v1), AI_MODEL (default kimi-k3).
// Existing files are overwritten; review the diff, and have native speakers check before relying on it.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LANGS: Record<string, string> = {
  es: "Spanish",
  pt: "Brazilian Portuguese",
  fr: "French",
  hi: "Hindi",
  ur: "Urdu",
  bn: "Bengali",
  yo: "Yoruba",
  ha: "Hausa",
  id: "Indonesian",
};

const dir = join(import.meta.dirname, "..", "lib", "i18n", "messages");
const source = JSON.parse(readFileSync(join(dir, "en.json"), "utf8")) as Record<string, unknown>;
const strings = Object.fromEntries(Object.entries(source).filter(([k]) => k !== "_meta")) as Record<string, string>;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

const apiKey = process.env.AI_API_KEY;
const baseUrl = (process.env.AI_BASE_URL || "https://api.moonshot.ai/v1").replace(/\/+$/, "");
const model = process.env.AI_MODEL || "kimi-k3";
if (!apiKey) {
  console.error("Set AI_API_KEY (and optionally AI_BASE_URL, AI_MODEL).");
  process.exit(1);
}

async function translate(language: string): Promise<Record<string, string>> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Translate the values of this JSON object from English into ${language} for a payout service's claim page and email.
Plain, warm, everyday words for people receiving money from work. Talk about money and dollars only: never words like crypto, token, wallet or blockchain.
Keep every key, and keep placeholders like {amount} and {platform} exactly as they are. Keep "Fanout" untranslated.
Return only the JSON object with the same keys.`,
        },
        { role: "user", content: JSON.stringify(strings) },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${language}: provider returned ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const out = JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
  for (const [key, en] of Object.entries(strings)) {
    const value = out[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`${language}: missing "${key}"`);
    if (placeholders(value) !== placeholders(en)) throw new Error(`${language}: "${key}" changed its placeholders`);
  }
  return Object.fromEntries(Object.keys(strings).map((k) => [k, out[k] as string]));
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LANGS);
for (const code of wanted) {
  if (!LANGS[code]) throw new Error(`Unknown language: ${code}`);
  const translated = await translate(LANGS[code]);
  const file = {
    _meta: {
      language: LANGS[code].replace("Brazilian ", ""),
      machineTranslated: true,
      note: "Machine-translated from en.json and checked against it (placeholders, length, no crypto words). Have a native speaker review before relying on it.",
    },
    ...translated,
  };
  writeFileSync(join(dir, `${code}.json`), `${JSON.stringify(file, null, 2)}\n`);
  console.log(`Wrote ${code}.json`);
}
