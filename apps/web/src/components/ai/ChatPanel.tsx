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

import { ChatMarkdown } from "./ChatMarkdown";

type Seed = { sessionId?: string; prompt: string };

/**
 * Suggested follow-ups shown once a session-anchored thread has its first
 * answer. Each is sent as a normal turn but re-supplies the session context so
 * the model can re-read getSessionDetail for the specific follow-up.
 */
const SESSION_FOLLOWUP_CHIPS = [
  "Why this order?",
  "Why so light today?",
  "Why these accessories?",
] as const;
export { SESSION_FOLLOWUP_CHIPS };

/**
 * Build the JSON body for POST /api/ai/chat. `context_session_id` is
 * only present when a session context is supplied (seeded sends), so
 * normal composer sends remain byte-identical to before.
 */
export function buildChatBody(
  threadId: string | null,
  message: string,
  contextSessionId?: string,
): Record<string, unknown> {
  return {
    thread_id: threadId,
    message,
    ...(contextSessionId ? { context_session_id: contextSessionId } : {}),
  };
}

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
  seed,
  starterChips,
}: {
  onClose: () => void;
  seed?: Seed | null;
  starterChips?: { heading: string; prompts: string[] };
}): React.ReactElement {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolIndicator, setToolIndicator] = useState<string | null>(null);
  // The session this thread is anchored to (set by a session-seeded open).
  // While set, follow-up chips appear and each send re-supplies the context so
  // the model can re-read getSessionDetail for follow-ups. Cleared on thread
  // switch / new thread.
  const [contextSessionId, setContextSessionId] = useState<string | undefined>(
    undefined,
  );
  // History panel is hidden by default so the conversation gets the full
  // drawer width; toggled open as an overlay from the header menu button.
  const [historyOpen, setHistoryOpen] = useState(false);
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
    setContextSessionId(undefined);
    setHistoryOpen(false);
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
    setContextSessionId(undefined);
    setHistoryOpen(false);
  }, []);

  const deleteThread = useCallback(
    async (id: string) => {
      // Optimistically drop it from the list; if it was open, reset to a
      // fresh thread.
      setThreads((prev) => prev.filter((t) => t.id !== id));
      setActiveThreadId((cur) => {
        if (cur === id) {
          setMessages([]);
          setContextSessionId(undefined);
          return null;
        }
        return cur;
      });
      try {
        await fetch(`/api/ai/threads/${id}`, { method: "DELETE" });
      } catch {
        /* best-effort; the row is already gone from the UI */
      }
    },
    [],
  );

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(
    async (textArg?: string, contextSessionId?: string) => {
      const text = (textArg ?? input).trim();
      if (!text || sending) return;
      // A seeded / chip send carries the session context; remember it so the
      // follow-up chips show and subsequent sends keep re-supplying it.
      if (contextSessionId) setContextSessionId(contextSessionId);
      // Only clear the composer for a normal composer send; a seeded send
      // carries its own text and must not wipe whatever the user typed.
      if (textArg === undefined) setInput("");
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
          body: JSON.stringify(
            buildChatBody(activeThreadId, text, contextSessionId),
          ),
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
    },
    [activeThreadId, input, sending],
  );

  // Auto-send a seeded question exactly once. New events produce a new
  // `seed` object reference; the ref guards against re-firing when `send`
  // (and thus this effect) re-runs for the same seed.
  const lastSeedRef = useRef<Seed | null>(null);
  useEffect(() => {
    if (!seed || lastSeedRef.current === seed) return;
    lastSeedRef.current = seed;
    void send(seed.prompt, seed.sessionId);
  }, [seed, send]);

  return (
    <div className="cp-ai-overlay" data-testid="ai-chat-panel">
      <div className="cp-ai-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="cp-ai-drawer" role="dialog" aria-label="AI chat">
        <header className="cp-ai-header">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            data-testid="ai-chat-history-toggle"
            className="cp-ai-mini-btn cp-ai-icon-btn"
            aria-label="Conversation history"
            aria-expanded={historyOpen}
            title="History"
          >
            ☰
          </button>
          <div className="cp-ai-header-spacer" />
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
            className="cp-ai-mini-btn cp-ai-icon-btn"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="cp-ai-body">
          {historyOpen ? (
            <div
              className="cp-ai-threads-backdrop"
              onClick={() => setHistoryOpen(false)}
              aria-hidden="true"
            />
          ) : null}
          <aside
            className={`cp-ai-threads ${historyOpen ? "is-open" : ""}`}
            data-testid="ai-chat-thread-list"
            aria-label="Conversation history"
            aria-hidden={!historyOpen}
          >
            <div className="cp-ai-threads-head">History</div>
            {threads.length === 0 ? (
              <p className="cp-ai-empty">No prior conversations.</p>
            ) : (
              threads.map((t) => (
                <div
                  key={t.id}
                  className={`cp-ai-thread-row ${activeThreadId === t.id ? "is-active" : ""}`}
                >
                  <button
                    type="button"
                    className="cp-ai-thread"
                    onClick={() => loadThread(t.id)}
                  >
                    {t.title || "Untitled"}
                  </button>
                  <button
                    type="button"
                    className="cp-ai-thread-del"
                    data-testid="ai-chat-thread-delete"
                    aria-label={`Delete conversation: ${t.title || "Untitled"}`}
                    title="Delete conversation"
                    onClick={() => void deleteThread(t.id)}
                  >
                    ×
                  </button>
                </div>
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
                      {m.role === "assistant" ? (
                        m.content ? (
                          <ChatMarkdown text={m.content} />
                        ) : (
                          "…"
                        )
                      ) : (
                        m.content
                      )}
                    </div>
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

            {contextSessionId && !sending && messages.length > 0 ? (
              <div className="cp-ai-chips" data-testid="ai-chat-followup-chips">
                {SESSION_FOLLOWUP_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="cp-ai-chip"
                    data-testid="ai-chat-followup-chip"
                    onClick={() => void send(chip, contextSessionId)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            ) : !contextSessionId &&
              !sending &&
              messages.length === 0 &&
              starterChips ? (
              <div className="cp-ai-chips" data-testid="ai-chat-starter-chips">
                {starterChips.prompts.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="cp-ai-chip"
                    data-testid="ai-chat-starter-chip"
                    onClick={() => void send(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            ) : null}

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
                placeholder="Ask about your training…"
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
          background: var(--cp-surface);
          color: var(--cp-text);
          display: flex;
          flex-direction: column;
          box-shadow: var(--cp-shadow, -8px 0 24px rgba(0, 0, 0, 0.2));
        }
        .cp-ai-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-bottom: 1px solid var(--cp-border);
        }
        .cp-ai-header-spacer {
          flex: 1;
        }
        .cp-ai-mini-btn {
          background: var(--cp-surface-soft);
          border: 1px solid var(--cp-border);
          color: var(--cp-text);
          padding: 5px 11px;
          border-radius: 8px;
          font-size: 13px;
          line-height: 1;
          cursor: pointer;
        }
        .cp-ai-mini-btn:hover {
          background: var(--cp-bg-elevated, var(--cp-surface-soft));
        }
        .cp-ai-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 30px;
          height: 30px;
          padding: 0;
          font-size: 16px;
        }
        .cp-ai-body {
          flex: 1;
          display: flex;
          min-height: 0;
          position: relative;
          overflow: hidden;
        }
        /* History is an overlay, hidden by default, so the conversation gets the
           full drawer width. It slides in from the left when toggled. */
        .cp-ai-threads-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.35);
          z-index: 2;
        }
        .cp-ai-threads {
          position: absolute;
          top: 0;
          left: 0;
          bottom: 0;
          width: 260px;
          max-width: 80%;
          background: var(--cp-surface);
          border-right: 1px solid var(--cp-border);
          padding: 10px;
          overflow-y: auto;
          z-index: 3;
          transform: translateX(-100%);
          transition: transform 0.16s ease;
          box-shadow: none;
        }
        .cp-ai-threads.is-open {
          transform: translateX(0);
          box-shadow: 8px 0 24px rgba(0, 0, 0, 0.18);
        }
        .cp-ai-threads-head {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--cp-text-muted);
          padding: 2px 6px 8px;
        }
        .cp-ai-thread-row {
          display: flex;
          align-items: center;
          gap: 2px;
          border-radius: 6px;
        }
        .cp-ai-thread-row:hover {
          background: var(--cp-surface-soft);
        }
        .cp-ai-thread-row.is-active {
          background: var(--cp-accent-soft);
        }
        .cp-ai-thread {
          flex: 1;
          min-width: 0;
          text-align: left;
          background: transparent;
          border: none;
          color: var(--cp-text);
          padding: 6px 8px;
          border-radius: 6px;
          font-size: 12px;
          line-height: 1.3;
          cursor: pointer;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cp-ai-thread-row.is-active .cp-ai-thread {
          font-weight: 600;
        }
        .cp-ai-thread-del {
          flex: 0 0 auto;
          background: transparent;
          border: none;
          color: var(--cp-text-muted);
          font-size: 15px;
          line-height: 1;
          padding: 4px 6px;
          border-radius: 6px;
          cursor: pointer;
          opacity: 0;
        }
        .cp-ai-thread-row:hover .cp-ai-thread-del,
        .cp-ai-thread-del:focus {
          opacity: 1;
        }
        .cp-ai-thread-del:hover {
          color: var(--cp-danger, #f87171);
          background: color-mix(in oklab, var(--cp-danger, #dc2626) 14%, transparent);
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
          line-height: 1.5;
          white-space: pre-wrap;
        }
        .cp-ai-msg-user {
          align-self: flex-end;
          background: var(--cp-accent);
          color: var(--cp-accent-fg);
        }
        .cp-ai-msg-assistant {
          align-self: flex-start;
          background: var(--cp-surface-soft);
          color: var(--cp-text);
          border: 1px solid var(--cp-border);
        }
        .cp-ai-msg-body {
          word-break: break-word;
        }
        /* Markdown rendering inside assistant bubbles (ChatMarkdown). */
        .cp-ai-msg-body :global(.md-root) {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cp-ai-msg-body :global(.md-p) {
          margin: 0;
        }
        .cp-ai-msg-body :global(.md-h3) {
          margin: 4px 0 0;
          font-size: 14px;
          font-weight: 700;
          line-height: 1.35;
          color: var(--cp-text);
        }
        .cp-ai-msg-body :global(.md-h4) {
          margin: 2px 0 0;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.35;
          color: var(--cp-text);
        }
        .cp-ai-msg-body :global(.md-ul) {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .cp-ai-msg-body :global(.md-ul li) {
          margin: 0;
        }
        .cp-ai-msg-body :global(.md-hr) {
          border: none;
          border-top: 1px solid var(--cp-border);
          margin: 6px 0 2px;
        }
        .cp-ai-msg-body :global(.md-root strong) {
          font-weight: 700;
          color: var(--cp-text);
        }
        .cp-ai-tool {
          font-size: 12px;
          color: var(--cp-text-muted);
          font-style: italic;
        }
        .cp-ai-error {
          padding: 8px 12px;
          background: color-mix(in oklab, var(--cp-danger, #dc2626) 12%, transparent);
          color: var(--cp-danger, #f87171);
          border: 1px solid color-mix(in oklab, var(--cp-danger, #dc2626) 40%, transparent);
          border-radius: 6px;
          font-size: 13px;
        }
        .cp-ai-empty {
          font-size: 12px;
          color: var(--cp-text-muted);
          margin: 0;
        }
        .cp-ai-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 8px 8px 0;
        }
        .cp-ai-chip {
          background: var(--cp-accent-soft, rgba(99, 102, 241, 0.12));
          border: 1px solid
            color-mix(in oklab, var(--cp-accent, #4f46e5) 40%, transparent);
          color: var(--cp-accent, #4f46e5);
          border-radius: 999px;
          padding: 5px 12px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
        }
        .cp-ai-chip:hover {
          background: color-mix(
            in oklab,
            var(--cp-accent, #4f46e5) 18%,
            transparent
          );
        }
        .cp-ai-composer {
          border-top: 1px solid var(--cp-border);
          padding: 10px 12px;
          display: flex;
          gap: 8px;
          align-items: flex-end;
        }
        .cp-ai-composer textarea {
          flex: 1;
          min-width: 0;
          min-height: 56px;
          max-height: 160px;
          overflow-y: auto;
          resize: none;
          border: 1px solid var(--cp-border);
          border-radius: 10px;
          padding: 10px 12px;
          font: inherit;
          font-size: 14px;
          line-height: 1.45;
          background: var(--cp-surface-soft);
          color: var(--cp-text);
        }
        .cp-ai-composer textarea::placeholder {
          color: var(--cp-text-muted);
        }
        .cp-ai-composer textarea:focus {
          outline: none;
          border-color: var(--cp-accent);
        }
        .cp-ai-send {
          flex: 0 0 auto;
          height: 40px;
          min-width: 64px;
          background: var(--cp-accent);
          color: var(--cp-accent-fg);
          border: none;
          padding: 0 16px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
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

