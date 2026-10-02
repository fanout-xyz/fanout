import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { quoteBody } from "@/lib/aurora";
import { allowedSources, auroraEnabled, auroraFetch } from "@/lib/aurora-server";

/** POST { originAsset, amountUsd, recipient, dry } -> Aurora's quote (deposit address when not dry). */
export async function POST(request: Request) {
  if (!auroraEnabled()) return NextResponse.json({ error: "Adding money from other chains isn't switched on yet." }, { status: 503 });
  let body: { originAsset?: unknown; amountUsd?: unknown; recipient?: unknown; dry?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const { originAsset, amountUsd, recipient, dry } = body;
  const amountOk = typeof amountUsd === "string" && /^\d+(\.\d{1,2})?$/.test(amountUsd) && Number(amountUsd) >= 1 && Number(amountUsd) <= 100_000;
  if (!amountOk) return NextResponse.json({ error: "Enter an amount between $1 and $100,000." }, { status: 400 });
  if (typeof recipient !== "string" || !isAddress(recipient)) return NextResponse.json({ error: "Sign in again." }, { status: 400 });
  const sources = await allowedSources().catch(() => []);
  if (typeof originAsset !== "string" || !sources.some((s) => s.assetId === originAsset)) {
    return NextResponse.json({ error: "Pick a chain and token from the list." }, { status: 400 });
  }

  const res = await auroraFetch("quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(quoteBody({ originAsset, amountUsd, recipient, dry: dry !== false })),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  if (!res?.ok || !data?.quote) {
    console.error("[aurora] quote", res?.status, data?.message ?? data?.error);
    const msg = typeof data?.message === "string" && /amount|low|minimum/i.test(data.message) ? "That amount is too small for this route. Try a larger one." : "Couldn't get a quote right now. Try again.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  return NextResponse.json({ quote: data.quote });
}
