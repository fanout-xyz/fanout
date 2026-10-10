/**
 * Languages the claim page and claim email come in. Translations are static files (lib/i18n/messages/),
 * machine-translated once and committed; English is the source and the fallback.
 */

export const LANGUAGES = [
  { code: "en", name: "English", native: "English", locale: "en-US", dir: "ltr" },
  { code: "es", name: "Spanish", native: "Español", locale: "es", dir: "ltr" },
  { code: "pt", name: "Portuguese", native: "Português", locale: "pt-BR", dir: "ltr" },
  { code: "fr", name: "French", native: "Français", locale: "fr", dir: "ltr" },
  { code: "hi", name: "Hindi", native: "हिन्दी", locale: "hi-IN", dir: "ltr" },
  { code: "ur", name: "Urdu", native: "اردو", locale: "ur-PK", dir: "rtl" },
  { code: "bn", name: "Bengali", native: "বাংলা", locale: "bn-BD", dir: "ltr" },
  { code: "yo", name: "Yoruba", native: "Yorùbá", locale: "yo-NG", dir: "ltr" },
  { code: "ha", name: "Hausa", native: "Hausa", locale: "ha-NG", dir: "ltr" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", locale: "id-ID", dir: "ltr" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];
export const DEFAULT_LANG: Lang = "en";
export const LANG_CODES = LANGUAGES.map((l) => l.code) as Lang[];

export function languageInfo(lang: Lang) {
  return LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];
}

const ALIASES: Record<string, Lang> = {
  ...Object.fromEntries(LANGUAGES.flatMap((l) => [[l.code, l.code], [l.name.toLowerCase(), l.code], [l.native.toLowerCase(), l.code]])),
  espanol: "es",
  castellano: "es",
  portugues: "pt",
  "portuguese (brazil)": "pt",
  francais: "fr",
  hindi: "hi",
  bangla: "bn",
  bahasa: "id",
  indonesia: "id",
  yoruba: "yo",
  eng: "en",
  spa: "es",
  por: "pt",
  fra: "fr",
  fre: "fr",
  hin: "hi",
  urd: "ur",
  ben: "bn",
  yor: "yo",
  hau: "ha",
  ind: "id",
};

/** "es", "es-MX", "pt_BR", "Spanish", "Português" -> a supported language, or null. */
export function normalizeLanguage(input: string | null | undefined): Lang | null {
  const s = input?.trim().toLowerCase().normalize("NFC");
  if (!s) return null;
  if (ALIASES[s]) return ALIASES[s];
  const base = s.split(/[-_]/)[0];
  // "in" is the old code for Indonesian.
  if (base === "in") return "id";
  return ALIASES[base] ?? null;
}

/**
 * The first supported language in the visitor's preferences (navigator.languages, or an
 * Accept-Language header split with parseAcceptLanguage), else English.
 */
export function pickLanguage(preferred: readonly string[]): Lang {
  for (const p of preferred) {
    const lang = normalizeLanguage(p);
    if (lang) return lang;
  }
  return DEFAULT_LANG;
}

/** "fr-CH, fr;q=0.9, en;q=0.8, *;q=0.5" -> ["fr-CH", "fr", "en"], highest quality first. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0, i };
    })
    .filter((t) => t.tag && t.tag !== "*" && t.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.i - b.i)
    .map((t) => t.tag);
}

// Country -> the supported language most people there read. Only where one clearly fits; Nigeria
// stays English (Yoruba and Hausa can't be told apart by country), India goes to Hindi.
const COUNTRY_LANG: Record<string, Lang> = {
  // Spanish
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es", EC: "es", GT: "es", CU: "es", BO: "es",
  DO: "es", HN: "es", PY: "es", SV: "es", NI: "es", CR: "es", PA: "es", UY: "es", PR: "es", GQ: "es",
  // Portuguese
  BR: "pt", PT: "pt", AO: "pt", MZ: "pt", CV: "pt", GW: "pt", ST: "pt", TL: "pt",
  // French
  FR: "fr", SN: "fr", CI: "fr", ML: "fr", BF: "fr", NE: "fr", GN: "fr", BJ: "fr", TG: "fr", CD: "fr", CG: "fr",
  GA: "fr", CM: "fr", MG: "fr", HT: "fr", MC: "fr", LU: "fr", BE: "fr", CH: "fr", TD: "fr", CF: "fr", DJ: "fr",
  // Others
  IN: "hi", PK: "ur", BD: "bn", ID: "id",
  US: "en", GB: "en", CA: "en", AU: "en", NZ: "en", IE: "en", NG: "en", GH: "en", KE: "en", ZA: "en", PH: "en",
  SG: "en", JM: "en", UG: "en", ZM: "en", ZW: "en",
};

const COUNTRY_NAMES: Record<string, string> = {
  spain: "ES", mexico: "MX", "méxico": "MX", argentina: "AR", colombia: "CO", chile: "CL", peru: "PE", "perú": "PE",
  venezuela: "VE", ecuador: "EC", guatemala: "GT", bolivia: "BO", uruguay: "UY", paraguay: "PY", "costa rica": "CR",
  "dominican republic": "DO", "españa": "ES", brazil: "BR", brasil: "BR", portugal: "PT", angola: "AO",
  mozambique: "MZ", france: "FR", senegal: "SN", "sénégal": "SN", "ivory coast": "CI", "côte d'ivoire": "CI",
  "cote d'ivoire": "CI", mali: "ML", "burkina faso": "BF", niger: "NE", guinea: "GN", benin: "BJ", "bénin": "BJ",
  togo: "TG", cameroon: "CM", cameroun: "CM", madagascar: "MG", haiti: "HT", "haïti": "HT", belgium: "BE",
  india: "IN", pakistan: "PK", bangladesh: "BD", indonesia: "ID", nigeria: "NG", ghana: "GH", kenya: "KE",
  "south africa": "ZA", philippines: "PH", "united states": "US", usa: "US", "united kingdom": "GB", uk: "GB",
  canada: "CA", australia: "AU", "new zealand": "NZ", ireland: "IE",
};

/** "BR", "bra", "Brazil" -> "pt". Null when the country is unknown or has no clear fit. */
export function languageForCountry(country: string | null | undefined): Lang | null {
  const s = country?.trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return COUNTRY_LANG[upper] ?? null;
  const iso3: Record<string, string> = { BRA: "BR", MEX: "MX", ESP: "ES", ARG: "AR", COL: "CO", PRT: "PT", FRA: "FR", SEN: "SN", CIV: "CI", IND: "IN", PAK: "PK", BGD: "BD", IDN: "ID", NGA: "NG", USA: "US", GBR: "GB", CAN: "CA", PER: "PE", CHL: "CL" };
  if (/^[A-Z]{3}$/.test(upper) && iso3[upper]) return COUNTRY_LANG[iso3[upper]] ?? null;
  const code = COUNTRY_NAMES[s.toLowerCase()];
  return code ? (COUNTRY_LANG[code] ?? null) : null;
}
