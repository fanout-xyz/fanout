import { NextResponse } from "next/server";
import { allowedSources, auroraEnabled } from "@/lib/aurora-server";

/** GET -> { enabled, sources: SourceOption[] } */
export async function GET() {
  try {
    return NextResponse.json({ enabled: auroraEnabled(), sources: await allowedSources() });
  } catch (err) {
    console.error("[aurora] tokens", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't reach Aurora. Try again in a moment." }, { status: 502 });
  }
}
