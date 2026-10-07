import { NextResponse } from "next/server";
import { LOCAL_CURRENCIES, type FxRates } from "@/lib/fx";

// Free, keyless, updated daily: https://www.exchangerate-api.com/docs/free
const SOURCE = "https://open.er-api.com/v6/latest/USD";

// Last good answer per instance, served if the provider is down.
let lastGood: FxRates | null = null;

/** GET -> { rates: { NGN: 1480.2, ... }, updatedAt } (local units per 1 USD). */
export async function GET() {
  try {
    const res = await fetch(SOURCE, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_unix?: number };
    if (body.result !== "success" || !body.rates) throw new Error("unexpected response");

    const rates: FxRates["rates"] = {};
    for (const code of LOCAL_CURRENCIES) {
      const rate = body.rates[code];
      if (typeof rate === "number" && rate > 0) rates[code] = rate;
    }
    lastGood = {
      rates,
      updatedAt: new Date((body.time_last_update_unix ?? Date.now() / 1000) * 1000).toISOString(),
    };
  } catch (err) {
    console.error("[fx]", err instanceof Error ? err.message : err);
    if (!lastGood) return NextResponse.json({ error: "Rates unavailable." }, { status: 503 });
  }
  return NextResponse.json(lastGood, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
