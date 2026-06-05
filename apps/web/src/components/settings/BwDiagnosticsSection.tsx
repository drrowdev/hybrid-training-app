"use client";

/**
 * Diagnostics dashboard section for the bodyweight progression page.
 *
 * Stack of cards rendered above the per-family table. Colour-coded
 * by severity (hard / soft / info). Hides everything below the top
 * 5 behind a "Show all (N)" toggle so the page stays glanceable.
 *
 * Server side: this component receives an already-computed list
 * of `DiagnosticResult` items; it never recomputes diagnostics in
 * the browser (the engine is read-only of session data and is
 * intentionally only called from the server component / server
 * action — see bw-diagnostics.ts).
 */

import { useState } from "react";
import Link from "next/link";
import type {
  DiagnosticResult,
  DiagnosticSeverity,
} from "@/lib/planner/bw-diagnostics";
import { severityOf } from "@/lib/planner/bw-diagnostics";

const SIGNAL_LABEL: Record<DiagnosticResult["signal"]["kind"], string> = {
  stall_at_node: "Stalled progression",
  aesthetics_drift_upper_strong: "Upper-body drift",
  aesthetics_drift_pull_dominant: "Pull-dominant imbalance",
  tendon_load_undercooked: "Tendon load short",
  cns_overreach_risk: "CNS overreach risk",
  hinge_gap_active: "Hinge gap",
  regression_risk: "Detraining risk",
};

const SIGNAL_GLYPH: Record<DiagnosticResult["signal"]["kind"], string> = {
  stall_at_node: "⏸",
  aesthetics_drift_upper_strong: "⚖",
  aesthetics_drift_pull_dominant: "↔",
  tendon_load_undercooked: "🩹",
  cns_overreach_risk: "⚡",
  hinge_gap_active: "⤓",
  regression_risk: "↘",
};

function colourFor(sev: DiagnosticSeverity): string {
  if (sev === "hard") return "var(--cp-danger)";
  if (sev === "soft") return "var(--cp-warning)";
  return "var(--cp-cardio)";
}

const MAX_VISIBLE = 5;

export function BwDiagnosticsSection({
  results,
}: {
  results: DiagnosticResult[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (results.length === 0) {
    // Spec: render nothing on an empty diagnostics list. A standing
    // "All clear" chip is noise — especially on a brand-new user's
    // first visit after the assessment.
    return null;
  }

  const shown = expanded ? results : results.slice(0, MAX_VISIBLE);
  const hidden = results.length - shown.length;

  return (
    <section data-testid="bw-diagnostics" style={{ display: "grid", gap: 8 }}>
      <h2 style={{ fontSize: 14, margin: 0 }}>Diagnostics</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {shown.map((r, i) => {
          const sev = severityOf(r.signal);
          const colour = colourFor(sev);
          return (
            <div
              key={`${r.signal.kind}-${i}`}
              data-testid={`bw-diagnostic-card-${r.signal.kind}`}
              data-severity={sev}
              style={{
                padding: "12px 14px",
                border: `1px solid ${colour}`,
                borderLeft: `4px solid ${colour}`,
                borderRadius: 10,
                background: "var(--cp-surface)",
                display: "grid",
                gap: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  color: colour,
                }}
              >
                <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                  {SIGNAL_GLYPH[r.signal.kind]}
                </span>
                <span>{SIGNAL_LABEL[r.signal.kind]}</span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: "var(--cp-text)",
                  lineHeight: 1.5,
                }}
              >
                {r.intervention.copy}
              </p>
              {r.intervention.actionable?.href && (
                <Link
                  href={r.intervention.actionable.href}
                  data-testid={`bw-diagnostic-action-${r.signal.kind}`}
                  className="cp-btn ghost"
                  style={{
                    alignSelf: "start",
                    fontSize: 11,
                    padding: "4px 10px",
                    minHeight: 28,
                  }}
                >
                  {r.intervention.actionable.label}
                </Link>
              )}
            </div>
          );
        })}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          data-testid="bw-diagnostics-show-all"
          onClick={() => setExpanded(true)}
          className="cp-btn ghost"
          style={{
            alignSelf: "start",
            fontSize: 11,
            padding: "4px 10px",
            minHeight: 28,
          }}
        >
          Show all ({results.length})
        </button>
      )}
      {expanded && results.length > MAX_VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="cp-btn ghost"
          style={{
            alignSelf: "start",
            fontSize: 11,
            padding: "4px 10px",
            minHeight: 28,
          }}
        >
          Show fewer
        </button>
      )}
    </section>
  );
}
