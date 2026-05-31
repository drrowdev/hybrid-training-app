"use client";

/**
 * ADR 0017 — ranked cardio-modality preference editor.
 *
 * Lets the user pick which cardio forms the planner programs, in priority
 * order. The planner substitutes the default (running) cardio movement for
 * the user's top *feasible* modality at the prescribed intensity; if none
 * of the picked modalities can cover a given interval day, it falls back to
 * running. Empty list = the default running-everywhere behaviour.
 *
 * Auto-saves via the shared `useAutoSave` pattern (mirrors
 * `CardioSourceSettings`). Doesn't touch existing `training_blocks`.
 */
import { useCallback } from "react";

import { useAutoSave } from "@/lib/settings/use-auto-save";
import { updatePreferredCardioModalities } from "@/lib/settings/cardio-modality-actions";
import {
  PREFERRED_CARDIO_MODALITIES,
  PREFERRED_CARDIO_MODALITY_LABEL,
  type PreferredCardioModality,
} from "@/lib/planner/preferred-cardio-modality";
import { AutoSaveStatus } from "./AutoSaveStatus";

export type CardioModalitySettingsProps = {
  initial: PreferredCardioModality[];
};

const BTN_STYLE: React.CSSProperties = {
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
  borderRadius: 6,
  padding: "2px 8px",
  fontSize: 13,
  cursor: "pointer",
  lineHeight: 1.6,
};

export function CardioModalitySettings({
  initial,
}: CardioModalitySettingsProps) {
  const save = useCallback(async (next: PreferredCardioModality[]) => {
    const fd = new FormData();
    fd.set("modalities", JSON.stringify(next));
    await updatePreferredCardioModalities(fd);
  }, []);

  const { value, setValue, status, retry, lastError } = useAutoSave<
    PreferredCardioModality[]
  >({
    initial,
    save,
    debounceMs: 500,
    equals: (a, b) => a.length === b.length && a.every((m, i) => m === b[i]),
  });

  const selected = value;
  const available = PREFERRED_CARDIO_MODALITIES.filter(
    (m) => !selected.includes(m),
  );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= selected.length) return;
    const next = [...selected];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setValue(next);
  };

  return (
    <div
      data-testid="cardio-modality-settings"
      style={{ display: "grid", gap: 12 }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--cp-text-muted)",
          lineHeight: 1.5,
        }}
      >
        Pick which cardio forms get programmed, in priority order. New blocks
        use your top choice that fits the day and your equipment. Running is
        the fallback — hard interval days may stay running if your picks
        can&apos;t cover them. Leave empty to run everything.
      </p>

      {selected.length > 0 && (
        <ol
          data-testid="cardio-modality-ranked"
          style={{ display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" }}
        >
          {selected.map((m, i) => (
            <li
              key={m}
              data-testid={`cardio-modality-rank-${m}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid var(--cp-border)",
                background: "var(--cp-surface)",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--cp-text-muted)",
                  minWidth: 16,
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                {PREFERRED_CARDIO_MODALITY_LABEL[m]}
              </span>
              <button
                type="button"
                aria-label={`Move ${PREFERRED_CARDIO_MODALITY_LABEL[m]} up`}
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
                style={{ ...BTN_STYLE, opacity: i === 0 ? 0.4 : 1 }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${PREFERRED_CARDIO_MODALITY_LABEL[m]} down`}
                disabled={i === selected.length - 1}
                onClick={() => move(i, i + 1)}
                style={{
                  ...BTN_STYLE,
                  opacity: i === selected.length - 1 ? 0.4 : 1,
                }}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Remove ${PREFERRED_CARDIO_MODALITY_LABEL[m]}`}
                data-testid={`cardio-modality-remove-${m}`}
                onClick={() => setValue(selected.filter((x) => x !== m))}
                style={BTN_STYLE}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}

      {available.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {available.map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`cardio-modality-add-${m}`}
              onClick={() => setValue([...selected, m])}
              style={{ ...BTN_STYLE, padding: "4px 10px" }}
            >
              + {PREFERRED_CARDIO_MODALITY_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      {lastError && (
        <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {lastError}
        </div>
      )}
      <AutoSaveStatus
        status={status}
        onRetry={retry}
        testIdSuffix="cardio-modality"
      />
    </div>
  );
}
