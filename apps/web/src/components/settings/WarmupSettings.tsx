"use client";

/**
 * Warmup-ladder settings editor.
 *
 * Lets the user pick a curated preset (Standard / Long / Quick /
 * Skip) or fall through to Custom and edit the percent + rep ladders
 * by hand. A live preview block shows what the ladder looks like
 * against an 85% TM top set so the lifter can sanity-check the
 * resulting warmup before saving.
 *
 * Stores the resolved scheme on `profiles.warmup_scheme` via
 * `updateWarmupScheme`. Setting `Skip warmups` writes `setCount: 0`,
 * which the engine treats as "no auto-warmups for this user" — useful
 * for users who manage their own ramp.
 */
import { useCallback, useMemo, useState } from "react";
import { updateWarmupScheme } from "@/lib/settings/warmup-actions";
import {
  WARMUP_PRESETS,
  presetByKey,
  presetKeyForScheme,
  type WarmupPresetKey,
} from "@/lib/settings/warmup-presets";
import {
  generateWarmupItems,
  isWellFormedScheme,
  type WarmupScheme,
} from "@/lib/planner/warmups";
import { useAutoSave } from "@/lib/settings/use-auto-save";
import { AutoSaveStatus } from "./AutoSaveStatus";

export type WarmupSettingsProps = {
  initial: WarmupScheme;
};

const PREVIEW_TOP_PERCENT = 85;
const MAX_SET_COUNT = 5;

function normaliseLadders(scheme: WarmupScheme, nextSetCount: number): WarmupScheme {
  const pct = scheme.percentLadder.slice(0, nextSetCount);
  const reps = scheme.repLadder.slice(0, nextSetCount);
  while (pct.length < nextSetCount) {
    pct.push(pct[pct.length - 1] ?? 40);
  }
  while (reps.length < nextSetCount) {
    reps.push(reps[reps.length - 1] ?? 5);
  }
  return { setCount: nextSetCount, percentLadder: pct, repLadder: reps };
}

export function WarmupSettings({ initial }: WarmupSettingsProps) {
  const initialPreset = presetKeyForScheme(initial);
  const [preset, setPreset] = useState<WarmupPresetKey>(initialPreset);

  // Auto-save closure: validate well-formedness here so a malformed
  // intermediate state (e.g. percent field cleared mid-edit) never
  // hits the server action's stricter schema parser.
  const save = useCallback(async (next: WarmupScheme) => {
    if (!isWellFormedScheme(next)) {
      // Surface the malformed state as a save error so the user sees
      // the inline status chip — keeps parity with the previous
      // submit-time validation message.
      throw new Error("Warmup ladder is malformed — check the percent + rep counts.");
    }
    const fd = new FormData();
    fd.set("warmupSchemeJson", JSON.stringify(next));
    await updateWarmupScheme(fd);
  }, []);

  const {
    value: scheme,
    setValue: setSchemeAndSave,
    status,
    retry,
    lastError,
  } = useAutoSave<WarmupScheme>({
    initial,
    save,
    debounceMs: 500,
  });

  const onPresetChange = (next: WarmupPresetKey) => {
    setPreset(next);
    if (next !== "custom") {
      // Cloning the arrays so subsequent edits in Custom mode don't
      // mutate the canonical preset.
      const p = presetByKey(next).scheme;
      setSchemeAndSave({
        setCount: p.setCount,
        percentLadder: [...p.percentLadder],
        repLadder: [...p.repLadder],
      });
    }
  };

  const setSetCount = (n: number) => {
    setSchemeAndSave(
      normaliseLadders(scheme, Math.max(1, Math.min(MAX_SET_COUNT, n))),
    );
  };

  const setPct = (i: number, v: string) => {
    const next = [...scheme.percentLadder];
    next[i] = Number(v);
    setSchemeAndSave({ ...scheme, percentLadder: next });
  };

  const setReps = (i: number, v: string) => {
    const next = [...scheme.repLadder];
    next[i] = Number(v);
    setSchemeAndSave({ ...scheme, repLadder: next });
  };

  // Live preview of the ladder the user is holding, against an 85% TM
  // top set. `generateWarmupItems` is faithful to the scheme it is
  // handed (it only substitutes the default for a structurally
  // malformed one), so the preview can never contradict the Custom
  // inputs above it — in particular the migration-0039 legacy upgrade
  // in `resolveWarmupScheme` is a read-boundary concern and must not
  // reach this render.
  const preview = useMemo(
    () => generateWarmupItems("preview", PREVIEW_TOP_PERCENT, scheme),
    [scheme],
  );

  const customEditable = preset === "custom";

  return (
    <div
      data-testid="warmup-settings-form"
      style={{ display: "grid", gap: 16 }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--cp-text-muted)",
          lineHeight: 1.5,
        }}
      >
        A warmup ladder ramps you into the working weight before each main
        lift. Pick a preset — or go Custom and dial it in.
      </p>

      <label
        style={{
          display: "grid",
          gap: 6,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--cp-text-muted)",
        }}
      >
        Preset
        <select
          value={preset}
          onChange={(e) => onPresetChange(e.target.value as WarmupPresetKey)}
          data-testid="warmup-preset-select"
          style={selectStyle}
        >
          {WARMUP_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {customEditable && scheme.setCount > 0 && (
        <fieldset
          style={{
            display: "grid",
            gap: 10,
            border: "1px solid var(--cp-border)",
            borderRadius: 12,
            padding: 12,
          }}
        >
          <legend
            style={{
              padding: "0 6px",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--cp-text-muted)",
            }}
          >
            Custom ladder
          </legend>

          <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--cp-text-muted)" }}>
            Number of warmup sets (1–{MAX_SET_COUNT})
            <select
              value={scheme.setCount}
              onChange={(e) => setSetCount(Number(e.target.value))}
              data-testid="warmup-set-count"
              style={selectStyle}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <div
            data-testid="warmup-percent-row"
            style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--cp-text-muted)" }}
          >
            <span>Percent ladder (% of top set)</span>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${scheme.setCount}, 1fr)`, gap: 6 }}>
              {scheme.percentLadder.map((v, i) => (
                <input
                  key={i}
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  inputMode="numeric"
                  value={v}
                  data-testid={`warmup-percent-${i}`}
                  onChange={(e) => setPct(i, e.target.value)}
                  style={inputStyle}
                />
              ))}
            </div>
          </div>

          <div
            data-testid="warmup-reps-row"
            style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--cp-text-muted)" }}
          >
            <span>Rep ladder</span>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${scheme.setCount}, 1fr)`, gap: 6 }}>
              {scheme.repLadder.map((v, i) => (
                <input
                  key={i}
                  type="number"
                  step="1"
                  min="1"
                  max="20"
                  inputMode="numeric"
                  value={v}
                  data-testid={`warmup-reps-${i}`}
                  onChange={(e) => setReps(i, e.target.value)}
                  style={inputStyle}
                />
              ))}
            </div>
          </div>
        </fieldset>
      )}

      <div
        data-testid="warmup-preview"
        style={{
          display: "grid",
          gap: 6,
          border: "1px solid var(--cp-border)",
          borderRadius: 12,
          padding: 12,
          background: "var(--cp-surface)",
        }}
      >
        <span
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--cp-text-muted)",
          }}
        >
          Preview against an {PREVIEW_TOP_PERCENT}% TM top set
        </span>
        {preview.length === 0 ? (
          <span style={{ fontSize: 13, color: "var(--cp-text-muted)", fontStyle: "italic" }}>
            No warm-ups — your sessions start at the first working set.
          </span>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 2 }}>
            {preview.map((it, i) => (
              <li
                key={i}
                data-testid={`warmup-preview-${i}`}
                style={{
                  fontFamily: "var(--cp-font-mono)",
                  fontSize: 13,
                  color: "var(--cp-text)",
                }}
              >
                • Warmup {i + 1}: {it.percentTm}% TM × {it.reps}
              </li>
            ))}
          </ul>
        )}
      </div>

      {lastError && (
        <div
          role="alert"
          data-testid="warmup-settings-error"
          style={{ fontSize: 12, color: "var(--cp-danger)" }}
        >
          {lastError}
        </div>
      )}
      {/* "Saved" wrapper preserved for back-compat with the e2e spec
          that asserts on `warmup-settings-saved`. */}
      {status === "saved" && (
        <div
          role="status"
          data-testid="warmup-settings-saved"
          style={{ fontSize: 12, color: "var(--cp-success)" }}
        >
          Saved.
        </div>
      )}
      <AutoSaveStatus
        status={status}
        onRetry={retry}
        testIdSuffix="warmup-settings"
      />
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
  fontFamily: "var(--cp-font-mono)",
  fontSize: 13,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "auto",
};
