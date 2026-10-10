import { NextResponse } from "next/server";
import { aiMode } from "@/lib/ai/provider";

/** GET -> { mode: "live" | "demo" | "off" }. The UI hides every AI feature when it's "off". */
export function GET() {
  return NextResponse.json({ mode: aiMode() }, { headers: { "cache-control": "no-store" } });
}
