"use client";

type Status = "idle" | "saving" | "saved" | "error";
type Preset = { percent: number; label: string; description: string };

const PRESETS: Preset[] = [
  {
    percent: 85,
    label: "De-emphasise",
    description:
      "Cardio-led blocks. Top working set lands below the strength-maintenance threshold — strength drifts down. Pick this only if you're consciously trading strength for cardio.",
  },
  {
    percent: 90,
    label: "Maintain / build",
    description:
      "Default for hybrid training. Top set lands right at the strength-driving threshold. Maintains or builds strength depending on your volume — same intensity floor either way.",
  },
  {
    percent: 95,
    label: "Peak / test",
    description:
      "Short 1–4 week peaking or testing windows only. Top set crosses into >90% of 1RM. Don't live here.",
  },
];

/**
 * Presentational, controlled. Parent owns the value + persistence; this
 * component just renders the preset cards + a fine-tune number input and
 * fires onPresetClick / onFineTune callbacks.
 */
export function DefaultTmPercentControl({
  value,
  onPresetClick,
  onFineTune,
  status,
  errorMsg,
}: {
  value: number;
  onPresetClick: (n: number) => void;
  onFineTune: (n: number) => void;
  status: Status;
  errorMsg: string | null;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3, 1fr)" }}>
        {PRESETS.map((p) => {
          const selected = value === p.percent;
          return (
            <button
              type="button"
              key={p.percent}
              onClick={() => onPresetClick(p.percent)}
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
          step="0.5"
          min="50"
          max="100"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onFineTune(n);
          }}
          inputMode="decimal"
          aria-label="Default training max percent"
          required
          className="mono"
          style={{ width: 110, padding: "8px 10px", fontSize: 16, textAlign: "right" }}
        />
        <span style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>% of 1RM</span>
        <StatusBadge status={status} errorMsg={errorMsg} />
      </div>

      {status === "error" && errorMsg && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: "var(--cp-danger)",
            padding: "6px 10px",
            borderRadius: 8,
            background: "color-mix(in oklab, var(--cp-danger) 8%, transparent)",
            border: "1px solid var(--cp-danger)",
          }}
        >
          Couldn&apos;t save: {errorMsg}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, errorMsg }: { status: Status; errorMsg: string | null }) {
  if (status === "idle") return <span style={{ fontSize: 11, color: "transparent" }}>·</span>;
  if (status === "saving") return <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>saving…</span>;
  if (status === "saved")
    return <span style={{ fontSize: 11, color: "var(--cp-success)", fontWeight: 600 }}>✓ saved</span>;
  return (
    <span title={errorMsg ?? undefined} style={{ fontSize: 11, color: "var(--cp-danger)", fontWeight: 600 }}>
      ✗ failed
    </span>
  );
}
