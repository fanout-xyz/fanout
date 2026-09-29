import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { relayClaim, RelayError } from "@/lib/fanout/relayer";

/** Gasless claims: { claimSigner, recipient, signature } -> { txHash }. See lib/fanout/relayer.ts. */
export async function POST(request: Request) {
  if (config.useMock) return new NextResponse(null, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const txHash = await relayClaim({ claimSigner: body.claimSigner, recipient: body.recipient, signature: body.signature });
    return NextResponse.json({ txHash });
  } catch (err) {
    if (err instanceof RelayError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/claim] relay failed", err);
    return NextResponse.json({ error: "Something went wrong and nothing was claimed." }, { status: 500 });
  }
}
