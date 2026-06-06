"use client";

/**
 * AskWhyButton — session-page entry point into the AI chat.
 *
 * Matches the app's accent-green ✦ "why" affordance (see MetricHelp's
 * `variant="why"`). When AI is enabled the button dispatches a
 * `"sxc:ask-coach"` CustomEvent that ChatRoot listens for; it opens the
 * chat and auto-sends the prompt with this session as context. When AI
 * is NOT enabled the same-looking control links to `/app/settings/ai`
 * (the value proposition lives on that page).
 */
import Link from "next/link";

import { ASK_COACH_EVENT } from "@/components/ai/ChatRoot";

const SPARK_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 10px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: "nowrap",
  background: "var(--cp-accent-soft)",
  border: "1px solid color-mix(in oklab, var(--cp-accent) 40%, transparent)",
  color: "var(--cp-accent)",
  cursor: "pointer",
  textDecoration: "none",
  fontFamily: "inherit",
};

const LABEL = "Ask why this workout";

export function AskWhyButton({
  sessionId,
  href,
  prompt = "Why is this workout programmed the way it is?",
}: {
  sessionId?: string;
  href?: string;
  prompt?: string;
}): React.ReactElement {
  if (href) {
    return (
      <Link href={href} data-testid="session-ask-why" style={SPARK_STYLE}>
        <span aria-hidden="true">✦</span> {LABEL}
      </Link>
    );
  }
  return (
    <button
      type="button"
      data-testid="session-ask-why"
      style={SPARK_STYLE}
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent(ASK_COACH_EVENT, {
            detail: { sessionId, prompt },
          }),
        );
      }}
    >
      <span aria-hidden="true">✦</span> {LABEL}
    </button>
  );
}
