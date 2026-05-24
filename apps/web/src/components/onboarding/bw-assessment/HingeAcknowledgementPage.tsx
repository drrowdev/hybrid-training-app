"use client";

/**
 * Onboarding · Bodyweight assessment · Page 3 — Hinge-gap acknowledgement.
 *
 * Required confirmation that the user understands bodyweight training
 * has a known posterior-chain limitation. The compensation strategy
 * (isometric + tempo-controlled work, with optional conditioning
 * compensators in later phases) is referenced in the addendum and
 * surfaced here so the user is not surprised by the gap later.
 *
 * Brand-purity: the copy never mentions a methodology — only the
 * physiological tradeoff.
 */

export type HingeAcknowledgementPageProps = {
  acknowledged: boolean;
  onChange: (next: boolean) => void;
};

export function HingeAcknowledgementPage({
  acknowledged,
  onChange,
}: HingeAcknowledgementPageProps) {
  return (
    <div
      data-testid="bw-assessment-hinge-ack"
      style={{ display: "grid", gap: 16 }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--cp-text-muted)",
          lineHeight: 1.6,
        }}
      >
        Bodyweight training has a known posterior-chain limitation: loaded hip
        hinges (deadlift, Romanian deadlift) develop the back, hamstrings, and
        glutes in ways that bodyweight alone cannot fully replicate. We
        compensate with isometric work, tempo-controlled eccentrics (e.g.
        Nordic curl progressions), and unilateral hinge drills — but the gap
        is real.
      </p>

      <label
        data-testid="bw-assessment-hinge-ack-checkbox-row"
        style={ackBoxStyle}
      >
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onChange(e.target.checked)}
          data-testid="bw-assessment-hinge-ack-checkbox"
          style={{
            width: 18,
            height: 18,
            cursor: "pointer",
            accentColor: "var(--cp-accent)",
          }}
        />
        <span style={{ fontSize: 13, lineHeight: 1.5 }}>
          I understand my posterior chain may lag without barbell or loaded
          hinge work. The app will compensate with isometric and
          tempo-controlled work.
        </span>
      </label>

      <p style={{ margin: 0, fontSize: 11, color: "var(--cp-text-muted)" }}>
        This page is required. You can revisit your assessment any time from
        Settings → Bodyweight progression.
      </p>
    </div>
  );
}

const ackBoxStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: 12,
  alignItems: "flex-start",
  padding: 14,
  border: "1px solid var(--cp-border)",
  borderRadius: 10,
  background: "var(--cp-surface-soft, var(--cp-surface))",
  cursor: "pointer",
};
