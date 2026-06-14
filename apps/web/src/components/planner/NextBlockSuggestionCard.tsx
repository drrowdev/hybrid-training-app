import Link from "next/link";
import type { NextBlockSuggestion } from "@/lib/planner/next-block-suggestion";

/**
 * Presentational card for the next-block nudge (ADR 0010). Pure RSC — no
 * hooks, no client state. The same component renders in two contexts:
 *   - /app/plan (no active block): plain advice above the wizard, no CTA.
 *   - /app (Today, final week): the same advice with a "plan your next
 *     block" link, surfaced BEFORE the user leaves the block, so the
 *     guidance reaches them at the decision point rather than only after.
 *
 * Single source of truth for the nudge's copy and styling so the two
 * surfaces never drift.
 */
export type NextBlockNudgeView = {
  suggestion: NextBlockSuggestion | null;
  realization: { reason: string } | null;
};

export function NextBlockSuggestionCard({
  nudge,
  eyebrow = "Suggested next focus",
  suggestionTail = "It\u2019s only a suggestion.",
  cta,
  testId,
}: {
  nudge: NextBlockNudgeView;
  /** Small uppercase label above the heading. */
  eyebrow?: string;
  /** Trailing sentence after the suggestion reason. */
  suggestionTail?: string;
  /** Optional link rendered at the foot of the card. */
  cta?: { href: string; label: string };
  testId?: string;
}) {
  const { suggestion, realization } = nudge;
  if (!suggestion && !realization) return null;
  const suggestedName = suggestion ? suggestion.programName : null;
  return (
    <section
      className="cp-card"
      data-testid={testId}
      style={{
        padding: 20,
        display: "grid",
        gap: 12,
        borderColor: "var(--cp-accent)",
        background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontSize: 20, lineHeight: 1 }} aria-hidden="true">→</div>
        <div style={{ display: "grid", gap: 4, flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--cp-accent)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            {eyebrow}
          </div>
          {suggestion && (
            <>
              <h2 style={{ fontSize: 18, margin: 0, letterSpacing: "-0.01em" }}>
                Consider a {suggestedName} block next
              </h2>
              <p
                style={{
                  margin: 0,
                  color: "var(--cp-text-muted)",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {suggestion.reason} {suggestionTail}
              </p>
            </>
          )}
          {realization && (
            <p
              style={{
                margin: suggestion ? "4px 0 0" : 0,
                color: "var(--cp-text-muted)",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {realization.reason}
            </p>
          )}
          {cta && (
            <Link
              href={cta.href}
              data-testid={testId ? `${testId}-cta` : undefined}
              style={{
                marginTop: 4,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--cp-accent)",
                textDecoration: "none",
              }}
            >
              {cta.label} →
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
