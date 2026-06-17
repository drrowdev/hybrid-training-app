/**
 * AiBenefits — the "why connect your own AI / MCP" value proposition shown at
 * the top of Settings → AI. This is the destination the in-app "Ask why ✦"
 * controls route to when a user hasn't connected AI yet, so it has to make the
 * case plainly and honestly: what it unlocks, the privacy posture, and the cost
 * model.
 *
 * Server-safe — inline `--cp-*` tokens, no client hooks.
 */
import type { ReactElement, ReactNode } from "react";

function Item({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <li style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1.5 }}>
        {emoji}
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.5 }}>
        <strong style={{ color: "var(--cp-text)" }}>{title}</strong>{" "}
        <span style={{ color: "var(--cp-text-muted)" }}>{children}</span>
      </span>
    </li>
  );
}

function Group({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--cp-text-muted)",
        }}
      >
        {heading}
      </div>
      <ul style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
        {children}
      </ul>
    </div>
  );
}

export function AiBenefits(): ReactElement {
  return (
    <section
      className="cp-card"
      data-testid="ai-benefits"
      style={{ padding: 20, display: "grid", gap: 18 }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--cp-text)" }}>
          Why connect your own AI?
        </h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--cp-text-muted)" }}>
          The app already decides what you train and why. Connecting an AI
          adds a coach you can talk to — it reads that reasoning and explains it
          in plain language, grounded in your own data.
        </p>
      </div>

      <Group heading="What you can do">
        <Item emoji="✦" title="Ask “why” about any workout.">
          Tap “Ask why” on a session and get the real reason it’s programmed the
          way it is — your training max, the loading wave, today’s readiness, the
          specific accessories — connected to your goal and where you are in the
          block, not a canned blurb.
        </Item>
        <Item emoji="💬" title="Ask follow-ups.">
          “Why this order?”, “Why so light today?”, “Why these accessories?” —
          and keep digging in the same conversation.
        </Item>
        <Item emoji="📈" title="Explore your trends.">
          Ask about your PRs, adherence, recovery, and how a lift has moved over
          weeks or months — answered from your logged data.
        </Item>
        <Item emoji="🔌" title="Use it from your own tools (MCP).">
          Connect Claude, ChatGPT, or Cursor to the same read-only data through
          MCP, instead of (or alongside) an in-app key.
        </Item>
      </Group>

      <Group heading="Your privacy & control">
        <Item emoji="🔑" title="Bring your own key.">
          Anthropic, OpenAI, or Gemini. Your key is encrypted in a vault, used
          only server-side, and never shown to anyone — including us.
        </Item>
        <Item emoji="🛡️" title="Read-only, always.">
          The AI can read your training data but cannot change your plan, edit a
          workout, or log anything. There are no write tools.
        </Item>
        <Item emoji="🙈" title="We don’t log your conversations.">
          Only metadata (timing, which data tool ran, token counts) is recorded
          — never your messages, the AI’s replies, or your training data.
        </Item>
      </Group>

      <Group heading="Cost">
        <Item emoji="💸" title="You pay your provider directly.">
          Usage is billed by your AI provider against your own key — the app adds
          no markup. A soft limit of ~60 messages per hour keeps runaway use in
          check.
        </Item>
      </Group>
    </section>
  );
}
