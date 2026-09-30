// Local-currency display for payees: "$50 ≈ ₦74,000 at today's rate". Display only; balances
// and payouts stay in US dollars.

/** Currencies a payee can pick, in picker order. Emerging-market payout countries first. */
export const LOCAL_CURRENCIES = [
  "NGN", "KES", "GHS", "UGX", "TZS", "ZAR", "EGP", "XOF",
  "PKR", "BDT", "INR", "LKR", "NPR",
  "PHP", "IDR", "VND", "THB", "MYR",
  "TRY", "AED",
  "BRL", "MXN", "ARS", "COP", "PEN", "CLP",
  "EUR", "GBP", "CAD", "AUD",
] as const;

export type LocalCurrency = (typeof LOCAL_CURRENCIES)[number];

export function isLocalCurrency(code: unknown): code is LocalCurrency {
  return typeof code === "string" && (LOCAL_CURRENCIES as readonly string[]).includes(code);
}

const EURO = ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"];

const COUNTRY_CURRENCY: Record<string, LocalCurrency> = {
  NG: "NGN", KE: "KES", GH: "GHS", UG: "UGX", TZ: "TZS", ZA: "ZAR", EG: "EGP",
  SN: "XOF", CI: "XOF", BJ: "XOF", BF: "XOF", ML: "XOF", NE: "XOF", TG: "XOF", GW: "XOF",
  PK: "PKR", BD: "BDT", IN: "INR", LK: "LKR", NP: "NPR",
  PH: "PHP", ID: "IDR", VN: "VND", TH: "THB", MY: "MYR",
  TR: "TRY", AE: "AED",
  BR: "BRL", MX: "MXN", AR: "ARS", CO: "COP", PE: "PEN", CL: "CLP",
  GB: "GBP", CA: "CAD", AU: "AUD",
  ...Object.fromEntries(EURO.map((c) => [c, "EUR" as const])),
};

// Time zone says where the phone is; the language tag is often "en-US" everywhere.
const TIMEZONE_COUNTRY: Record<string, string> = {
  "Africa/Lagos": "NG", "Africa/Nairobi": "KE", "Africa/Accra": "GH", "Africa/Kampala": "UG",
  "Africa/Dar_es_Salaam": "TZ", "Africa/Johannesburg": "ZA", "Africa/Cairo": "EG",
  "Africa/Dakar": "SN", "Africa/Abidjan": "CI",
  "Asia/Karachi": "PK", "Asia/Dhaka": "BD", "Asia/Kolkata": "IN", "Asia/Calcutta": "IN",
  "Asia/Colombo": "LK", "Asia/Kathmandu": "NP", "Asia/Katmandu": "NP",
  "Asia/Manila": "PH", "Asia/Jakarta": "ID", "Asia/Makassar": "ID", "Asia/Jayapura": "ID",
  "Asia/Ho_Chi_Minh": "VN", "Asia/Saigon": "VN", "Asia/Bangkok": "TH", "Asia/Kuala_Lumpur": "MY",
  "Europe/Istanbul": "TR", "Asia/Dubai": "AE",
  "America/Sao_Paulo": "BR", "America/Mexico_City": "MX", "America/Argentina/Buenos_Aires": "AR",
  "America/Buenos_Aires": "AR", "America/Bogota": "CO", "America/Lima": "PE", "America/Santiago": "CL",
  "Europe/London": "GB",
};

/** Best guess at the payee's currency from the device time zone, then its language tags. */
export function guessLocalCurrency(timeZone: string | undefined, languages: readonly string[]): LocalCurrency | null {
  const fromZone = timeZone ? COUNTRY_CURRENCY[TIMEZONE_COUNTRY[timeZone] ?? ""] : undefined;
  if (fromZone) return fromZone;
  for (const tag of languages) {
    let region: string | undefined;
    try {
      region = new Intl.Locale(tag).region;
    } catch {
      continue;
    }
    const currency = region ? COUNTRY_CURRENCY[region] : undefined;
    if (currency) return currency;
  }
  return null;
}

/** Integer US cents -> "₦74,000" (whole units from 100 up, so it doesn't look falsely precise). */
export function formatLocal(cents: number, rate: number, currency: LocalCurrency): string {
  const value = (cents / 100) * rate;
  const whole = Math.abs(value) >= 100;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(value);
}

/** "Nigerian naira" for the picker; falls back to the code. */
export function currencyName(currency: LocalCurrency): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(currency) ?? currency;
  } catch {
    return currency;
  }
}

export type FxRates = {
  /** Local units per 1 USD. */
  rates: Partial<Record<LocalCurrency, number>>;
  /** When the provider last updated, ISO 8601. */
  updatedAt: string;
};

/** "at today's rate" while the rate is under a day and a half old, else "at the rate on Sep 30". */
export function rateAgeLabel(updatedAt: string, now: Date = new Date()): string {
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) return "at the latest rate";
  if (now.getTime() - updated.getTime() < 36 * 3600_000) return "at today's rate";
  return `at the rate on ${updated.toLocaleDateString("en", { month: "short", day: "numeric" })}`;
}
