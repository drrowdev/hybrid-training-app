"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

type Preset = {
  percent: number;
  label: string;
  description: string;
};

const PRESETS: Preset[] = [
  {
    percent: 85,
    label: "Maintain",
    description:
      "Cardio-led blocks. Top working set lands below the strength-driving threshold — strength may drift slightly.",
  },
  {
    percent: 90,
    label: "Default",
    description:
      "Balanced concurrent training. Top set lands right at the strength-driving threshold. Sustainable for long blocks.",
  },
  {
    percent: 95,
    label: "Peak",
    description:
      "Short 1–4 week testing or peaking windows. Top set crosses into >90% of 1RM. Don't live here.",
  },
];

export function DefaultTmPercentControl({
  initialPercent,
  action,
}: {
  initialPercent: number;
  action: (fd: FormData) => Promise<void> | void;
}) {
  const [value, setValue] = useState<number>(initialPercent);

  return (
    <form action={action} style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3, 1fr)" }}>
        {PRESETS.map((p) => {
          const selected = value === p.percent;
          return (
            <button
              type="button"
              key={p.percent}
              onClick={() => setValue(p.percent)}
              aria-pressed={selected}
              style={{
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: 12,
                border: `1px solid ${selected ? "var(--cp-accent)" : "var(--cp-border)"}`,
                background: selected ? "var(--cp-accent-soft)" : "var(--cp-surface)",
                color: "var(--cp-text)",
                cursor: "pointer",
                display: "grid",
                gap: 6,
                minHeight: 100,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: selected ? "var(--cp-accent)" : "var(--cp-text-muted)",
                    fontWeight: 600,
                  }}
                >
                  {p.label}
                </span>
                <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
                  {p.percent}%
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--cp-text-muted)", lineHeight: 1.45 }}>
                {p.description}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label
          htmlFor="percent"
          style={{
            fontSize: 11,
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Or fine-tune
        </label>
        <input
          id="percent"
          type="number"
          name="percent"
          step="0.5"
          min="50"
          max="100"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) setValue(n);
          }}
          inputMode="decimal"
          aria-label="Default training max percent"
          required
          className="mono"
          style={{ width: 110, padding: "8px 10px", fontSize: 16, textAlign: "right" }}
        />
        <span style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>% of 1RM</span>
        <SaveButton />
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="cp-btn primary" disabled={pending}>
      {pending ? "Saving…" : "Save default"}
    </button>
  );
}
