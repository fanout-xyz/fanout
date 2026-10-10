"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CopyBlock } from "./copy-block";

const subscribeNoop = () => () => {};
const PLACEHOLDER = "<your agent key>";

const TABS = ["Claude Code", "Cursor", "Claude Desktop", "OpenAI"] as const;
type Tab = (typeof TABS)[number];

/** Config snippets for the agent's MCP client, with the key filled in when it was just created. */
export function ConnectAgent({ token }: { token?: string }) {
  const origin = useSyncExternalStore(subscribeNoop, () => window.location.origin, () => "https://fanout.tech");
  const [tab, setTab] = useState<Tab>("Claude Code");
  const url = `${origin}/api/mcp`;
  const key = token ?? PLACEHOLDER;
  const auth = `Bearer ${key}`;

  const snippets: Record<Tab, { label: string; code: string; note?: string }> = {
    "Claude Code": {
      label: "Run in a terminal",
      code: `claude mcp add --transport http fanout ${url} \\\n  --header "Authorization: ${auth}"`,
    },
    Cursor: {
      label: "~/.cursor/mcp.json",
      code: JSON.stringify({ mcpServers: { fanout: { url, headers: { Authorization: auth } } } }, null, 2),
    },
    "Claude Desktop": {
      label: "claude_desktop_config.json",
      code: JSON.stringify(
        { mcpServers: { fanout: { command: "npx", args: ["-y", "mcp-remote", url, "--header", `Authorization:${auth}`] } } },
        null,
        2,
      ),
      note: "Claude Desktop reaches remote servers through mcp-remote. Restart Claude after saving.",
    },
    OpenAI: {
      label: "Responses API tool",
      code: JSON.stringify({ type: "mcp", server_label: "fanout", server_url: url, headers: { Authorization: auth }, require_approval: "never" }, null, 2),
      note: "ChatGPT's own connectors sign in with OAuth, which agent keys don't use yet; agents built on the OpenAI API can use this.",
    },
  };
  const s = snippets[tab];
  const cursorLink = token
    ? `cursor://anysphere.cursor-deeplink/mcp/install?name=fanout&config=${encodeURIComponent(btoa(JSON.stringify({ url, headers: { Authorization: auth } })))}`
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Agent app" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-sm px-3 py-1.5 text-sm font-semibold transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === t ? "bg-primary/10 text-primary" : "text-muted hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <CopyBlock label={s.label} code={s.code} />
      {s.note && <p className="text-sm text-muted">{s.note}</p>}
      {tab === "Cursor" && cursorLink && (
        <Button asChild variant="secondary" size="sm" className="self-start">
          <a href={cursorLink}>Add to Cursor</a>
        </Button>
      )}
      {!token && <p className="text-sm text-muted">Replace {PLACEHOLDER} with the key you saved when you created it.</p>}
    </div>
  );
}

/** How an agent with no Fanout account pays people: x402 at /api/x402/payout. */
export function X402Example() {
  const origin = useSyncExternalStore(subscribeNoop, () => window.location.origin, () => "https://fanout.tech");
  const code = `curl -i -X POST ${origin}/api/x402/payout \\
  -H "content-type: application/json" \\
  -H "Idempotency-Key: payout-0001" \\
  -d '{"rows":[{"email":"ana@example.com","amount":"25.00","note":"Thanks!"}]}'`;
  return (
    <div className="flex flex-col gap-3">
      <CopyBlock label="Ask for the price" code={code} />
      <p className="text-sm text-muted">
        The answer is a 402 with the price: the payout plus a small fee, in USDC on Monad. An x402 client (for example{" "}
        <code className="font-mono text-xs">@x402/fetch</code>) signs it and sends the same request again with the payment. The
        response has the payout number and a link to check who has claimed. Use the same Idempotency-Key on the retry; it&apos;s
        never charged twice.
      </p>
    </div>
  );
}
