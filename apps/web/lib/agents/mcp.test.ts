import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { platformAccount, policy, signedPolicyBody, world } from "@/test/agents";
import { serveMcp } from "./mcp";
import { createAgentKey, setAgentPaused } from "./service";

const URL_ = new URL("https://fanout.test/api/mcp");

async function connect(token?: string) {
  const w = world({ balance: "500" });
  const p = policy({}, w.nowSeconds());
  const created = await createAgentKey(w.deps, platformAccount.address, await signedPolicyBody(p));
  const bearer = token ?? created.token;
  // The client talks to serveMcp directly, the same function /api/mcp runs.
  const transport = new StreamableHTTPClientTransport(URL_, {
    requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    fetch: (input, init) => serveMcp(w.deps, new Request(input, init)),
  });
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(transport);
  return { client, ...w, p };
}

type Structured = Record<string, unknown> & { problems?: { row: number; problems: string[] }[] };
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, data: r.structuredContent as Structured, text: (r.content as { text: string }[])[0]?.text };
};

describe("Fanout MCP server", () => {
  it("lists the seven tools with descriptions written for models", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["create_payout", "get_balance", "get_payout_status", "get_policy", "list_payouts", "return_unclaimed", "send_reminders"].sort(),
    );
    const create = tools.find((t) => t.name === "create_payout")!;
    expect(create.description).toMatch(/approval_url/);
    expect(JSON.stringify(create.inputSchema)).toMatch(/two decimals/);
    expect(client.getInstructions()).toMatch(/never numbers/);
  });

  it("creates a payout request that needs approval, with structured output", async () => {
    const { client } = await connect();
    const r = await call(client, "create_payout", {
      rows: [
        { email: "ana@example.com", amount: "12.50", note: "Thanks!" },
        { email: "bo@example.com", amount: "7.50" },
      ],
      memo: "Weekly bounties",
    });
    expect(r.isError).toBe(false);
    expect(r.data).toMatchObject({ status: "approval_needed", within_policy: true, total: "20.00", people: 2, currency: "USD" });
    expect(String(r.data.approval_url)).toMatch(/^https:\/\/fanout\.test\/dashboard\/agents\/approvals\/req_/);
    expect(JSON.parse(r.text)).toEqual(r.data);

    const status = await call(client, "get_payout_status", { id: r.data.payout_request_id as string });
    expect(status.data).toMatchObject({ status: "approval_needed", rows: [{ email: "ana@example.com", amount: "12.50", status: "not_sent_yet" }, { email: "bo@example.com" }] });
    const list = await call(client, "list_payouts", { status: "approval_needed" });
    expect(list.data.count).toBe(1);
  });

  it("returns row-by-row problems as a tool error", async () => {
    const { client } = await connect();
    const r = await call(client, "create_payout", { rows: [{ email: "ana@example", amount: "12.5" }, { email: "bo@example.com", amount: "0.00" }] });
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("invalid_input");
    expect(r.data.problems?.map((p) => p.row)).toEqual([1, 2]);
  });

  it("rejects input that doesn't match the schema (amount as a number)", async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: "create_payout", arguments: { rows: [{ email: "a@example.com", amount: 12.5 }] } }).catch((e: Error) => ({ isError: true, content: [{ text: e.message }] }));
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/amount/);
  });

  it("explains the policy and balance in dollars", async () => {
    const { client } = await connect();
    expect((await call(client, "get_policy")).data).toMatchObject({ status: "active", per_payout_limit: "100.00", daily_limit: "250.00", max_people_per_payout: 5 });
    expect((await call(client, "get_balance")).data).toMatchObject({ available: "500.00", currency: "USD" });
  });

  it("explains a paused key instead of paying", async () => {
    const { client, deps, p } = await connect();
    await setAgentPaused(deps, platformAccount.address, p.keyId, true);
    const r = await call(client, "create_payout", { rows: [{ email: "a@example.com", amount: "1.00" }] });
    expect(r).toMatchObject({ isError: true, data: { code: "key_blocked" } });
    expect(r.data.error).toMatch(/paused/);
  });

  it("answers 401 without a valid agent key", async () => {
    const w = world();
    const res = await serveMcp(w.deps, new Request(URL_, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
    const bad = await serveMcp(
      w.deps,
      new Request(URL_, { method: "POST", body: "{}", headers: { authorization: `Bearer fo_agent_${"x".repeat(43)}` } }),
    );
    expect(bad.status).toBe(401);
  });
});
