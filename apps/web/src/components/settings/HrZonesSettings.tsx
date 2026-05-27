"use client";

/**
 * Heart-rate zone settings panel.
 *
 * Three methods supported:
 *  - %Max HR (Z1<60 / Z2<70 / Z3<80 / Z4<90 / Z5)
 *  - %HRR Karvonen (Z1<50 / Z2<60 / Z3<70 / Z4<85 / Z5)
 *  - %LTHR Friel, 5-zone simplified (Z1<81 / Z2<89 / Z3<93 / Z4<99 / Z5)
 *
 * Persists `intake.hrMethod` + the relevant raw inputs (other methods'
 * inputs persist too so a flip doesn't lose data) + `intake.hrZones`
 * (the computed bands, cached so downstream readers don't re-derive).
 *
 * Auto-saves via the shared `useAutoSave` hook on a ~500ms debounce.
 */
import { useCallback, useMemo, useState } from "react";
import {
  computeZoneBandsSafe,
  HR_LTHR_RANGE,
  HR_MAX_RANGE,
  HR_RESTING_RANGE,
  type HrMethod,
  type ZoneBands,
} from "@/lib/stats/hr-zones";
import { useAutoSave } from "@/lib/settings/use-auto-save";
import { updateHrZones } from "@/lib/settings/hr-zones-actions";
import { AutoSaveStatus } from "./AutoSaveStatus";

export type HrZonesSettingsValue = {
  hrMethod: HrMethod;
  hrMax: number | null;
  hrResting: number | null;
  hrLthr: number | null;
};

export type HrZonesSettingsProps = {
  initial: HrZonesSettingsValue;
  /** Optional age used for the "estimate (220 − age)" hint + reset. */
  age?: number | null;
};

const ZONE_LABELS: Array<{ zone: "Z1" | "Z2" | "Z3" | "Z4" | "Z5"; hint: string }> = [
  { zone: "Z1", hint: "recovery" },
  { zone: "Z2", hint: "easy aerobic" },
  { zone: "Z3", hint: "tempo" },
  { zone: "Z4", hint: "threshold" },
  { zone: "Z5", hint: "VO2 max" },
];

const LTHR_HELP_URL =
  "https://www.trainingpeaks.com/learn/articles/joe-friel-s-quick-guide-to-setting-zones/";

export type ZonePreviewRow = {
  zone: "Z1" | "Z2" | "Z3" | "Z4" | "Z5";
  /** Display string, e.g. "≤ 115", "116–135", "≥ 176". */
  range: string;
  hint: string;
};

/**
 * Build the 5-row display strings for the preview table from a set of
 * computed bands. Extracted as a pure helper so the component test
 * can assert against it without rendering.
 */
export function previewZoneRows(bands: ZoneBands | null): ZonePreviewRow[] {
  if (!bands) {
    return ZONE_LABELS.map(({ zone, hint }) => ({ zone, range: "—", hint }));
  }
  const round = (n: number) => Math.round(n);
  // Display uses inclusive bounds for readability; underlying zoneForBpm
  // uses exclusive upper edges, hence the "≤ z1Max-1" / "≥ z4Max" framing.
  return [
    { zone: "Z1", range: `≤ ${round(bands.z1Max) - 1}`, hint: "recovery" },
    {
      zone: "Z2",
      range: `${round(bands.z1Max)}–${round(bands.z2Max) - 1}`,
      hint: "easy aerobic",
    },
    {
      zone: "Z3",
      range: `${round(bands.z2Max)}–${round(bands.z3Max) - 1}`,
      hint: "tempo",
    },
    {
      zone: "Z4",
      range: `${round(bands.z3Max)}–${round(bands.z4Max) - 1}`,
      hint: "threshold",
    },
    { zone: "Z5", range: `≥ ${round(bands.z4Max)}`, hint: "VO2 max" },
  ];
}

function parseNumber(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Per-method input validation copy. Returns null when the value is
 * usable, otherwise a muted-error message rendered below the field.
 */
function validateField(
  name: "hrMax" | "hrResting" | "hrLthr",
  value: number | null,
): string | null {
  if (value == null) return null;
  const ranges = {
    hrMax: HR_MAX_RANGE,
    hrResting: HR_RESTING_RANGE,
    hrLthr: HR_LTHR_RANGE,
  } as const;
  const labels = {
    hrMax: "Max HR",
    hrResting: "Resting HR",
    hrLthr: "Lactate threshold HR",
  } as const;
  const { min, max } = ranges[name];
  if (value < min || value > max) {
    return `${labels[name]} should be between ${min} and ${max} bpm.`;
  }
  return null;
}

const inputStyle: React.CSSProperties = {
  width: 120,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
  fontSize: 14,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: 160,
  appearance: "auto",
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  fontSize: 12,
  color: "var(--cp-text-muted)",
};

const errorStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
};

export function HrZonesSettings({ initial, age }: HrZonesSettingsProps) {
  const [open, setOpen] = useState(true);

  const save = useCallback(async (next: HrZonesSettingsValue) => {
    await updateHrZones({
      hrMethod: next.hrMethod,
      hrMax: next.hrMax,
      hrResting: next.hrResting,
      hrLthr: next.hrLthr,
    });
  }, []);

  const { value, setValue, reset, status, retry, lastError } =
    useAutoSave<HrZonesSettingsValue>({
      initial,
      save,
      debounceMs: 500,
      equals: (a, b) =>
        a.hrMethod === b.hrMethod &&
        a.hrMax === b.hrMax &&
        a.hrResting === b.hrResting &&
        a.hrLthr === b.hrLthr,
    });

  const ageEstimate = useMemo(() => {
    if (age == null || age <= 0 || age > 120) return null;
    return 220 - age;
  }, [age]);

  const bands = useMemo(
    () =>
      computeZoneBandsSafe({
        method: value.hrMethod,
        hrMax: value.hrMax ?? undefined,
        hrResting: value.hrResting ?? undefined,
        hrLthr: value.hrLthr ?? undefined,
      }),
    [value],
  );
  const rows = useMemo(() => previewZoneRows(bands), [bands]);

  const onReset = useCallback(() => {
    const next: HrZonesSettingsValue = {
      hrMethod: "max",
      hrMax: ageEstimate ?? null,
      hrResting: null,
      hrLthr: null,
    };
    setValue(next);
  }, [ageEstimate, setValue]);

  // Bind raw inputs as strings so partial typing ("19") doesn't snap.
  const [hrMaxStr, setHrMaxStr] = useState(value.hrMax?.toString() ?? "");
  const [hrRestingStr, setHrRestingStr] = useState(
    value.hrResting?.toString() ?? "",
  );
  const [hrLthrStr, setHrLthrStr] = useState(value.hrLthr?.toString() ?? "");

  const commit = useCallback(
    (patch: Partial<HrZonesSettingsValue>) => {
      setValue({ ...value, ...patch });
    },
    [value, setValue],
  );

  // Keep local string state in sync when reset() runs (programmatic value swap).
  const sync = useCallback((next: HrZonesSettingsValue) => {
    setHrMaxStr(next.hrMax?.toString() ?? "");
    setHrRestingStr(next.hrResting?.toString() ?? "");
    setHrLthrStr(next.hrLthr?.toString() ?? "");
  }, []);
  // We piggy-back on setValue: every call from this component also
  // updates the string mirrors. The reset path does it explicitly.
  void reset;
  void sync;

  return (
    <section
      data-testid="hr-zones-settings"
      style={{ display: "grid", gap: 12 }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "8px 0",
          background: "transparent",
          border: "none",
          color: "var(--cp-text)",
          fontSize: 16,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <span>Heart-rate zones</span>
        <span aria-hidden style={{ fontSize: 12, opacity: 0.7 }}>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div style={{ display: "grid", gap: 16 }}>
          <label style={labelStyle}>
            Method
            <select
              data-testid="hr-method"
              value={value.hrMethod}
              onChange={(e) => commit({ hrMethod: e.target.value as HrMethod })}
              style={selectStyle}
            >
              <option value="max">%Max HR</option>
              <option value="hrr">%HRR (Karvonen)</option>
              <option value="lthr">%LTHR (Friel)</option>
            </select>
            <span style={{ ...errorStyle, color: "var(--cp-text-muted)" }}>
              Pick how you want to define your zones.
            </span>
          </label>

          {(value.hrMethod === "max" || value.hrMethod === "hrr") && (
            <label style={labelStyle}>
              Max HR (bpm)
              <input
                data-testid="hr-max-input"
                type="number"
                inputMode="numeric"
                min={HR_MAX_RANGE.min}
                max={HR_MAX_RANGE.max}
                value={hrMaxStr}
                onChange={(e) => {
                  setHrMaxStr(e.target.value);
                  commit({ hrMax: parseNumber(e.target.value) });
                }}
                style={inputStyle}
              />
              {ageEstimate != null && (
                <span style={errorStyle}>
                  Estimate from age ({age}): {ageEstimate} bpm
                </span>
              )}
              {validateField("hrMax", value.hrMax) && (
                <span style={errorStyle} data-testid="hr-max-error">
                  {validateField("hrMax", value.hrMax)}
                </span>
              )}
            </label>
          )}

          {value.hrMethod === "hrr" && (
            <label style={labelStyle}>
              Resting HR (bpm)
              <input
                data-testid="hr-resting-input"
                type="number"
                inputMode="numeric"
                min={HR_RESTING_RANGE.min}
                max={HR_RESTING_RANGE.max}
                value={hrRestingStr}
                onChange={(e) => {
                  setHrRestingStr(e.target.value);
                  commit({ hrResting: parseNumber(e.target.value) });
                }}
                style={inputStyle}
              />
              {validateField("hrResting", value.hrResting) && (
                <span style={errorStyle} data-testid="hr-resting-error">
                  {validateField("hrResting", value.hrResting)}
                </span>
              )}
            </label>
          )}

          {value.hrMethod === "lthr" && (
            <label style={labelStyle}>
              Lactate threshold HR (bpm)
              <input
                data-testid="hr-lthr-input"
                type="number"
                inputMode="numeric"
                min={HR_LTHR_RANGE.min}
                max={HR_LTHR_RANGE.max}
                value={hrLthrStr}
                onChange={(e) => {
                  setHrLthrStr(e.target.value);
                  commit({ hrLthr: parseNumber(e.target.value) });
                }}
                style={inputStyle}
              />
              <a
                href={LTHR_HELP_URL}
                target="_blank"
                rel="noopener"
                style={{ ...errorStyle, color: "var(--cp-link, var(--cp-text))" }}
              >
                How do I find my LTHR? ↗
              </a>
              {validateField("hrLthr", value.hrLthr) && (
                <span style={errorStyle} data-testid="hr-lthr-error">
                  {validateField("hrLthr", value.hrLthr)}
                </span>
              )}
            </label>
          )}

          <div
            data-testid="hr-zone-preview"
            style={{
              display: "grid",
              gap: 6,
              padding: "12px 0",
              borderTop: "1px solid var(--cp-border)",
              borderBottom: "1px solid var(--cp-border)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>Computed zones</div>
            {rows.map((row) => (
              <div
                key={row.zone}
                data-testid={`hr-zone-row-${row.zone}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px 1fr 1fr",
                  gap: 12,
                  fontSize: 13,
                  color: "var(--cp-text)",
                }}
              >
                <span style={{ fontWeight: 600 }}>{row.zone}</span>
                <span>{row.range} bpm</span>
                <span style={{ color: "var(--cp-text-muted)" }}>({row.hint})</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button
              type="button"
              data-testid="hr-zones-reset"
              onClick={() => {
                onReset();
                // Keep local string mirrors in sync with the reset value.
                setHrMaxStr(ageEstimate != null ? String(ageEstimate) : "");
                setHrRestingStr("");
                setHrLthrStr("");
              }}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid var(--cp-border)",
                background: "var(--cp-surface)",
                color: "var(--cp-text)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Reset to estimate {ageEstimate != null ? `(${ageEstimate} bpm)` : "(220 − age)"}
            </button>
            <AutoSaveStatus status={status} onRetry={retry} testIdSuffix="hr-zones" />
          </div>

          {lastError && (
            <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
              {lastError}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
