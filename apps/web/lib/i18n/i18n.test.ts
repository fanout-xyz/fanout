import { describe, expect, it } from "vitest";
import en from "./messages/en.json";
import { LANG_CODES, languageForCountry, normalizeLanguage, parseAcceptLanguage, pickLanguage } from "./languages";
import { claimPageLanguage, fill, formatDollars, MESSAGES, t } from "./messages";

describe("normalizeLanguage", () => {
  it("reads codes, regional tags and names", () => {
    expect(normalizeLanguage("es")).toBe("es");
    expect(normalizeLanguage("es-MX")).toBe("es");
    expect(normalizeLanguage("pt_BR")).toBe("pt");
    expect(normalizeLanguage("Spanish")).toBe("es");
    expect(normalizeLanguage("Português")).toBe("pt");
    expect(normalizeLanguage("bangla")).toBe("bn");
    expect(normalizeLanguage("in")).toBe("id");
    expect(normalizeLanguage("de")).toBeNull();
    expect(normalizeLanguage("")).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
  });
});

describe("Accept-Language", () => {
  it("orders tags by quality", () => {
    expect(parseAcceptLanguage("fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5")).toEqual(["fr-CH", "fr", "en", "de"]);
    expect(parseAcceptLanguage("en;q=0.5, ur")).toEqual(["ur", "en"]);
    expect(parseAcceptLanguage("de;q=0, es")).toEqual(["es"]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });

  it("picks the first supported language, else English", () => {
    expect(pickLanguage(parseAcceptLanguage("de-DE, pt-BR;q=0.9, en;q=0.8"))).toBe("pt");
    expect(pickLanguage(["de", "ja"])).toBe("en");
    expect(pickLanguage([])).toBe("en");
  });

  it("prefers the payee's choice, then the payout's language, then the browser", () => {
    expect(claimPageLanguage({ acceptLanguage: "hi-IN,hi;q=0.9" })).toBe("hi");
    expect(claimPageLanguage({ query: "es", acceptLanguage: "hi-IN" })).toBe("es");
    expect(claimPageLanguage({ saved: "fr", query: "es", acceptLanguage: "hi-IN" })).toBe("fr");
    expect(claimPageLanguage({ saved: "xx", query: "zz", acceptLanguage: "yo" })).toBe("yo");
    expect(claimPageLanguage({})).toBe("en");
  });
});

describe("languageForCountry", () => {
  it("maps country codes and names where one language clearly fits", () => {
    expect(languageForCountry("BR")).toBe("pt");
    expect(languageForCountry("mx")).toBe("es");
    expect(languageForCountry("Sénégal")).toBe("fr");
    expect(languageForCountry("PAK")).toBe("ur");
    expect(languageForCountry("Bangladesh")).toBe("bn");
    expect(languageForCountry("NG")).toBe("en");
    expect(languageForCountry("JP")).toBeNull();
    expect(languageForCountry("")).toBeNull();
  });
});

describe("messages", () => {
  const keys = Object.keys(en).filter((k) => k !== "_meta").sort();
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it.each(LANG_CODES.filter((l) => l !== "en"))("%s has every string, the same placeholders, and is marked machine-translated", (lang) => {
    const messages = MESSAGES[lang] as Record<string, unknown>;
    expect(Object.keys(messages).filter((k) => k !== "_meta").sort()).toEqual(keys);
    expect((messages._meta as { machineTranslated?: boolean }).machineTranslated).toBe(true);
    for (const key of keys) {
      const text = messages[key] as string;
      expect(text.trim().length, `${lang}.${key}`).toBeGreaterThan(0);
      expect(placeholders(text), `${lang}.${key}`).toEqual(placeholders((en as unknown as Record<string, string>)[key]));
    }
  });

  it.each(LANG_CODES)("%s uses no crypto words", (lang) => {
    const all = Object.entries(MESSAGES[lang]).filter(([k]) => k !== "_meta").map(([, v]) => v).join(" ");
    expect(all).not.toMatch(/crypto|token|blockchain|wallet|stablecoin|AUSD|USDC|\bgas\b/i);
  });

  it("fills placeholders and falls back to English", () => {
    expect(fill("Claim {amount} from {platform}", { amount: "$5.00" })).toBe("Claim $5.00 from {platform}");
    expect(t("es", "claimAmount", { amount: "5,00 US$" })).toBe("Cobrar 5,00 US$");
    expect(t("en", "from", { platform: "Acme" })).toBe("from Acme");
  });

  it("formats dollars in the payee's number format", () => {
    expect(formatDollars("en", 123_456)).toBe("$1,234.56");
    expect(formatDollars("es", 123_456)).toMatch(/1\.?234,56\s?US\$/);
    expect(formatDollars("pt", 123_456)).toMatch(/US\$\s?1\.234,56/);
    expect(formatDollars("fr", 5_000)).toMatch(/50,00\s\$US/);
  });
});
