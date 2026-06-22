"use client";

/**
 * PreferencesEditor — inline edits for AM/PM windows + units.
 *
 * Time inputs (`<input type="time">`) commit on change. Units use a
 * two-option radio group that submits immediately. Each edit is its
 * own server-action round-trip; the rail card stays narrow.
 *
 * Keyboard: native input controls handle Enter / Tab / Esc.
 */

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/profile/actions";

export type PreferencesEditorProps = {
  amWindowStart: string;
  pmWindowStart: string;
  units: "metric" | "imperial";
  gender: "male" | "female" | null;
  action: (formData: FormData) => Promise<ActionResult>;
};

export function PreferencesEditor({
  amWindowStart,
  pmWindowStart,
  units,
  gender,
  action,
}: PreferencesEditorProps) {
  const [am, setAm] = useState(amWindowStart);
  const [pm, setPm] = useState(pmWindowStart);
  const [u, setU] = useState(units);
  const [g, setG] = useState<"male" | "female" | null>(gender);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const submit = (field: "am" | "pm" | "units" | "gender", value: string) => {
    const fd = new FormData();
    if (field === "am") fd.set("amWindowStart", value);
    if (field === "pm") fd.set("pmWindowStart", value);
    if (field === "units") fd.set("units", value);
    if (field === "gender") fd.set("gender", value);
    startTransition(async () => {
      const result = await action(fd);
      if (result.ok) {
        setSavedKey(`${field}:${value}`);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div
      data-testid="preferences-editor"
      style={{ display: "grid", gap: 14 }}
    >
      <Row label="AM window">
        <input
          type="time"
          data-testid="prefs-am-window"
          className="mono"
          value={am}
          onChange={(e) => setAm(e.target.value)}
          onBlur={(e) => {
            if (/^\d{2}:\d{2}$/.test(e.target.value) && e.target.value !== amWindowStart) {
              submit("am", e.target.value);
            }
          }}
          disabled={pending}
          aria-label="AM window start"
          style={timeInputStyle}
        />
      </Row>
      <Row label="PM window">
        <input
          type="time"
          data-testid="prefs-pm-window"
          className="mono"
          value={pm}
          onChange={(e) => setPm(e.target.value)}
          onBlur={(e) => {
            if (/^\d{2}:\d{2}$/.test(e.target.value) && e.target.value !== pmWindowStart) {
              submit("pm", e.target.value);
            }
          }}
          disabled={pending}
          aria-label="PM window start"
          style={timeInputStyle}
        />
      </Row>
      <Row label="Units">
        <div
          role="radiogroup"
          aria-label="Units"
          style={{ display: "inline-flex", gap: 4 }}
        >
          {(["metric", "imperial"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={u === opt}
              data-testid={`prefs-units-${opt}`}
              data-selected={u === opt ? "true" : "false"}
              disabled={pending}
              onClick={() => {
                if (u === opt) return;
                setU(opt);
                submit("units", opt);
              }}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                borderRadius: 999,
                border: "1px solid var(--cp-border)",
                background:
                  u === opt
                    ? "var(--cp-accent-soft, var(--cp-surface-soft))"
                    : "transparent",
                color: u === opt ? "var(--cp-accent, var(--cp-text))" : "var(--cp-text-muted)",
                cursor: "pointer",
                fontWeight: u === opt ? 600 : 500,
                fontFamily: "inherit",
              }}
            >
              {opt === "metric" ? "kg" : "lb"}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Gender">
        <div
          role="radiogroup"
          aria-label="Gender"
          style={{ display: "inline-flex", gap: 4 }}
        >
          {(["male", "female"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={g === opt}
              data-testid={`prefs-gender-${opt}`}
              data-selected={g === opt ? "true" : "false"}
              disabled={pending}
              onClick={() => {
                if (g === opt) return;
                setG(opt);
                submit("gender", opt);
              }}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                borderRadius: 999,
                border: "1px solid var(--cp-border)",
                background:
                  g === opt
                    ? "var(--cp-accent-soft, var(--cp-surface-soft))"
                    : "transparent",
                color: g === opt ? "var(--cp-accent, var(--cp-text))" : "var(--cp-text-muted)",
                cursor: "pointer",
                fontWeight: g === opt ? 600 : 500,
                fontFamily: "inherit",
              }}
            >
              {opt === "male" ? "Male" : "Female"}
            </button>
          ))}
        </div>
      </Row>
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-text-muted)",
          minHeight: 14,
        }}
      >
        {pending && <span>Saving…</span>}
        {!pending && savedKey && !error && <span>Saved</span>}
        {error && (
          <span
            role="alert"
            data-testid="prefs-error"
            style={{ color: "var(--cp-danger, #d33)" }}
          >
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

const timeInputStyle: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: 13,
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
  fontVariantNumeric: "tabular-nums",
};

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: "var(--cp-text-muted)",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
