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
  DEFAULT_ZONE_PCTS,
  HR_LTHR_RANGE,
  HR_MAX_RANGE,
  HR_RESTING_RANGE,
  validateZonePercents,
  type HrMethod,
  type ZoneBands,
  type ZonePercents,
} from "@/lib/stats/hr-zones";
import { useAutoSave } from "@/lib/settings/use-auto-save";
import { updateHrZones } from "@/lib/settings/hr-zones-actions";
import { AutoSaveStatus } from "./AutoSaveStatus";

export type HrPercentsByMethod = {
  max?: ZonePercents;
  hrr?: ZonePercents;
  lthr?: ZonePercents;
};

export type HrZonesSettingsValue = {
  hrMethod: HrMethod;
  hrMax: number | null;
  hrResting: number | null;
  hrLthr: number | null;
  /** Per-method breakpoint overrides; missing entries fall back to defaults. */
  hrPercents: HrPercentsByMethod;
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
 * Parse a single zone-percent input. Accepts either an integer
 * percentage (`81`) or a decimal fraction (`0.81`); both land at 0.81.
 * The threshold is `>= 2` (not `> 1.5`) so a typo like `1.6` is kept
 * as 1.6 and rejected by the validator instead of silently being
 * coerced to 0.016 — which would slip past `validateZonePercents`
 * (still in range) and produce a nonsensical zone breakpoint.
 */
export function parseZonePct(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n >= 2 ? n / 100 : n;
}

/**
 * Plain-language helper text shown below the HR-method dropdown.
 * Mirrors the dropdown labels: the user-facing primary is the
 * what/why; the technical name lives only in parentheses on the
 * option itself. See settings/page.tsx (`Z1–Z5 thresholds for cardio
 * intensity.`) for the entry-point copy.
 */
export function hrMethodHelpText(method: HrMethod): string {
  switch (method) {
    case "max":
      return "Requires your max HR (or auto-calculated from age).";
    case "hrr":
      return "More accurate. Uses both max HR and resting HR for a wider range.";
    case "lthr":
      return "For experienced athletes. Uses your lactate threshold from a 30-min time trial.";
  }
}

/** Display a fractional zone-pct as a 0–150 integer when sensible. */
function pctToDisplay(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "";
  return String(Math.round(p * 100));
}

function pctsEqual(
  a: ZonePercents | undefined,
  b: ZonePercents | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.z1 === b.z1 && a.z2 === b.z2 && a.z3 === b.z3 && a.z4 === b.z4;
}

type PctErrors = { z1: string | null; z2: string | null; z3: string | null; z4: string | null };

/**
 * Per-field error copy for the four breakpoint inputs. Empty fields
 * are treated as "use the default" and never error. Range errors mark
 * the offending field; ascending-order errors mark the later one.
 */
function pctFieldErrors(p: Partial<ZonePercents>): PctErrors {
  const errs: PctErrors = { z1: null, z2: null, z3: null, z4: null };
  const keys: Array<keyof ZonePercents> = ["z1", "z2", "z3", "z4"];
  for (const k of keys) {
    const v = p[k];
    if (v == null) continue;
    if (!Number.isFinite(v) || v <= 0 || v > 1.5) {
      errs[k] = "Must be between 0% and 150%.";
    }
  }
  const pairs: Array<[keyof ZonePercents, keyof ZonePercents]> = [
    ["z1", "z2"],
    ["z2", "z3"],
    ["z3", "z4"],
  ];
  for (const [a, b] of pairs) {
    const va = p[a];
    const vb = p[b];
    if (va == null || vb == null) continue;
    if (errs[a] || errs[b]) continue;
    if (!(va < vb)) errs[b] = `Must be greater than ${a.toUpperCase()}.`;
  }
  return errs;
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
  width: "100%",
  maxWidth: 320,
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
      pcts: next.hrPercents[next.hrMethod] ?? null,
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
        a.hrLthr === b.hrLthr &&
        pctsEqual(a.hrPercents[a.hrMethod], b.hrPercents[b.hrMethod]) &&
        pctsEqual(a.hrPercents.max, b.hrPercents.max) &&
        pctsEqual(a.hrPercents.hrr, b.hrPercents.hrr) &&
        pctsEqual(a.hrPercents.lthr, b.hrPercents.lthr),
    });

  const ageEstimate = useMemo(() => {
    if (age == null || age <= 0 || age > 120) return null;
    return 220 - age;
  }, [age]);

  const activePcts = value.hrPercents[value.hrMethod];

  const bands = useMemo(
    () =>
      computeZoneBandsSafe({
        method: value.hrMethod,
        hrMax: value.hrMax ?? undefined,
        hrResting: value.hrResting ?? undefined,
        hrLthr: value.hrLthr ?? undefined,
        pcts: activePcts,
      }),
    [value, activePcts],
  );
  const rows = useMemo(() => previewZoneRows(bands), [bands]);

  const onReset = useCallback(() => {
    const next: HrZonesSettingsValue = {
      hrMethod: "max",
      hrMax: ageEstimate ?? null,
      hrResting: null,
      hrLthr: null,
      hrPercents: {},
    };
    setValue(next);
  }, [ageEstimate, setValue]);

  // Bind raw inputs as strings so partial typing ("19") doesn't snap.
  const [hrMaxStr, setHrMaxStr] = useState(value.hrMax?.toString() ?? "");
  const [hrRestingStr, setHrRestingStr] = useState(
    value.hrResting?.toString() ?? "",
  );
  const [hrLthrStr, setHrLthrStr] = useState(value.hrLthr?.toString() ?? "");

  // Per-method string mirrors for the four breakpoint inputs.
  // Initialised from any persisted override; otherwise the empty
  // string so the default leaks through as a `placeholder`.
  const initialActivePcts = initial.hrPercents[initial.hrMethod];
  const [pctZ1Str, setPctZ1Str] = useState(pctToDisplay(initialActivePcts?.z1));
  const [pctZ2Str, setPctZ2Str] = useState(pctToDisplay(initialActivePcts?.z2));
  const [pctZ3Str, setPctZ3Str] = useState(pctToDisplay(initialActivePcts?.z3));
  const [pctZ4Str, setPctZ4Str] = useState(pctToDisplay(initialActivePcts?.z4));

  const commit = useCallback(
    (patch: Partial<HrZonesSettingsValue>) => {
      setValue({ ...value, ...patch });
    },
    [value, setValue],
  );

  /**
   * Apply a single breakpoint-pct change. Folds the new value into the
   * active method's override; once all four fields are valid we
   * persist the validated `ZonePercents`. While any field is partial /
   * invalid we KEEP the partial draft so the user can correct it, but
   * we don't send junk to the server (save handler reads `pcts`, and
   * the equality check skips unchanged values).
   */
  const commitPct = useCallback(
    (zone: keyof ZonePercents, raw: number | null) => {
      // Build a working partial from the four current string mirrors
      // with the just-edited field overridden by `raw`.
      const draft: Partial<ZonePercents> = {
        z1: zone === "z1" ? raw ?? undefined : parseZonePct(pctZ1Str) ?? undefined,
        z2: zone === "z2" ? raw ?? undefined : parseZonePct(pctZ2Str) ?? undefined,
        z3: zone === "z3" ? raw ?? undefined : parseZonePct(pctZ3Str) ?? undefined,
        z4: zone === "z4" ? raw ?? undefined : parseZonePct(pctZ4Str) ?? undefined,
      };
      const validated = validateZonePercents(draft);
      const nextPercents: HrPercentsByMethod = { ...value.hrPercents };
      if (validated) {
        nextPercents[value.hrMethod] = validated;
      } else {
        // Partial / invalid → clear this method's slot so save sees no
        // override (the preview falls back to defaults until valid).
        delete nextPercents[value.hrMethod];
      }
      commit({ hrPercents: nextPercents });
    },
    [pctZ1Str, pctZ2Str, pctZ3Str, pctZ4Str, value.hrPercents, value.hrMethod, commit],
  );

  const pctDraft: Partial<ZonePercents> = useMemo(
    () => ({
      z1: parseZonePct(pctZ1Str) ?? undefined,
      z2: parseZonePct(pctZ2Str) ?? undefined,
      z3: parseZonePct(pctZ3Str) ?? undefined,
      z4: parseZonePct(pctZ4Str) ?? undefined,
    }),
    [pctZ1Str, pctZ2Str, pctZ3Str, pctZ4Str],
  );
  const pctErrors = useMemo(() => pctFieldErrors(pctDraft), [pctDraft]);

  const onResetPcts = useCallback(() => {
    const nextPercents: HrPercentsByMethod = { ...value.hrPercents };
    delete nextPercents[value.hrMethod];
    setPctZ1Str("");
    setPctZ2Str("");
    setPctZ3Str("");
    setPctZ4Str("");
    commit({ hrPercents: nextPercents });
  }, [value.hrPercents, value.hrMethod, commit]);

  // Keep pct string mirrors aligned with persisted overrides when the
  // method picker flips — otherwise switching methods could show stale
  // numbers from the previously-active method.
  const syncPctStringsForMethod = useCallback(
    (method: HrMethod) => {
      const p = value.hrPercents[method];
      setPctZ1Str(pctToDisplay(p?.z1));
      setPctZ2Str(pctToDisplay(p?.z2));
      setPctZ3Str(pctToDisplay(p?.z3));
      setPctZ4Str(pctToDisplay(p?.z4));
    },
    [value.hrPercents],
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

  const activeDefaults = DEFAULT_ZONE_PCTS[value.hrMethod];

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
              onChange={(e) => {
                const next = e.target.value as HrMethod;
                commit({ hrMethod: next });
                syncPctStringsForMethod(next);
              }}
              style={selectStyle}
            >
              <option value="max">% of max heart rate</option>
              <option value="hrr">% of heart-rate reserve</option>
              <option value="lthr">% of lactate threshold (LTHR)</option>
            </select>
            <span style={{ ...errorStyle, color: "var(--cp-text-muted)" }}>
              {hrMethodHelpText(value.hrMethod)}
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
            data-testid="hr-pcts-section"
            style={{ display: "grid", gap: 8 }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>Zone breakpoints (%)</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 8,
              }}
            >
              {(["z1", "z2", "z3", "z4"] as const).map((zone, idx) => {
                const strSetters = [setPctZ1Str, setPctZ2Str, setPctZ3Str, setPctZ4Str];
                const strs = [pctZ1Str, pctZ2Str, pctZ3Str, pctZ4Str];
                const labelMap = { z1: "Z1 ≤", z2: "Z2 ≤", z3: "Z3 ≤", z4: "Z4 ≤" } as const;
                const err = pctErrors[zone];
                return (
                  <label key={zone} style={labelStyle}>
                    {labelMap[zone]}
                    <span
                      style={{
                        position: "relative",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      <input
                        data-testid={`hr-pct-input-${zone}`}
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        value={strs[idx]}
                        placeholder={String(Math.round(activeDefaults[zone] * 100))}
                        onChange={(e) => {
                          const raw = e.target.value;
                          strSetters[idx](raw);
                          commitPct(zone, parseZonePct(raw));
                        }}
                        style={{ ...inputStyle, width: "100%", paddingRight: 22 }}
                      />
                      <span
                        aria-hidden
                        style={{
                          position: "absolute",
                          right: 8,
                          fontSize: 12,
                          color: "var(--cp-text-muted)",
                          pointerEvents: "none",
                        }}
                      >
                        %
                      </span>
                    </span>
                    {err && (
                      <span style={errorStyle} data-testid={`hr-pct-error-${zone}`}>
                        {err}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            <button
              type="button"
              data-testid="hr-pcts-reset"
              onClick={onResetPcts}
              style={{
                justifySelf: "start",
                padding: "4px 10px",
                borderRadius: 8,
                border: "1px solid var(--cp-border)",
                background: "var(--cp-surface)",
                color: "var(--cp-text)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Reset percentages to default
            </button>
          </div>

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
                setPctZ1Str("");
                setPctZ2Str("");
                setPctZ3Str("");
                setPctZ4Str("");
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
