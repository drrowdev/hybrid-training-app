"use client";

/**
 * Compact editable-kg chip row. Renders the current values as
 * remove-able chips followed by an inline number input that commits on
 * Enter or blur. Used wherever the user has a small set of named
 * weights (weighted vests, sandbags, kettlebells) and we don't want to
 * model a min/max/step range.
 */
import { useState } from "react";

type Props = {
  values: number[];
  onChange: (next: number[]) => void;
  unit?: string;
  addLabel?: string;
  step?: number;
  min?: number;
  max?: number;
  testIdPrefix?: string;
};

export function EditableKgChips({
  values,
  onChange,
  unit = "kg",
  addLabel = "+ Add",
  step = 1,
  min = 1,
  max = 200,
  testIdPrefix,
}: Props) {
  const [draft, setDraft] = useState<string>("");

  const commitDraft = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < min || n > max) {
      setDraft("");
      return;
    }
    const next = Array.from(new Set([...values, n])).sort((a, b) => a - b);
    onChange(next);
    setDraft("");
  };

  return (
    <div
      data-testid={testIdPrefix ? `${testIdPrefix}-chips` : undefined}
      style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}
    >
      {values.map((v) => (
        <span
          key={v}
          data-testid={testIdPrefix ? `${testIdPrefix}-chip-${v}` : undefined}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            border: "1px solid var(--cp-border)",
            borderRadius: 999,
            background: "var(--cp-highlight)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--cp-text)",
          }}
        >
          <span className="mono">
            {v} {unit}
          </span>
          <button
            type="button"
            aria-label={`Remove ${v} ${unit}`}
            data-testid={testIdPrefix ? `${testIdPrefix}-chip-${v}-remove` : undefined}
            onClick={() => onChange(values.filter((x) => x !== v))}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--cp-text-muted)",
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft();
          }
        }}
        onBlur={commitDraft}
        placeholder={addLabel}
        data-testid={testIdPrefix ? `${testIdPrefix}-add-input` : undefined}
        style={{
          width: 84,
          padding: "4px 8px",
          fontSize: 12,
          background: "transparent",
          border: "1px dashed var(--cp-border)",
          borderRadius: 999,
          color: "var(--cp-text)",
        }}
      />
    </div>
  );
}
