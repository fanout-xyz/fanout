import { NextResponse } from "next/server";
import { AURORA_API } from "@/lib/aurora";
import { auroraEnabled, auroraKey } from "@/lib/aurora-server";

/** GET ?depositAddress=... -> { status, swapDetails } */
export async function GET(request: Request) {
  if (!auroraEnabled()) return NextResponse.json({ error: "Not switched on." }, { status: 503 });
  const depositAddress = new URL(request.url).searchParams.get("depositAddress") ?? "";
  if (!/^[A-Za-z0-9._:-]{20,100}$/.test(depositAddress)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const url = `${AURORA_API}/status/${encodeURIComponent(auroraKey())}?depositAddress=${encodeURIComponent(depositAddress)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  if (!res?.ok || !data?.status) return NextResponse.json({ error: "Couldn't check the transfer. Retrying." }, { status: 502 });
  return NextResponse.json({ status: data.status, swapDetails: data.swapDetails });
}
