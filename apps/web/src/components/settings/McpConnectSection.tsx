"use client";

/**
 * Settings → AI → "Connect via MCP" section. ADR 0003 §"Settings → AI
 * dual-path UI".
 *
 * Shows the user the MCP server URL with a Copy button and a
 * collapsible block of per-client connect instructions (Claude
 * Desktop, ChatGPT, Cursor). The BYOAI section below this one stays
 * exactly as it was in PR #191 — the canonical "Bank-level encryption"
 * copy is not edited here.
 *
 * Instruction copy mirrors each AI tool's current public docs at the
 * time of authoring (May 2026):
 *   - Claude Desktop custom connectors:
 *     https://support.anthropic.com/en/articles/11175166-about-custom-connectors-using-remote-mcp
 *   - ChatGPT custom connectors (Plus / Pro / Business):
 *     https://help.openai.com/en/articles/11487775-connectors-in-chatgpt
 *   - Cursor MCP integration:
 *     https://docs.cursor.com/context/model-context-protocol
 */

import { useState } from "react";

type ClientKey = "claude" | "chatgpt" | "cursor";

const CLIENT_INSTRUCTIONS: Array<{
  key: ClientKey;
  title: string;
  href: string;
  steps: string[];
}> = [
  {
    key: "claude",
    title: "Claude Desktop / Claude.ai (Pro or Max)",
    href: "https://support.anthropic.com/en/articles/11175166-about-custom-connectors-using-remote-mcp",
    steps: [
      "Open Claude → Settings → Connectors.",
      "Click \"Add custom connector\" and paste the MCP server URL above.",
      "Sign in with your S×C account when Claude redirects you.",
      "Approve the requested scope (read-only access to your training data).",
      "The 8 tools appear in Claude's tool list — start a chat and ask about your training.",
    ],
  },
  {
    key: "chatgpt",
    title: "ChatGPT (Plus, Pro, or Business)",
    href: "https://help.openai.com/en/articles/11487775-connectors-in-chatgpt",
    steps: [
      "Open ChatGPT → Settings → Connectors → Custom connectors.",
      "Click \"Create\" and paste the MCP server URL above.",
      "Complete the sign-in + consent flow when ChatGPT redirects you.",
      "Pin the connector to your sidebar so it's available in new chats.",
    ],
  },
  {
    key: "cursor",
    title: "Cursor",
    href: "https://docs.cursor.com/context/model-context-protocol",
    steps: [
      "Open Cursor → Settings → MCP.",
      "Add a new MCP server with the URL above (transport: streamable-http).",
      "Authenticate with your S×C account when prompted.",
      "The catalogue's tools appear in Cursor's tool picker — invoke them from chat.",
    ],
  },
];

function defaultMcpUrl(): string {
  if (typeof window === "undefined") return "/mcp";
  return `${window.location.origin}/mcp`;
}

export function McpConnectSection({
  serverUrl,
}: {
  serverUrl?: string;
}): React.ReactElement {
  // Lazy initializer reads window.location.origin once on mount —
  // safer than a useEffect+setState because it never triggers a
  // cascading re-render. SSR returns "/mcp" which the client replaces
  // on the first render after hydration.
  const [url] = useState<string>(() => serverUrl ?? defaultMcpUrl());
  const [copied, setCopied] = useState(false);
  const [openClient, setOpenClient] = useState<ClientKey | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="space-y-4"
      data-testid="ai-mcp-section"
      aria-labelledby="ai-mcp-heading"
    >
      <header className="space-y-1">
        <h2
          id="ai-mcp-heading"
          className="text-sm font-semibold"
        >
          Connect via MCP (recommended for ChatGPT Plus / Claude Pro)
        </h2>
        <p className="text-xs text-foreground/60">
          Bring your training context into the AI tool you already use.
          Read-only access; your AI provider key stays in your AI tool — it
          never reaches our database.
        </p>
      </header>

      <div className="space-y-2">
        <label className="block text-xs text-foreground/70" htmlFor="ai-mcp-url-input">
          MCP server URL
        </label>
        <div className="flex gap-2">
          <input
            id="ai-mcp-url-input"
            type="text"
            value={url}
            readOnly
            data-testid="ai-mcp-url"
            className="flex-1 rounded border border-foreground/10 bg-transparent p-2 text-xs font-mono"
          />
          <button
            type="button"
            onClick={copy}
            data-testid="ai-mcp-copy"
            className="rounded border border-foreground/10 px-3 py-1 text-xs hover:bg-foreground/5"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-foreground/70">
          Per-AI-tool setup
        </p>
        {CLIENT_INSTRUCTIONS.map((c) => {
          const isOpen = openClient === c.key;
          return (
            <div
              key={c.key}
              className="rounded border border-foreground/10"
              data-testid={`ai-mcp-client-${c.key}`}
            >
              <button
                type="button"
                onClick={() => setOpenClient(isOpen ? null : c.key)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-foreground/5"
                data-testid={`ai-mcp-client-${c.key}-toggle`}
              >
                <span>{c.title}</span>
                <span className="text-foreground/50">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 space-y-2 text-xs text-foreground/75">
                  <ol className="list-decimal pl-4 space-y-1">
                    {c.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  <p>
                    <a
                      href={c.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      data-testid={`ai-mcp-client-${c.key}-doc-link`}
                    >
                      Official docs
                    </a>
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-foreground/55 leading-relaxed">
        Tokens expire after 1 hour. Re-authorise from your AI tool&apos;s
        connector settings when prompted.
      </p>
    </div>
  );
}
