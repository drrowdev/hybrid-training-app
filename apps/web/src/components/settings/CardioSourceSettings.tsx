"use client";

/**
 * Cardio-source settings editor.
 *
 * Phase 1 "external cardio". Lets the user opt-in to "I follow an
 * external run program" at the profile level — the BlockWizard step-3
 * toggle pre-fills from this so the user doesn't have to re-check it
 * every block. Auto-saves via the shared `useAutoSave` pattern
 * (mirrors `WarmupSettings`).
 *
 * Doesn't touch existing `training_blocks` rows. Doesn't appear in
 * onboarding (Phase 1 scope — see the PR "Don't" list).
 */
import { useCallback } from "react";
import { useAutoSave } from "@/lib/settings/use-auto-save";
import { updatePreferredCardioSource } from "@/lib/settings/cardio-source-actions";
import { AutoSaveStatus } from "./AutoSaveStatus";

export type CardioSourceValue = {
  source: "internal" | "external";
  name: string;
};

export type CardioSourceSettingsProps = {
  initial: CardioSourceValue;
};

export function CardioSourceSettings({ initial }: CardioSourceSettingsProps) {
  const save = useCallback(async (next: CardioSourceValue) => {
    const fd = new FormData();
    fd.set("preferredCardioSource", next.source);
    if (next.source === "external" && next.name.trim().length > 0) {
      fd.set("preferredCardioSourceName", next.name.trim());
    }
    await updatePreferredCardioSource(fd);
  }, []);

  const {
    value,
    setValue,
    status,
    retry,
    lastError,
  } = useAutoSave<CardioSourceValue>({
    initial,
    save,
    debounceMs: 500,
    equals: (a, b) => a.source === b.source && a.name.trim() === b.name.trim(),
  });

  const checked = value.source === "external";

  return (
    <div
      data-testid="cardio-source-settings"
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
        Reserves cardio days for recovery math but lets you log runs via your
        program of choice (Runna, Garmin Coach, Hal Higdon, etc.). Applies to
        new blocks; existing blocks aren&apos;t changed.
      </p>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) =>
            setValue({
              ...value,
              source: e.target.checked ? "external" : "internal",
            })
          }
          data-testid="cardio-source-toggle"
          style={{ marginTop: 3 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          Use external run program by default
        </span>
      </label>

      {checked && (
        <label
          style={{
            display: "grid",
            gap: 4,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--cp-text-muted)",
          }}
        >
          Program name (optional)
          <input
            type="text"
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={80}
            placeholder="Runna"
            data-testid="cardio-source-name"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--cp-border)",
              background: "var(--cp-surface)",
              color: "var(--cp-text)",
              fontFamily: "inherit",
              fontSize: 13,
              textTransform: "none",
              letterSpacing: "normal",
            }}
          />
        </label>
      )}

      {lastError && (
        <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {lastError}
        </div>
      )}
      <AutoSaveStatus
        status={status}
        onRetry={retry}
        testIdSuffix="cardio-source"
      />
    </div>
  );
}
