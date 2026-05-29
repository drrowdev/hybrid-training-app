"use client";

/**
 * Shared RPE button-grid input — replaces the bare numeric input used
 * in strength per-set logging and cardio session logging.
 *
 * Renders six chips (5 / 6 / 7 / 8 / 9 / 10), each with the numeric
 * value and a short word-label. Selection is single-pick; clicking the
 * same chip again deselects (null = RPE not recorded).
 *
 * Labels are SHORT FORMS deliberately — at 320px the long forms ("very
 * hard", "all-out") would either wrap or get truncated inside the
 * 1/6-width chip. See `RpeInput.test.tsx` for the 320px-fit guard.
 *
 * Three secondary affordances:
 *   - "<5" link in the top-right of the field label expands a tiny
 *     row of chips for sub-5 values (0–4). Useful but rare — easy
 *     warmup sets — so it's hidden by default.
 *   - ⓘ button next to the "RPE" label toggles a context-specific
 *     legend ABOVE the chips. Collapsed by default.
 *   - A hidden `<input name={name}>` mirrors the current value so
 *     callers can keep their existing FormData submission path
 *     untouched (backends still receive a numeric string).
 *
 * The component is a thin controlled wrapper. Click-to-deselect is
 * exercised by the pure `toggleRpe` helper exported from this file —
 * the project test env is Node-only (no JSDOM) so static-render tests
 * cover the rendering surface and the helper covers the toggle logic.
 */

import { useState } from "react";

export type RpeContext = "strength" | "cardio";

export type RpeInputProps = {
  /** FormData field name — the hidden mirror input writes here. */
  name: string;
  /** Controlled value, or `undefined` for uncontrolled (with `defaultValue`). */
  value?: number | null;
  onChange?: (v: number | null) => void;
  context: RpeContext;
  defaultValue?: number | null;
};

const PRIMARY_CHIPS: { value: number; label: string }[] = [
  { value: 5, label: "easy" },
  { value: 6, label: "moderate" },
  { value: 7, label: "hard" },
  { value: 8, label: "tough" },
  { value: 9, label: "brutal" },
  { value: 10, label: "max" },
];

const SUB_FIVE_CHIPS = [0, 1, 2, 3, 4];

const STRENGTH_LEGEND: { value: string; text: string }[] = [
  { value: "5", text: "Easy — about 5+ good reps left in the tank" },
  { value: "6", text: "Moderate — about 4 reps left" },
  { value: "7", text: "Challenging — about 3 reps left" },
  { value: "8", text: "Hard — about 2 reps left" },
  { value: "9", text: "Very hard — 1 rep left, maybe" },
  { value: "10", text: "All-out — couldn't have done another rep" },
];

const CARDIO_LEGEND: { value: string; text: string }[] = [
  { value: "5", text: "Easy — could chat in full sentences the whole time" },
  { value: "6", text: "Moderate — sentences, just a bit breathless" },
  { value: "7", text: "Challenging — short phrases only" },
  { value: "8", text: "Hard — a few words between breaths" },
  { value: "9", text: "Very hard — single words, barely" },
  { value: "10", text: "All-out — can't speak, max effort" },
];

const LEGEND_HEADING: Record<RpeContext, string> = {
  strength: "How hard was that set?",
  cardio: "How hard was the session overall?",
};

/** Pure toggle: tapping the active value clears it, else it selects. */
export function toggleRpe(
  current: number | null | undefined,
  clicked: number,
): number | null {
  if (current != null && current === clicked) return null;
  return clicked;
}

export function RpeInput({
  name,
  value,
  onChange,
  context,
  defaultValue = null,
}: RpeInputProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<number | null>(defaultValue ?? null);
  const current = isControlled ? value ?? null : internal;
  const [legendOpen, setLegendOpen] = useState(false);
  const [subFiveOpen, setSubFiveOpen] = useState(false);

  const set = (next: number | null) => {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  };

  const onPick = (n: number) => set(toggleRpe(current, n));

  const legendRows = context === "strength" ? STRENGTH_LEGEND : CARDIO_LEGEND;

  return (
    <div
      data-testid="rpe-input"
      data-context={context}
      data-value={current ?? ""}
      style={{ display: "grid", gap: 6 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        <span>RPE</span>
        <button
          type="button"
          data-testid="rpe-input-info-toggle"
          aria-expanded={legendOpen}
          aria-label="Toggle RPE legend"
          onClick={() => setLegendOpen((o) => !o)}
          style={{
            background: "transparent",
            border: "1px solid var(--cp-border)",
            color: "var(--cp-text-muted)",
            width: 18,
            height: 18,
            borderRadius: 999,
            cursor: "pointer",
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            lineHeight: 1,
          }}
        >
          ⓘ
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          data-testid="rpe-input-sub-five-toggle"
          onClick={() => setSubFiveOpen((o) => !o)}
          aria-expanded={subFiveOpen}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--cp-link, var(--cp-text-muted))",
            fontSize: 11,
            textTransform: "none",
            letterSpacing: 0,
            cursor: "pointer",
            padding: 0,
            textDecoration: "underline",
            fontWeight: 500,
          }}
        >
          {subFiveOpen ? "hide <5" : "<5"}
        </button>
      </div>

      {legendOpen && (
        <div
          data-testid="rpe-input-legend"
          data-context={context}
          style={{
            background: "var(--cp-surface-soft)",
            border: "1px solid var(--cp-border)",
            borderRadius: 10,
            padding: "10px 12px",
            display: "grid",
            gap: 4,
            fontSize: 12,
            color: "var(--cp-text-muted)",
            lineHeight: 1.5,
          }}
        >
          <div
            style={{
              fontWeight: 600,
              color: "var(--cp-text)",
              marginBottom: 2,
            }}
          >
            {LEGEND_HEADING[context]}
          </div>
          {legendRows.map((row) => (
            <div key={row.value} style={{ display: "flex", gap: 8 }}>
              <span
                className="mono"
                style={{ minWidth: 18, color: "var(--cp-text)", fontWeight: 600 }}
              >
                {row.value}
              </span>
              <span>{row.text}</span>
            </div>
          ))}
        </div>
      )}

      <div
        role="radiogroup"
        aria-label="RPE"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
          gap: 4,
        }}
      >
        {PRIMARY_CHIPS.map((chip) => {
          const selected = current === chip.value;
          return (
            <button
              type="button"
              key={chip.value}
              role="radio"
              aria-checked={selected}
              data-testid={`rpe-chip-${chip.value}`}
              data-selected={selected ? "true" : "false"}
              onClick={() => onPick(chip.value)}
              style={{
                background: selected ? "var(--cp-accent)" : "var(--cp-surface)",
                color: selected
                  ? "var(--cp-accent-fg)"
                  : "var(--cp-text)",
                border: `1px solid ${selected ? "var(--cp-accent)" : "var(--cp-border)"}`,
                borderRadius: 10,
                minHeight: 52,
                padding: "6px 2px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                cursor: "pointer",
                fontFamily: "inherit",
                lineHeight: 1.1,
              }}
            >
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                {chip.value}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: selected
                    ? "var(--cp-accent-fg)"
                    : "var(--cp-text-muted)",
                  textTransform: "lowercase",
                  letterSpacing: 0,
                  fontWeight: 500,
                }}
              >
                {chip.label}
              </span>
            </button>
          );
        })}
      </div>

      {subFiveOpen && (
        <div
          data-testid="rpe-input-sub-five"
          role="radiogroup"
          aria-label="RPE under 5"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
            gap: 4,
          }}
        >
          {SUB_FIVE_CHIPS.map((n) => {
            const selected = current === n;
            return (
              <button
                type="button"
                key={n}
                role="radio"
                aria-checked={selected}
                data-testid={`rpe-chip-${n}`}
                data-selected={selected ? "true" : "false"}
                onClick={() => onPick(n)}
                style={{
                  background: selected
                    ? "var(--cp-accent)"
                    : "var(--cp-surface)",
                  color: selected
                    ? "var(--cp-accent-fg)"
                    : "var(--cp-text)",
                  border: `1px solid ${selected ? "var(--cp-accent)" : "var(--cp-border)"}`,
                  borderRadius: 8,
                  minHeight: 36,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "inherit",
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
      )}

      <input
        type="hidden"
        name={name}
        data-testid="rpe-input-hidden"
        value={current ?? ""}
        readOnly
      />
    </div>
  );
}
