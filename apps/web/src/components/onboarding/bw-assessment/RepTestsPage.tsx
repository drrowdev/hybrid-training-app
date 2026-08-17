"use client";

/**
 * Onboarding · Bodyweight assessment · Page 1 — Rep tests.
 *
 * Four numeric inputs, each individually skippable (leaving the
 * field empty serialises as `null`, signalling "user skipped" to the
 * mapping layer). Helper copy primes the user to record strict reps
 * to failure — the rep landmarks in `bw-mapping.ts` assume strict
 * form. Mobile-first single-column layout; matches `EquipmentStep`
 * visual language (inline styles, `--cp-*` tokens only).
 */
import type { RepInputs } from "./BwAssessmentStep";

export type RepTestsPageProps = {
  values: RepInputs;
  onChange: (next: RepInputs) => void;
};

type Field = {
  key: keyof RepInputs;
  label: string;
  hint: string;
  unit: string;
  max: number;
};

const FIELDS: readonly Field[] = [
  {
    key: "pushUpMaxReps",
    label: "Push-ups",
    hint: "Strict, full range of motion, chest to fist height.",
    unit: "reps",
    max: 200,
  },
  {
    key: "pullUpMaxReps",
    label: "Pull-ups",
    hint: "Strict, dead hang start, chin over the bar.",
    unit: "reps",
    max: 200,
  },
  {
    key: "squatMaxReps",
    label: "Bodyweight squats",
    hint: "Hips below knees on every rep, no pausing at the top.",
    unit: "reps",
    max: 200,
  },
  {
    key: "plankHoldSeconds",
    label: "Plank hold",
    hint: "Front plank on elbows, neutral spine — until form breaks.",
    unit: "seconds",
    max: 600,
  },
] as const;

export function RepTestsPage({ values, onChange }: RepTestsPageProps) {
  const set = (key: keyof RepInputs, raw: string) => {
    if (raw === "") {
      onChange({ ...values, [key]: null });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange({ ...values, [key]: Math.max(0, Math.floor(n)) });
  };

  return (
    <div data-testid="bw-assessment-rep-tests" style={{ display: "grid", gap: 18 }}>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--cp-text-muted)",
          lineHeight: 1.55,
        }}
      >
        Strict reps to failure. Skip any field you don&apos;t know — it seeds a
        conservative default and adjusts as you log sessions.
      </p>

      <div style={{ display: "grid", gap: 10 }}>
        {FIELDS.map((f) => {
          const v = values[f.key];
          return (
            <label
              key={f.key}
              data-testid={`bw-assessment-field-${f.key}`}
              style={fieldCardStyle}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{f.label}</span>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--cp-text-muted)",
                    lineHeight: 1.45,
                  }}
                >
                  {f.hint}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="number"
                  value={v == null ? "" : String(v)}
                  onChange={(e) => set(f.key, e.target.value)}
                  min="0"
                  max={f.max}
                  step="1"
                  inputMode="numeric"
                  placeholder="—"
                  aria-label={f.label}
                  className="mono"
                  style={inputStyle}
                />
                <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                  {f.unit}
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

const fieldCardStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: 12,
  alignItems: "center",
  padding: 12,
  border: "1px solid var(--cp-border)",
  borderRadius: 10,
  background: "var(--cp-surface)",
};

const inputStyle: React.CSSProperties = {
  width: 80,
  padding: "8px 8px",
  fontSize: 14,
  textAlign: "right",
  border: "1px solid var(--cp-border)",
  borderRadius: 8,
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
};
