"use client";

/**
 * ChatPanel — right-side drawer that hosts the Explain v1 chat.
 *
 * Responsibilities:
 *   - Load + display thread list (collapsible left rail; hidden on
 *     mobile by default).
 *   - Load + display messages for the active thread.
 *   - Send a new message: POST /api/ai/chat, parse SSE frames as they
 *     arrive, append text deltas to the in-progress assistant bubble,
 *     surface tool-call indicators, surface errors as a soft banner.
 *   - On `done`, persist the final usage in the in-memory message
 *     state so the token-cost surface can render.
 *
 * Streaming consumption: the server returns an `event: <name>\ndata:
 * <json>\n\n` body. We read the body via `fetch().then(r =>
 * r.body.getReader())` because the native EventSource API doesn't
 * support POST.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type ThreadRow = {
  id: string;
  title: string | null;
  updated_at: string;
};

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  content: string;
  /** Set once the streaming `done` event has surfaced usage. */
  usage?: { input_tokens: number; output_tokens: number };
  toolCalls?: Array<{ id: string; name: string }>;
};

type StreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_end"; id: string }
  | {
      type: "done";
      usage: { input_tokens: number; output_tokens: number };
      thread_id: string;
      message_id: string;
    }
  | { type: "error"; errorCode: string; message: string };

export function ChatPanel({
  onClose,
}: {
  onClose: () => void;
}): React.ReactElement {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolIndicator, setToolIndicator] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Initial thread list fetch.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/ai/threads");
        const json = (await r.json()) as { threads?: ThreadRow[] };
        if (!cancelled) setThreads(json.threads ?? []);
      } catch {
        /* ignore — empty thread list is fine */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadThread = useCallback(async (id: string) => {
    setActiveThreadId(id);
    setMessages([]);
    setError(null);
    try {
      const r = await fetch(`/api/ai/threads/${id}/messages`);
      const json = (await r.json()) as {
        messages?: Array<{
          id: string;
          role: string;
          content: string | null;
        }>;
      };
      const rows = (json.messages ?? []).filter(
        (m) => m.role === "user" || m.role === "assistant",
      );
      setMessages(
        rows.map((m) => ({
          id: m.id,
          role: m.role as Role,
          content: m.content ?? "",
        })),
      );
    } catch {
      /* ignore */
    }
  }, []);

  const newThread = useCallback(() => {
    setActiveThreadId(null);
    setMessages([]);
    setError(null);
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setError(null);
    setSending(true);
    setToolIndicator(null);

    const userMsg: Message = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
    };
    const assistantMsg: Message = {
      id: `local-assistant-${Date.now()}`,
      role: "assistant",
      content: "",
      toolCalls: [],
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: activeThreadId, message: text }),
      });

      if (!r.ok || !r.body) {
        let errText = "Couldn't reach the AI service.";
        try {
          const e = (await r.json()) as { errors?: string[] };
          if (e.errors?.[0]) errText = e.errors[0];
        } catch {
          /* keep default */
        }
        setError(errText);
        setSending(false);
        return;
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const evt = parseFrame(frame);
          if (!evt) continue;
          applyStreamEvent(
            evt,
            assistantMsg.id,
            setMessages,
            setActiveThreadId,
            setToolIndicator,
            setError,
          );
        }
      }
    } catch (err) {
      setError("Network error talking to the AI service.");
      console.warn("chat send failed", (err as Error).message);
    } finally {
      setSending(false);
      setToolIndicator(null);
    }
  }, [activeThreadId, input, sending]);

  return (
    <div className="cp-ai-overlay" data-testid="ai-chat-panel">
      <div className="cp-ai-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="cp-ai-drawer" role="dialog" aria-label="AI chat">
        <header className="cp-ai-header">
          <div className="cp-ai-title">AI</div>
          <button
            type="button"
            onClick={newThread}
            data-testid="ai-chat-new-thread"
            className="cp-ai-mini-btn"
          >
            New
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="ai-chat-close"
            className="cp-ai-mini-btn"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="cp-ai-body">
          <aside
            className="cp-ai-threads"
            data-testid="ai-chat-thread-list"
            aria-label="Threads"
          >
            {threads.length === 0 ? (
              <p className="cp-ai-empty">No prior conversations.</p>
            ) : (
              threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`cp-ai-thread ${activeThreadId === t.id ? "is-active" : ""}`}
                  onClick={() => loadThread(t.id)}
                >
                  {t.title || "Untitled"}
                </button>
              ))
            )}
          </aside>

          <section className="cp-ai-conversation">
            <div
              ref={listRef}
              className="cp-ai-messages"
              data-testid="ai-chat-message-list"
            >
              {messages.length === 0 ? (
                <p className="cp-ai-empty">
                  Ask anything about your training. The AI can read your
                  data but can&apos;t change it.
                </p>
              ) : (
                messages.map((m, idx) => (
                  <article
                    key={m.id}
                    className={`cp-ai-msg cp-ai-msg-${m.role}`}
                    data-testid={`ai-chat-message-${m.role}-${idx}`}
                  >
                    <div className="cp-ai-msg-body">
                      {m.content || (m.role === "assistant" ? "…" : "")}
                    </div>
                    {m.role === "assistant" && m.usage ? (
                      <div
                        className="cp-ai-tokens"
                        data-testid="ai-chat-token-cost"
                      >
                        ≈ {formatTokens(m.usage.input_tokens)} input +{" "}
                        {formatTokens(m.usage.output_tokens)} output tokens
                      </div>
                    ) : null}
                  </article>
                ))
              )}
              {toolIndicator ? (
                <div
                  className="cp-ai-tool"
                  data-testid="ai-chat-tool-indicator"
                >
                  Reading your training data…
                </div>
              ) : null}
              {error ? (
                <div
                  className="cp-ai-error"
                  role="alert"
                  data-testid="ai-chat-error-banner"
                >
                  {error}
                </div>
              ) : null}
            </div>

            <div className="cp-ai-composer">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Why is my ceiling compressed this week?"
                rows={2}
                data-testid="ai-chat-input"
                disabled={sending}
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || input.trim().length === 0}
                data-testid="ai-chat-send"
                className="cp-ai-send"
              >
                {sending ? "…" : "Send"}
              </button>
            </div>
          </section>
        </div>
      </aside>

      <style jsx>{`
        .cp-ai-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
        }
        .cp-ai-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.35);
        }
        .cp-ai-drawer {
          position: absolute;
          right: 0;
          top: 0;
          bottom: 0;
          width: 100%;
          max-width: 420px;
          background: var(--cp-bg, #fff);
          color: var(--cp-fg, #111);
          display: flex;
          flex-direction: column;
          box-shadow: -8px 0 24px rgba(0, 0, 0, 0.2);
        }
        .cp-ai-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }
        .cp-ai-title {
          flex: 1;
          font-weight: 600;
        }
        .cp-ai-mini-btn {
          background: transparent;
          border: 1px solid rgba(0, 0, 0, 0.12);
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
        }
        .cp-ai-body {
          flex: 1;
          display: flex;
          min-height: 0;
        }
        .cp-ai-threads {
          width: 140px;
          border-right: 1px solid rgba(0, 0, 0, 0.08);
          padding: 8px;
          overflow-y: auto;
          display: none;
        }
        @media (min-width: 768px) {
          .cp-ai-threads {
            display: block;
          }
        }
        .cp-ai-thread {
          display: block;
          width: 100%;
          text-align: left;
          background: transparent;
          border: none;
          padding: 6px 8px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
        }
        .cp-ai-thread:hover {
          background: rgba(0, 0, 0, 0.04);
        }
        .cp-ai-thread.is-active {
          background: rgba(0, 0, 0, 0.08);
          font-weight: 600;
        }
        .cp-ai-conversation {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .cp-ai-messages {
          flex: 1;
          padding: 12px 16px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cp-ai-msg {
          max-width: 90%;
          padding: 8px 12px;
          border-radius: 12px;
          font-size: 14px;
          line-height: 1.45;
          white-space: pre-wrap;
        }
        .cp-ai-msg-user {
          align-self: flex-end;
          background: var(--cp-accent, #4f46e5);
          color: white;
        }
        .cp-ai-msg-assistant {
          align-self: flex-start;
          background: rgba(0, 0, 0, 0.05);
        }
        .cp-ai-msg-body {
          word-break: break-word;
        }
        .cp-ai-tokens {
          font-size: 11px;
          opacity: 0.6;
          margin-top: 4px;
        }
        .cp-ai-tool {
          font-size: 12px;
          opacity: 0.7;
          font-style: italic;
        }
        .cp-ai-error {
          padding: 8px 12px;
          background: rgba(220, 38, 38, 0.08);
          color: #b91c1c;
          border-radius: 6px;
          font-size: 13px;
        }
        .cp-ai-empty {
          font-size: 12px;
          opacity: 0.6;
          margin: 0;
        }
        .cp-ai-composer {
          border-top: 1px solid rgba(0, 0, 0, 0.08);
          padding: 8px;
          display: flex;
          gap: 8px;
        }
        .cp-ai-composer textarea {
          flex: 1;
          resize: none;
          border: 1px solid rgba(0, 0, 0, 0.12);
          border-radius: 6px;
          padding: 6px 8px;
          font: inherit;
          background: transparent;
          color: inherit;
        }
        .cp-ai-send {
          background: var(--cp-accent, #4f46e5);
          color: white;
          border: none;
          padding: 0 14px;
          border-radius: 6px;
          font-weight: 500;
          cursor: pointer;
        }
        .cp-ai-send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

function parseFrame(frame: string): StreamEvent | null {
  const lines = frame.split("\n");
  let type = "";
  let dataStr = "";
  for (const line of lines) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
  }
  if (!type || !dataStr) return null;
  try {
    const data = JSON.parse(dataStr) as Record<string, unknown>;
    return { ...data, type } as StreamEvent;
  } catch {
    return null;
  }
}

function applyStreamEvent(
  evt: StreamEvent,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>,
  setToolIndicator: React.Dispatch<React.SetStateAction<string | null>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
): void {
  if (evt.type === "text_delta") {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, content: m.content + evt.delta } : m,
      ),
    );
  } else if (evt.type === "tool_call_start") {
    setToolIndicator(evt.name);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? {
              ...m,
              toolCalls: [
                ...(m.toolCalls ?? []),
                { id: evt.id, name: evt.name },
              ],
            }
          : m,
      ),
    );
  } else if (evt.type === "tool_call_end") {
    setToolIndicator(null);
  } else if (evt.type === "done") {
    setActiveThreadId(evt.thread_id);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, usage: evt.usage } : m,
      ),
    );
  } else if (evt.type === "error") {
    setError(evt.message);
  }
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
