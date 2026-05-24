"use client";

/**
 * Onboarding · Bodyweight assessment step (3 pages).
 *
 * Conditionally replaces the Training Maxes step when the user's
 * selected equipment preset has no loadable main-lift (per
 * `hasLoadableMainLift`). Owns local 3-page state machine:
 *
 *   page 1: rep tests (push-up / pull-up / squat / plank)   skippable
 *   page 2: 12 skill-chip grid                              skippable
 *   page 3: hinge-gap acknowledgement                       required
 *
 * Submit fires `submitBwAssessmentAction` (server action passed in
 * from the wizard root), then the parent's `onComplete` callback
 * advances onboarding to the next step.
 *
 * Brand-purity: every label is a movement descriptor or a
 * physiological tradeoff. No external programme names anywhere in
 * the copy or test IDs.
 */
import { useState } from "react";
import { RepTestsPage } from "./RepTestsPage";
import { SkillChipsPage } from "./SkillChipsPage";
import { HingeAcknowledgementPage } from "./HingeAcknowledgementPage";
import type { BwSkillChip } from "@/lib/onboarding/bw-mapping";

export type RepInputs = {
  pushUpMaxReps: number | null;
  pullUpMaxReps: number | null;
  squatMaxReps: number | null;
  plankHoldSeconds: number | null;
};

export type BwAssessmentPayload = RepInputs & {
  skillChips: BwSkillChip[];
  hingeGapAcknowledged: boolean;
};

export type SubmitBwAssessmentAction = (
  payload: BwAssessmentPayload,
) => Promise<{ ok: true } | { ok: false; error: string }>;

export type BwAssessmentStepProps = {
  submitAction: SubmitBwAssessmentAction;
  /** Fires after a successful submit so the wizard advances. */
  onComplete: () => void;
};

const PAGE_LABELS = ["Rep tests", "Skill chips", "Acknowledge"] as const;
const TOTAL_PAGES = PAGE_LABELS.length;

export function BwAssessmentStep({
  submitAction,
  onComplete,
}: BwAssessmentStepProps) {
  const [page, setPage] = useState(0);
  const [reps, setReps] = useState<RepInputs>({
    pushUpMaxReps: null,
    pullUpMaxReps: null,
    squatMaxReps: null,
    plankHoldSeconds: null,
  });
  const [chips, setChips] = useState<BwSkillChip[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onPage1Skip = () => {
    setReps({
      pushUpMaxReps: null,
      pullUpMaxReps: null,
      squatMaxReps: null,
      plankHoldSeconds: null,
    });
    setPage(1);
  };

  const onPage2Skip = () => {
    setChips([]);
    setPage(2);
  };

  const onPrev = () => {
    setError(null);
    setPage((p) => Math.max(0, p - 1));
  };

  const onNext = () => {
    setError(null);
    if (page < TOTAL_PAGES - 1) {
      setPage((p) => p + 1);
      return;
    }
    // Final submit.
    if (!acknowledged) {
      setError("Confirm the acknowledgement to continue.");
      return;
    }
    setSubmitting(true);
    void (async () => {
      const r = await submitAction({
        ...reps,
        skillChips: chips,
        hingeGapAcknowledged: acknowledged,
      });
      setSubmitting(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onComplete();
    })();
  };

  const continueLabel =
    page < TOTAL_PAGES - 1
      ? "Continue →"
      : submitting
        ? "Saving…"
        : "Save assessment →";

  return (
    <div data-testid="bw-assessment-step" style={{ display: "grid", gap: 18 }}>
      <div>
        <div style={kickerStyle}>Step 4 · Bodyweight assessment</div>
        <h2
          style={{
            fontSize: 22,
            margin: "4px 0 0",
            letterSpacing: "-0.01em",
          }}
        >
          Tell us where you&apos;re starting from
        </h2>
      </div>

      <div
        data-testid="bw-assessment-progress"
        style={progressRowStyle}
        aria-label={`Step ${page + 1} of ${TOTAL_PAGES}`}
      >
        <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          Step {page + 1} of {TOTAL_PAGES}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {PAGE_LABELS.map((label, idx) => (
            <span
              key={label}
              data-testid={`bw-assessment-progress-pill-${idx}`}
              data-active={idx === page ? "true" : "false"}
              style={pillStyle(idx === page, idx < page)}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {page === 0 && <RepTestsPage values={reps} onChange={setReps} />}
      {page === 1 && <SkillChipsPage selected={chips} onChange={setChips} />}
      {page === 2 && (
        <HingeAcknowledgementPage
          acknowledged={acknowledged}
          onChange={setAcknowledged}
        />
      )}

      {error && (
        <div role="alert" style={errorBoxStyle}>
          {error}
        </div>
      )}

      <div style={navRowStyle}>
        <div>
          {page > 0 && (
            <button
              type="button"
              onClick={onPrev}
              disabled={submitting}
              className="cp-btn ghost"
              data-testid="bw-assessment-prev"
            >
              ← Back
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {page === 0 && (
            <button
              type="button"
              onClick={onPage1Skip}
              className="cp-btn ghost"
              data-testid="bw-assessment-skip-page-1"
              style={{ fontSize: 12 }}
            >
              Skip this section
            </button>
          )}
          {page === 1 && (
            <button
              type="button"
              onClick={onPage2Skip}
              className="cp-btn ghost"
              data-testid="bw-assessment-skip-page-2"
              style={{ fontSize: 12 }}
            >
              Skip this section
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            disabled={submitting || (page === 2 && !acknowledged)}
            className="cp-btn primary"
            data-testid="bw-assessment-next"
          >
            {continueLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── styles ──────────────────────────────────────────────────────────────

const kickerStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const progressRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  flexWrap: "wrap",
};

function pillStyle(active: boolean, done: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 999,
    border: `1px solid ${active ? "var(--cp-accent)" : "var(--cp-border)"}`,
    background: active
      ? "var(--cp-accent-soft)"
      : done
        ? "var(--cp-surface-soft, var(--cp-surface))"
        : "transparent",
    color: active ? "var(--cp-text)" : "var(--cp-text-muted)",
  };
}

const navRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const errorBoxStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 8,
  border: "1px solid var(--cp-danger, #c33)",
  background: "var(--cp-danger-soft, rgba(204, 51, 51, 0.08))",
  color: "var(--cp-text)",
  fontSize: 13,
};
