"use client";

/**
 * Minimal program picker (platform cutover PR4).
 *
 * Lets a signed-in user deploy a platform program end-to-end: pick a program,
 * fill its engine-described setup fields, choose training weekdays + a start
 * date, and deploy via `createProgramInstance`. Intentionally minimal — it
 * validates the deploy → Today → log → stats loop on 5/3/1. The richer wizard
 * (cluster/benchmark step, GP multi-block roadmap) is a follow-up.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProgramInstance, type CreateProgramInstanceResult } from "@/lib/platform/actions";

export interface PickerField {
  key: string;
  label: string;
  type: "training-max" | "number" | "select" | "boolean" | "days";
  options?: { value: string; label: string }[];
  defaultValue?: unknown;
  help?: string;
}

export interface PickerProgram {
  id: string;
  name: string;
  family: string;
  summary: string;
  /** Whether this program's deploy path is wired (only 5/3/1 for now). */
  enabled: boolean;
  fields: PickerField[];
}

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function defaultValuesFor(fields: PickerField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "boolean") out[f.key] = f.defaultValue ?? false;
    else if (f.type === "number") out[f.key] = f.defaultValue ?? 0;
    else if (f.type === "select") out[f.key] = f.defaultValue ?? f.options?.[0]?.value ?? "";
    else out[f.key] = f.defaultValue ?? "";
  }
  return out;
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ProgramPicker({
  programs,
  anchoredKeys,
}: {
  programs: PickerProgram[];
  anchoredKeys: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateProgramInstanceResult | null>(null);

  const firstEnabled = programs.find((p) => p.enabled) ?? programs[0];
  const [selectedId, setSelectedId] = useState<string>(firstEnabled?.id ?? "");
  const selected = programs.find((p) => p.id === selectedId) ?? null;

  const [values, setValues] = useState<Record<string, unknown>>(() =>
    defaultValuesFor(firstEnabled?.fields ?? []),
  );
  // Mon/Tue/Thu/Fri default — the conventional 4-day split.
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 3, 4]);
  const [startedOn, setStartedOn] = useState<string>(todayYmd());

  const hasNoTms = anchoredKeys.length === 0;

  function selectProgram(p: PickerProgram) {
    if (!p.enabled) return;
    setSelectedId(p.id);
    setValues(defaultValuesFor(p.fields));
    setResult(null);
  }

  function toggleDay(i: number) {
    setWeekdays((prev) => (prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i].sort((a, b) => a - b)));
  }

  function setField(key: string, raw: unknown) {
    setValues((prev) => ({ ...prev, [key]: raw }));
  }

  const canDeploy = useMemo(
    () => !!selected?.enabled && weekdays.length > 0 && !hasNoTms && !pending,
    [selected, weekdays, hasNoTms, pending],
  );

  function deploy() {
    if (!selected) return;
    setResult(null);
    startTransition(async () => {
      const res = await createProgramInstance({
        programId: selected.id,
        setupValues: values,
        weekdays,
        startedOn,
      });
      setResult(res);
      if (res.ok) router.push("/app");
    });
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {hasNoTms && (
        <p
          style={{
            margin: 0,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--cp-border, rgba(255,255,255,0.12))",
            fontSize: 13,
            color: "var(--cp-text-muted, #999)",
          }}
        >
          Set your 1-rep maxes first (Settings → Training maxes) so the program can
          prescribe weights.
        </p>
      )}

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, color: "var(--cp-text-muted, #999)" }}>
          Program
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {programs.map((p) => {
            const isSel = p.id === selectedId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectProgram(p)}
                disabled={!p.enabled}
                style={{
                  textAlign: "left",
                  padding: 14,
                  borderRadius: 10,
                  cursor: p.enabled ? "pointer" : "not-allowed",
                  opacity: p.enabled ? 1 : 0.45,
                  background: isSel ? "var(--cp-accent-soft, rgba(120,170,255,0.12))" : "transparent",
                  border: `1px solid ${isSel ? "var(--cp-accent, #6aa0ff)" : "var(--cp-border, rgba(255,255,255,0.14))"}`,
                  color: "inherit",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: "var(--cp-text-muted, #999)", marginTop: 4, lineHeight: 1.4 }}>
                  {p.enabled ? p.summary : "Coming soon"}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {selected?.enabled && (
        <>
          <section style={{ display: "grid", gap: 12 }}>
            <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, color: "var(--cp-text-muted, #999)" }}>
              Setup
            </h2>
            <div style={{ display: "grid", gap: 14, maxWidth: 420 }}>
              {selected.fields.map((f) => (
                <SetupFieldControl key={f.key} field={f} value={values[f.key]} onChange={(v) => setField(f.key, v)} />
              ))}
            </div>
          </section>

          <section style={{ display: "grid", gap: 12 }}>
            <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, color: "var(--cp-text-muted, #999)" }}>
              Schedule
            </h2>
            <div>
              <div style={{ fontSize: 12, color: "var(--cp-text-muted, #999)", marginBottom: 6 }}>Training days</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {WD.map((label, i) => {
                  const on = weekdays.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        cursor: "pointer",
                        background: on ? "var(--cp-accent, #6aa0ff)" : "transparent",
                        color: on ? "#0b0c0e" : "inherit",
                        border: `1px solid ${on ? "var(--cp-accent, #6aa0ff)" : "var(--cp-border, rgba(255,255,255,0.14))"}`,
                        fontWeight: on ? 600 : 400,
                        fontSize: 13,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: "var(--cp-text-muted, #999)", marginTop: 6 }}>
                Pick one weekday per session in a program week (5/3/1 trains 4 lifts → 4 days).
              </div>
            </div>
            <label style={{ display: "grid", gap: 6, maxWidth: 220 }}>
              <span style={{ fontSize: 12, color: "var(--cp-text-muted, #999)" }}>Start date</span>
              <input
                type="date"
                value={startedOn}
                onChange={(e) => setStartedOn(e.target.value)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid var(--cp-border, rgba(255,255,255,0.14))",
                  color: "inherit",
                }}
              />
            </label>
          </section>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              type="button"
              onClick={deploy}
              disabled={!canDeploy}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                cursor: canDeploy ? "pointer" : "not-allowed",
                opacity: canDeploy ? 1 : 0.5,
                background: "var(--cp-accent, #6aa0ff)",
                color: "#0b0c0e",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {pending ? "Deploying…" : "Deploy program"}
            </button>
            {result && !result.ok && (
              <span style={{ fontSize: 13, color: "var(--cp-danger, #e06c75)" }}>{result.error}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SetupFieldControl({
  field,
  value,
  onChange,
}: {
  field: PickerField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const labelEl = (
    <span style={{ fontSize: 12, color: "var(--cp-text-muted, #999)" }}>
      {field.label}
      {field.help ? <span style={{ display: "block", fontSize: 11, opacity: 0.8, marginTop: 2 }}>{field.help}</span> : null}
    </span>
  );
  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    background: "transparent",
    border: "1px solid var(--cp-border, rgba(255,255,255,0.14))",
    color: "inherit",
  };

  if (field.type === "select") {
    return (
      <label style={{ display: "grid", gap: 6 }}>
        {labelEl}
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === "boolean") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {labelEl}
      </label>
    );
  }
  // number (and any future numeric-ish field) — text fields fall through to here too.
  return (
    <label style={{ display: "grid", gap: 6 }}>
      {labelEl}
      <input
        type="number"
        step="any"
        value={value === undefined || value === null || value === "" ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        style={inputStyle}
      />
    </label>
  );
}
