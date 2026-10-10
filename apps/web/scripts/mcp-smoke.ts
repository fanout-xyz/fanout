// Tries Fanout's MCP server end to end against a local dev server in demo mode
// (NEXT_PUBLIC_USE_MOCK=true, the default): creates an agent key for a demo platform, connects
// an MCP client to /api/mcp with it, asks for a payout, approves it as the platform, and checks
// the payout's status. Prints each step.
//
//   pnpm dev                                   # in another terminal
//   pnpm --filter web mcp-smoke [--url http://localhost:3000] [--email demo@fanout.test]
//
// The demo platform account is derived from the email, the same way the demo sign-in does it
// (lib/auth/mock-account.ts), so you can sign in with that email afterwards and see the payout.

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { keccak256, toBytes, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const base = arg("url", "http://localhost:3000").replace(/\/$/, "");
const email = arg("email", "demo@fanout.test");
const platform = privateKeyToAccount(keccak256(toBytes(`fanout-mock:${email}`)));
const CHAIN_ID = 10143; // Monad testnet
const headers = { "content-type": "application/json", "x-fanout-account": platform.address, "x-fanout-email": email };

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${res.status} ${json.error ?? ""}`);
  return json;
}

const step = (title: string, value?: unknown) => console.log(`\n== ${title}${value === undefined ? "" : `\n${JSON.stringify(value, null, 2)}`}`);

// 1. Test dollars and an agent key with a signed policy (mirrors lib/agents/policy.ts).
await fetch(`${base}/api/mock`, { method: "POST", headers, body: JSON.stringify({ method: "deposit", account: platform.address, args: [{ __big: "200000000" }] }) });
const now = BigInt(Math.floor(Date.now() / 1000));
const policy = {
  platform: platform.address,
  keyId: toHex(crypto.getRandomValues(new Uint8Array(32))) as Hex,
  label: "Smoke test agent",
  perPayoutCap: 50_000_000n,
  dailyCap: 100_000_000n,
  maxPeople: 3,
  allowlist: ["@example.com"],
  expiresAt: now + 86_400n,
  version: 1,
};
const signature = await platform.signTypedData({
  domain: { name: "Fanout Agent Policy", version: "1", chainId: CHAIN_ID },
  types: {
    AgentPolicy: [
      { name: "platform", type: "address" },
      { name: "keyId", type: "bytes32" },
      { name: "label", type: "string" },
      { name: "perPayoutCap", type: "uint256" },
      { name: "dailyCap", type: "uint256" },
      { name: "maxPeople", type: "uint16" },
      { name: "allowlist", type: "string[]" },
      { name: "expiresAt", type: "uint64" },
      { name: "version", type: "uint32" },
    ],
  },
  primaryType: "AgentPolicy",
  message: policy,
});
const policyJson = { ...policy, perPayoutCap: String(policy.perPayoutCap), dailyCap: String(policy.dailyCap), expiresAt: String(policy.expiresAt) };
const { token } = await api<{ token: string }>("/api/agents/keys", { policy: policyJson, signature });
step(`Agent key created for ${platform.address} (…${token.slice(-4)})`);

// 2. The agent connects over Streamable HTTP with its key.
const client = new Client({ name: "fanout-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
step("Tools", (await client.listTools()).tools.map((t) => t.name));
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  step(`${name}${r.isError ? " (error)" : ""}`, r.structuredContent ?? (r.content as { text?: string }[])[0]?.text);
  return r.structuredContent as Record<string, unknown>;
};
await call("get_policy");
await call("get_balance");
await call("create_payout", { rows: [{ email: "ana@example.com", amount: "12.50" }, { email: "bo@example", amount: 3 }] });
const within = await call("create_payout", { rows: [{ email: "ana@example.com", amount: "12.50", note: "Thanks!" }, { email: "bo@example.com", amount: "7.50" }], memo: "Smoke test" });
await call("create_payout", { rows: [{ email: "eve@elsewhere.org", amount: "60.00" }], memo: "Over the limits on purpose" });

// 3. The platform approves: fetch the CreateBatch, sign it, submit.
const id = String(within.payout_request_id);
const a = await api<{ chainId: number; batchPayout: Hex; platform: Hex; claimSigners: Hex[]; amounts: string[]; emailHashes: Hex[]; claimWindow: string; nonce: Hex; deadline: string }>(
  `/api/agents/requests/${id}/authorize`,
  {},
);
const batchSig = await platform.signTypedData({
  domain: { name: "Fanout BatchPayout", version: "1", chainId: a.chainId, verifyingContract: a.batchPayout },
  types: {
    CreateBatch: [
      { name: "platform", type: "address" },
      { name: "claimSigners", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "emailHashes", type: "bytes32[]" },
      { name: "claimWindow", type: "uint64" },
      { name: "nonce", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "CreateBatch",
  message: { ...a, amounts: a.amounts.map(BigInt), claimWindow: BigInt(a.claimWindow), deadline: BigInt(a.deadline) },
});
step("Platform approved", await api(`/api/agents/requests/${id}/approve`, { signature: batchSig }));

// 4. The agent follows up.
await call("get_payout_status", { id });
await call("list_payouts", { limit: 5 });
await call("return_unclaimed", { id });
await client.close();
