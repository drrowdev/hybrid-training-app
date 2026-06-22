/**
 * Shared, structured presentation for a HYROX (or any program's) cardio /
 * station session — the clean, sectioned alternative to a free-text blob.
 *
 * Renders a `cardioPlan` (summary · format/segments · per-station loads ·
 * effort · log hint) consistently across every surface that shows a cardio
 * session: the Today hero, the read-only Preview, the live in-session page and
 * the plan day drawer. Gender/division-correct loads are baked in at the source
 * (the engine prescription), so this component is pure presentation.
 *
 * Pure + dependency-light so it can be dropped into the plan drawer (which uses
 * its own CSS classes) and the React cards alike.
 */

import type { PrescriptionItem } from "@hta/db";

export type CardioPlanShape = NonNullable<PrescriptionItem["cardioPlan"]>;

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  fontWeight: 600,
};

export function CardioPlanView({
  plan,
  durationMin,
  compact,
}: {
  plan: CardioPlanShape;
  /** When set, shown as a "~N min" chip on the summary line (Preview hides its own duration row). */
  durationMin?: number | null;
  /** Compact variant trims spacing for the Today hero. */
  compact?: boolean;
}) {
  const gap = compact ? 10 : 14;
  return (
    <div data-testid="cardio-plan-view" style={{ display: "flex", flexDirection: "column", gap }}>
      {/* Summary — the one-line "what this is", with the structure meta + duration. */}
      <div
        style={{
          borderLeft: "2px solid var(--cp-accent)",
          paddingLeft: 12,
          display: "grid",
          gap: 4,
        }}
      >
        {(plan.meta || durationMin != null) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {plan.meta && (
              <span
                data-testid="cardio-plan-meta"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--cp-accent)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {plan.meta}
              </span>
            )}
            {/* Only show the duration chip when `meta` doesn't already encode it
                (runs put "~N min" in meta; stations use meta for the round count). */}
            {!plan.meta && durationMin != null && (
              <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>~{durationMin} min</span>
            )}
          </div>
        )}
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--cp-text)" }}>{plan.summary}</p>
      </div>

      {/* Format / structure — warm-up·work·cool-down, or the round rotation. */}
      {plan.segments && plan.segments.length > 0 && (
        <div data-testid="cardio-plan-segments" style={{ display: "grid", gap: 6 }}>
          {plan.segments.map((seg, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(72px, auto) 1fr",
                gap: 10,
                alignItems: "baseline",
              }}
            >
              <span style={labelStyle}>{seg.label}</span>
              <span style={{ fontSize: 14, color: "var(--cp-text)", lineHeight: 1.5 }}>{seg.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* Stations — gender-correct loads as a clean key/value list. */}
      {plan.stations && plan.stations.length > 0 && (
        <div data-testid="cardio-plan-stations" style={{ display: "grid", gap: 6 }}>
          <span style={labelStyle}>Stations &amp; loads</span>
          <div
            style={{
              display: "grid",
              gap: 1,
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid var(--cp-border)",
            }}
          >
            {plan.stations.map((st, i) => (
              <div
                key={i}
                data-testid={`cardio-plan-station-${i}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                  padding: "8px 12px",
                  background: "var(--cp-surface-soft)",
                }}
              >
                <span style={{ fontSize: 14, color: "var(--cp-text)", fontWeight: 500 }}>{st.name}</span>
                <span style={{ fontSize: 13, color: "var(--cp-text-muted)", textAlign: "right" }}>
                  {st.load && (
                    <span className="mono" style={{ color: "var(--cp-text)", fontWeight: 600 }}>
                      {st.load}
                    </span>
                  )}
                  {st.load && st.target ? <span style={{ opacity: 0.6 }}> · </span> : null}
                  {st.target}
                </span>
              </div>
            ))}
          </div>
          <span style={{ fontSize: 11, color: "var(--cp-text-muted)", fontStyle: "italic" }}>
            Competition standards — confirm yours at the gym.
          </span>
        </div>
      )}

      {/* Effort — the intensity cue, always present. */}
      <div data-testid="cardio-plan-effort" style={{ display: "grid", gap: 4 }}>
        <span style={labelStyle}>Effort</span>
        <span style={{ fontSize: 14, color: "var(--cp-text)", lineHeight: 1.5 }}>{plan.effort}</span>
      </div>

      {/* Log hint — muted footnote. */}
      {plan.logHint && (
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>{plan.logHint}</div>
      )}
    </div>
  );
}
