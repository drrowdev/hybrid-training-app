"use client";

/**
 * ChatRoot — client island that owns the open/closed state for the
 * chat surface. Renders the FAB and (when open) the ChatPanel.
 *
 * Split from ChatMount so the server-side access check stays out of
 * the client bundle.
 *
 * Pre-seed: any in-app surface (e.g. the session page "Ask why"
 * affordance) can open the chat with a question already in flight by
 * dispatching a `"sxc:ask-coach"` CustomEvent on `window`. The detail
 * carries an optional `sessionId` (forwarded to the API as
 * `context_session_id`) and a `prompt` rendered as the user message.
 */
import { useEffect, useState } from "react";

import { ChatFab } from "./ChatFab";
import { ChatPanel } from "./ChatPanel";

export type AskCoachSeed = { sessionId?: string; prompt: string };

export const ASK_COACH_EVENT = "sxc:ask-coach";

/**
 * Validate a `sxc:ask-coach` event detail into a seed. Returns null for
 * anything missing a non-empty `prompt` so a malformed dispatch can't
 * open the panel with an empty message. Exported for unit testing the
 * wiring without a DOM.
 */
export function parseAskCoachEvent(detail: unknown): AskCoachSeed | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as { sessionId?: unknown; prompt?: unknown };
  if (typeof d.prompt !== "string" || d.prompt.trim() === "") return null;
  const sessionId = typeof d.sessionId === "string" ? d.sessionId : undefined;
  return { sessionId, prompt: d.prompt };
}

export function ChatRoot(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<AskCoachSeed | null>(null);

  useEffect(() => {
    function onAskCoach(e: Event): void {
      const next = parseAskCoachEvent((e as CustomEvent).detail);
      if (!next) return;
      setSeed(next);
      setOpen(true);
    }
    window.addEventListener(ASK_COACH_EVENT, onAskCoach as EventListener);
    return () => {
      window.removeEventListener(ASK_COACH_EVENT, onAskCoach as EventListener);
    };
  }, []);

  return (
    <>
      <ChatFab onClick={() => setOpen(true)} />
      {open ? <ChatPanel onClose={() => setOpen(false)} seed={seed} /> : null}
    </>
  );
}
