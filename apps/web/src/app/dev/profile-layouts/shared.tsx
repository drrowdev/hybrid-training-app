"use client";

/**
 * Shared fixture state + presentational primitives for the dev-only
 * /dev/profile-layouts gallery. See page.tsx for the gating rationale.
 *
 * Everything here is throwaway: it exists so four candidate layouts for
 * /app/settings/profile can be compared at real viewport widths, with
 * the real design tokens and fonts, without a database, auth, or the
 * `updateProfile` server action.
 *
 * The fake save keeps the per-field status contract of the real page
 * (idle -> saving -> saved) because "where does the saved chip live" is
 * one of the questions the layout has to answer.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// ─── Domain shapes (mirrors of the real page's unions) ───────────────

export type Units = "metric" | "imperial";
export type Gender = "male" | "female" | null;
export type Experience =
  | "beginner_lt_6m"
  | "novice_6m_2y"
  | "intermediate_2y_5y"
  | "advanced_5y_10y"
  | "highly_advanced_10y_plus";
export type Phase = "gain" | "maintain" | "lean_out";
export type Volume = "low" | "standard" | "high";

export type SaveStatus = "idle" | "saving" | "saved";

export const UNITS_OPTIONS = [
  { value: "metric" as const, label: "kg / km" },
  { value: "imperial" as const, label: "lb / mi" },
];

export const GENDER_OPTIONS = [
  { value: "male" as const, label: "Male" },
  { value: "female" as const, label: "Female" },
];

export const EXPERIENCE_OPTIONS = [
  { value: "beginner_lt_6m" as const, label: "Beginner", range: "< 6 months" },
  { value: "novice_6m_2y" as const, label: "Novice", range: "6 mo – 2 yr" },
  { value: "intermediate_2y_5y" as const, label: "Intermediate", range: "2 – 5 yr" },
  { value: "advanced_5y_10y" as const, label: "Advanced", range: "5 – 10 yr" },
  {
    value: "highly_advanced_10y_plus" as const,
    label: "Highly advanced",
    range: "10 yr +",
  },
];

export const PHASE_OPTIONS = [
  { value: "maintain" as const, label: "Maintain" },
  { value: "gain" as const, label: "Gain" },
  { value: "lean_out" as const, label: "Lean out" },
];

export const VOLUME_OPTIONS = [
  { value: "low" as const, label: "Easier" },
  { value: "standard" as const, label: "Balanced" },
  { value: "high" as const, label: "Harder" },
];

export const EXPERIENCE_LABEL: Record<Experience, string> = {
  beginner_lt_6m: "Beginner",
  novice_6m_2y: "Novice",
  intermediate_2y_5y: "Intermediate",
  advanced_5y_10y: "Advanced",
  highly_advanced_10y_plus: "Highly advanced",
};

export const PHASE_LABEL: Record<Phase, string> = {
  maintain: "Maintain",
  gain: "Gain",
  lean_out: "Lean out",
};

export const VOLUME_LABEL: Record<Volume, string> = {
  low: "Easier",
  standard: "Balanced",
  high: "Harder",
};

export const UNITS_LABEL: Record<Units, string> = {
  metric: "kg / km",
  imperial: "lb / mi",
};

// ─── Fixture state ───────────────────────────────────────────────────

type ProfileValues = {
  units: Units;
  gender: Gender;
  experience: Experience;
  phase: Phase;
  phaseStartedAt: string;
  phaseTargetWeeks: string;
  volume: Volume;
};

export type ProfileMock = ProfileValues & {
  status: Record<string, SaveStatus>;
  set: <K extends keyof ProfileValues>(key: K, value: ProfileValues[K]) => void;
};

const INITIAL: ProfileValues = {
  units: "metric",
  gender: "male",
  experience: "highly_advanced_10y_plus",
  phase: "maintain",
  phaseStartedAt: "",
  phaseTargetWeeks: "",
  volume: "standard",
};

/**
 * Fixture store with a simulated per-field auto-save. Timers are tracked
 * per field so a rapid re-edit restarts that field's cycle rather than
 * letting a stale timer resolve it to "saved".
 */
export function useProfileMock(): ProfileMock {
  const [values, setValues] = useState<ProfileValues>(INITIAL);
  const [status, setStatus] = useState<Record<string, SaveStatus>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>[]>>({});

  useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach((list) => list.forEach(clearTimeout));
    };
  }, []);

  const set = useCallback(
    <K extends keyof ProfileValues>(key: K, value: ProfileValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      (timers.current[key] ?? []).forEach(clearTimeout);
      setStatus((prev) => ({ ...prev, [key]: "saving" }));
      timers.current[key] = [
        setTimeout(() => setStatus((prev) => ({ ...prev, [key]: "saving" })), 0),
        setTimeout(() => setStatus((prev) => ({ ...prev, [key]: "saved" })), 420),
        setTimeout(() => setStatus((prev) => ({ ...prev, [key]: "idle" })), 2600),
      ];
    },
    [],
  );

  return { ...values, status, set };
}

// ─── Primitives ──────────────────────────────────────────────────────

/** Small uppercase mono eyebrow — the "what does this affect" kicker. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--cp-font-mono)",
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--cp-text-muted)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Per-field save chip. Deliberately field-level, not card-level: a card
 * can hold two independently saving fields and a shared chip could not
 * say which one failed.
 */
export function FieldStatus({ status }: { status: SaveStatus | undefined }) {
  const s = status ?? "idle";
  return (
    <span
      aria-live="polite"
      data-status={s}
      style={{
        fontFamily: "var(--cp-font-mono)",
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: s === "saved" ? "var(--cp-success)" : "var(--cp-text-muted)",
        opacity: s === "idle" ? 0 : 1,
        transition: "opacity .2s",
        whiteSpace: "nowrap",
      }}
    >
      {s === "saving" ? "Saving…" : "✓ Saved"}
    </span>
  );
}

/**
 * Segmented pill control. Native radios are kept (visually hidden) so
 * arrow-key navigation, focus and the radiogroup semantics come for
 * free — the pills are just styled labels.
 */
export function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  legend,
  size = "md",
  wrap = false,
  fit = false,
}: {
  name: string;
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string; sub?: string }>;
  onChange: (v: T) => void;
  legend: string;
  size?: "sm" | "md";
  wrap?: boolean;
  /** Size pills to their content instead of splitting the row evenly. */
  fit?: boolean;
}) {
  return (
    <fieldset
      style={{
        border: 0,
        margin: 0,
        padding: 0,
        minWidth: 0,
        display: fit ? "inline-block" : "block",
      }}
    >
      <legend className="sr-only">{legend}</legend>
      <div
        style={{
          display: "flex",
          flexWrap: wrap || fit ? "wrap" : "nowrap",
          gap: 4,
          padding: 4,
          border: "1px solid var(--cp-border)",
          borderRadius: 999,
          background: "var(--cp-bg-elevated)",
        }}
      >
        {options.map((opt) => {
          const sel = value === opt.value;
          return (
            <label
              key={opt.value}
              data-selected={sel ? "true" : "false"}
              style={{
                flex: fit ? "0 0 auto" : wrap ? "0 1 auto" : "1 1 0",
                minWidth: 0,
                display: "grid",
                justifyItems: "center",
                gap: 1,
                padding: size === "sm" ? "6px 10px" : "8px 12px",
                borderRadius: 999,
                cursor: "pointer",
                textAlign: "center",
                background: sel ? "var(--cp-accent)" : "transparent",
                color: sel ? "var(--cp-accent-fg)" : "var(--cp-text-soft)",
                transition: "background .14s, color .14s",
              }}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={sel}
                onChange={() => onChange(opt.value)}
                className="sr-only"
              />
              <span
                style={{
                  fontSize: size === "sm" ? 12.5 : 13.5,
                  fontWeight: sel ? 650 : 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "100%",
                }}
              >
                {opt.label}
              </span>
              {opt.sub != null && (
                <span
                  style={{
                    fontFamily: "var(--cp-font-mono)",
                    fontSize: 10,
                    opacity: sel ? 0.75 : 0.6,
                    whiteSpace: "nowrap",
                  }}
                >
                  {opt.sub}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Training experience stays a vertical list, not a segment: five options
 * do not fit a half-width pill row, and the year range is the thing
 * people actually choose on — it has to stay visible, not hide in a
 * tooltip.
 */
export function ExperienceList({
  value,
  onChange,
  compact = false,
}: {
  value: Experience;
  onChange: (v: Experience) => void;
  compact?: boolean;
}) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend className="sr-only">Training experience</legend>
      <div style={{ display: "grid", gap: compact ? 2 : 4 }}>
        {EXPERIENCE_OPTIONS.map((opt) => {
          const sel = value === opt.value;
          return (
            <label
              key={opt.value}
              data-selected={sel ? "true" : "false"}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: compact ? "7px 10px" : "9px 12px",
                borderRadius: 8,
                cursor: "pointer",
                background: sel ? "var(--cp-accent-soft)" : "transparent",
                boxShadow: sel ? "inset 3px 0 0 var(--cp-accent)" : "none",
                color: sel ? "var(--cp-text)" : "var(--cp-text-soft)",
                transition: "background .14s",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="radio"
                  name="experience"
                  value={opt.value}
                  checked={sel}
                  onChange={() => onChange(opt.value)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: sel
                      ? "var(--cp-accent)"
                      : "var(--cp-border-strong)",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13.5, fontWeight: sel ? 650 : 500 }}>
                  {opt.label}
                </span>
              </span>
              <span
                style={{
                  fontFamily: "var(--cp-font-mono)",
                  fontSize: 11,
                  color: "var(--cp-text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {opt.range}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** "?" affordance — supplementary detail only, never the deciding info. */
export function InfoNote({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ display: "contents" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="More about this setting"
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          border: "1px solid var(--cp-border-strong)",
          background: "transparent",
          color: "var(--cp-text-muted)",
          fontSize: 11,
          lineHeight: 1,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        ?
      </button>
      {open && (
        <p
          style={{
            gridColumn: "1 / -1",
            margin: 0,
            fontSize: 12,
            lineHeight: 1.55,
            color: "var(--cp-text-muted)",
          }}
        >
          {children}
        </p>
      )}
    </span>
  );
}

/** Muted note used for the unset-gender case and other soft warnings. */
export function SoftNote({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 11.5,
        lineHeight: 1.5,
        color: "var(--cp-warning)",
      }}
    >
      {children}
    </p>
  );
}

export const cardStyle: CSSProperties = {
  border: "1px solid var(--cp-border)",
  borderRadius: 12,
  background: "var(--cp-surface)",
  padding: 18,
  display: "grid",
  gap: 14,
  alignContent: "start",
  minWidth: 0,
};

/** Card shell: eyebrow, title, current value, then the control. */
export function Card({
  eyebrow,
  title,
  value,
  status,
  info,
  children,
  style,
}: {
  eyebrow: string;
  title: string;
  value: string;
  status?: SaveStatus;
  info?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section style={{ ...cardStyle, ...style }}>
      <header style={{ display: "grid", gap: 6 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            minHeight: 14,
          }}
        >
          <Eyebrow>{eyebrow}</Eyebrow>
          <FieldStatus status={status} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--cp-font-display)",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--cp-text-muted)",
            }}
          >
            {title}
          </h2>
          {info}
        </div>
        <div
          style={{
            fontFamily: "var(--cp-font-display)",
            fontSize: 26,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "0.01em",
            color: "var(--cp-text)",
          }}
        >
          {value}
        </div>
      </header>
      {children}
    </section>
  );
}

/** Date + weeks pair used by the body-composition phase. */
export function PhaseDetail({
  startedAt,
  targetWeeks,
  onStartedAt,
  onTargetWeeks,
}: {
  startedAt: string;
  targetWeeks: string;
  onStartedAt: (v: string) => void;
  onTargetWeeks: (v: string) => void;
}) {
  const label: CSSProperties = {
    display: "grid",
    gap: 4,
    fontFamily: "var(--cp-font-mono)",
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "var(--cp-text-muted)",
    minWidth: 0,
  };
  const input: CSSProperties = {
    background: "var(--cp-bg-elevated)",
    border: "1px solid var(--cp-border)",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 13,
    color: "var(--cp-text)",
    minWidth: 0,
    width: "100%",
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <label style={label}>
        Started
        <input
          type="date"
          value={startedAt}
          onChange={(e) => onStartedAt(e.target.value)}
          style={input}
        />
      </label>
      <label style={label}>
        Target (weeks)
        <input
          type="number"
          min={1}
          max={52}
          placeholder="e.g. 10"
          value={targetWeeks}
          onChange={(e) => onTargetWeeks(e.target.value)}
          style={input}
        />
      </label>
    </div>
  );
}
