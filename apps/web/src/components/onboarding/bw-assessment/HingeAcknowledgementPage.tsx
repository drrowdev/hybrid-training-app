"use client";

/**
 * Onboarding · Bodyweight assessment · Page 3 — Hinge-gap info.
 *
 * Informational page explaining the posterior-chain tradeoff of
 * bodyweight-only training and how the engine compensates. No user
 * input — by reaching this page, the user has implicitly seen the
 * tradeoff. Brand-purity: the copy never mentions a methodology.
 */

export function HingeAcknowledgementPage() {
  return (
    <div
      data-testid="bw-assessment-hinge-ack"
      style={{ display: "grid", gap: 14 }}
    >
      <p style={paragraphStyle}>
        Bodyweight training has a known posterior-chain limitation: loaded hip
        hinges (deadlift, Romanian deadlift) develop the back, hamstrings, and
        glutes in ways that bodyweight alone cannot fully replicate.
      </p>
      <p style={paragraphStyle}>
        The app compensates with isometric work, tempo-controlled
        eccentrics (e.g. Nordic curl progressions), and unilateral hinge
        drills — but the gap is real. If you add a vest, belt, or bands
        later, weighted variants unlock automatically.
      </p>
      <p style={{ margin: 0, fontSize: 11, color: "var(--cp-text-muted)" }}>
        You can revisit your assessment any time from
        Settings → Bodyweight progression.
      </p>
    </div>
  );
}

const paragraphStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "var(--cp-text-muted)",
  lineHeight: 1.6,
};
