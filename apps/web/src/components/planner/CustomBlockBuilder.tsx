"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  CARDIO_KINDS_WITH_DURATION,
  CUSTOM_DAY_OPTIONS,
  DEFAULT_DURATION_FOR,
  WAVE_TEMPLATES,
  type CustomArchetypeInput,
  type CustomDayKind,
  type WaveTemplateId,
} from "@/lib/planner/custom";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKS_OPTIONS = [3, 4, 5, 6];

type DayState = { dayIndex: number; kind: CustomDayKind; durationMinOverride?: number };

export function CustomBlockBuilder({
  defaultStartedOn,
  defaultDaysPerWeek,
  hasAnyStrengthTm,
  action,
}: {
  defaultStartedOn: string;
  defaultDaysPerWeek: number;
  hasAnyStrengthTm: boolean;
  action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [name, setName] = useState<string>("");
  const [weeks, setWeeks] = useState<number>(4);
  const [startedOn, setStartedOn] = useState<string>(defaultStartedOn);
  const [waveTemplate, setWaveTemplate] = useState<WaveTemplateId>("fives");

  // Seed a sensible week shape based on the user's typical days/week.
  const initialDays = useMemo<DayState[]>(() => seedWeek(defaultDaysPerWeek), [defaultDaysPerWeek]);
  const [days, setDays] = useState<DayState[]>(initialDays);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const nonRestDays = days.filter((d) => d.kind !== "rest");
  const strengthDayCount = nonRestDays.filter((d) => d.kind.startsWith("strength_")).length;
  const cardioDayCount = nonRestDays.filter((d) => d.kind.startsWith("cardio_")).length;
  const tendonDayCount = nonRestDays.filter((d) => d.kind.startsWith("tendon_")).length;
  const daysPerWeek = nonRestDays.length;

  const hasStrengthDay = strengthDayCount > 0;
  const isReady = daysPerWeek >= 1 && (!hasStrengthDay || hasAnyStrengthTm);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (daysPerWeek < 1) {
      setError("Pick at least one non-rest day.");
      return;
    }
    if (hasStrengthDay && !hasAnyStrengthTm) {
      setError("This block has strength days but you haven't set a TM for any main lift yet.");
      return;
    }
    const config: CustomArchetypeInput = {
      name: name.trim() || undefined,
      weeks,
      startedOn,
      daysPerWeek,
      waveTemplate,
      days: nonRestDays,
    };
    const fd = new FormData();
    fd.set("config", JSON.stringify(config));
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/app/plan");
      router.refresh();
    });
  };

  const setDayKind = (dayIndex: number, kind: CustomDayKind) => {
    setDays((prev) => {
      const next = prev.filter((d) => d.dayIndex !== dayIndex);
      // When kind changes, drop any prior duration override (defaults take over).
      next.push({ dayIndex, kind });
      next.sort((a, b) => a.dayIndex - b.dayIndex);
      return next;
    });
  };
  const setDayDuration = (dayIndex: number, minutes: number | undefined) => {
    setDays((prev) => {
      const next = prev.map((d) =>
        d.dayIndex === dayIndex ? { ...d, durationMinOverride: minutes } : d,
      );
      return next;
    });
  };
  const dayStateFor = (dayIndex: number): DayState =>
    days.find((d) => d.dayIndex === dayIndex) ?? { dayIndex, kind: "rest" };

  // Group dropdown options for the optgroup-style picker.
  const optionGroups = useMemo(() => {
    const groups = new Map<string, typeof CUSTOM_DAY_OPTIONS>();
    for (const opt of CUSTOM_DAY_OPTIONS) {
      const arr = groups.get(opt.group) ?? [];
      arr.push(opt);
      groups.set(opt.group, arr);
    }
    return Array.from(groups.entries());
  }, []);

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
      {/* Block details */}
      <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Block details</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <Label>Block name (optional)</Label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="e.g. October base"
              style={{ width: "100%", padding: "8px 10px", fontSize: 14, marginTop: 4 }}
            />
          </div>
          <div>
            <Label>Start date</Label>
            <input
              type="date"
              value={startedOn}
              onChange={(e) => setStartedOn(e.target.value)}
              required
              style={{ width: "100%", padding: "8px 10px", fontSize: 14, marginTop: 4 }}
            />
          </div>
        </div>
        <div>
          <Label>Weeks</Label>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {WEEKS_OPTIONS.map((n) => {
              const sel = n === weeks;
              return (
                <button
                  type="button"
                  key={n}
                  onClick={() => setWeeks(n)}
                  aria-pressed={sel}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 999,
                    border: `1px solid ${sel ? "var(--cp-accent)" : "var(--cp-border)"}`,
                    background: sel ? "var(--cp-accent-soft)" : "var(--cp-surface)",
                    color: sel ? "var(--cp-accent)" : "var(--cp-text)",
                    fontWeight: sel ? 600 : 500,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {n} wk
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 4 }}>
            Last week is always a deload.
          </div>
        </div>
      </section>

      {/* Wave template */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Strength intensity wave</h2>
        <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Applied to every strength day. Reps and per-set % of TM come from the chosen wave.
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {Object.values(WAVE_TEMPLATES).map((w) => {
            const sel = w.id === waveTemplate;
            return (
              <button
                type="button"
                key={w.id}
                onClick={() => setWaveTemplate(w.id)}
                aria-pressed={sel}
                style={{
                  textAlign: "left",
                  padding: 12,
                  borderRadius: 10,
                  border: `1px solid ${sel ? "var(--cp-accent)" : "var(--cp-border)"}`,
                  background: sel ? "var(--cp-accent-soft)" : "var(--cp-surface)",
                  color: "var(--cp-text)",
                  cursor: "pointer",
                  display: "grid",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{w.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                    {w.weeks.slice(0, w.weeks.length - 1).map((p) => p.intensityLabel).join(" → ")} → Deload
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.45 }}>{w.description}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Week shape */}
      <section className="cp-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Week shape</h2>
          <span className="cp-pill">
            {daysPerWeek} d/wk · {strengthDayCount}S + {cardioDayCount}C{tendonDayCount > 0 ? ` + ${tendonDayCount}T` : ""}
          </span>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Pick what happens on each day. Strength days use the variant you&apos;ve set a TM for.
        </p>
        <div style={{ display: "grid", gap: 6 }}>
          {Array.from({ length: 7 }, (_, dayIndex) => {
            const state = dayStateFor(dayIndex);
            const kind = state.kind;
            const isRest = kind === "rest";
            const option = CUSTOM_DAY_OPTIONS.find((o) => o.value === kind);
            const canEditDuration = CARDIO_KINDS_WITH_DURATION.includes(kind);
            const defaultDuration = DEFAULT_DURATION_FOR[kind];
            const currentDuration = state.durationMinOverride ?? defaultDuration ?? 0;
            return (
              <div
                key={dayIndex}
                style={{
                  display: "grid",
                  gridTemplateColumns: "60px 1fr",
                  gap: 10,
                  alignItems: "start",
                  padding: "8px 0",
                  borderTop: dayIndex === 0 ? "none" : "1px solid var(--cp-border)",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: isRest ? "var(--cp-text-muted)" : "var(--cp-text)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    paddingTop: 8,
                  }}
                >
                  {DOW[dayIndex]}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: canEditDuration ? "1fr 110px" : "1fr",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <select
                      value={kind}
                      onChange={(e) => setDayKind(dayIndex, e.target.value as CustomDayKind)}
                      aria-label={`${DOW[dayIndex]} session kind`}
                      style={{
                        padding: "8px 10px",
                        fontSize: 14,
                        color: isRest ? "var(--cp-text-muted)" : "var(--cp-text)",
                      }}
                    >
                      {optionGroups.map(([group, items]) =>
                        group === "—" ? (
                          items.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))
                        ) : (
                          <optgroup key={group} label={group}>
                            {items.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </optgroup>
                        ),
                      )}
                    </select>
                    {canEditDuration && (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input
                          type="number"
                          value={currentDuration}
                          min={5}
                          max={240}
                          step={5}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isNaN(n)) return;
                            // If they typed the default, clear the override so it stays "default".
                            setDayDuration(
                              dayIndex,
                              defaultDuration != null && n === defaultDuration ? undefined : n,
                            );
                          }}
                          inputMode="numeric"
                          aria-label={`${DOW[dayIndex]} duration in minutes`}
                          className="mono"
                          style={{ width: 70, padding: "8px 8px", fontSize: 14, textAlign: "right" }}
                        />
                        <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>min</span>
                      </div>
                    )}
                  </div>
                  {!isRest && option && (
                    <div style={{ fontSize: 11, color: "var(--cp-text-muted)", lineHeight: 1.45 }}>
                      {option.description}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {hasStrengthDay && !hasAnyStrengthTm && (
        <section
          className="cp-card"
          style={{
            padding: 16,
            borderColor: "var(--cp-danger)",
            background: "color-mix(in oklab, var(--cp-danger) 8%, transparent)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--cp-danger)" }}>
            <strong>You&apos;ve got strength days but no TMs set</strong> — the planner can&apos;t pick a variant
            without one.
          </div>
          <Link href="/app/settings/training-maxes" className="cp-btn primary" style={{ fontSize: 13 }}>
            Set TMs now →
          </Link>
        </section>
      )}

      {error && (
        <div
          role="alert"
          className="cp-card"
          style={{
            padding: 12,
            borderColor: "var(--cp-danger)",
            background: "color-mix(in oklab, var(--cp-danger) 8%, transparent)",
            color: "var(--cp-danger)",
            fontSize: 13,
          }}
        >
          Couldn&apos;t create the block: {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Link href="/app/plan/new" style={{ fontSize: 13, color: "var(--cp-link)", textDecoration: "none" }}>
          ← back to presets
        </Link>
        <button type="submit" className="cp-btn primary big" disabled={!isReady || isPending}>
          {isPending ? "Generating…" : `Generate ${weeks}-week block →`}
        </button>
      </div>
    </form>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        color: "var(--cp-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </span>
  );
}

// Seed a sensible starting week shape based on the user's typical days/week.
function seedWeek(daysPerWeek: number): DayState[] {
  // Strength-led default: Mon Squat, Tue Bench, Wed Z2, Thu Deadlift, Fri OHP, Sat Long Z2, Sun rest.
  const all: DayState[] = [
    { dayIndex: 0, kind: "strength_squat" },
    { dayIndex: 1, kind: "strength_horizontal_press" },
    { dayIndex: 2, kind: "cardio_z2_short" },
    { dayIndex: 3, kind: "strength_deadlift" },
    { dayIndex: 4, kind: "strength_vertical_press" },
    { dayIndex: 5, kind: "cardio_z2_long" },
    { dayIndex: 6, kind: "rest" },
  ];
  // Mark days beyond daysPerWeek as rest.
  const active = Math.min(daysPerWeek, 6);
  for (let i = 0; i < all.length; i++) {
    const trimmed = all.filter((d) => d.kind !== "rest").length;
    if (trimmed <= active) break;
    // drop the lowest-rank optional first (cardio days).
    const cardioIdx = [...all].reverse().find((d) => d.kind.startsWith("cardio_"))?.dayIndex;
    if (cardioIdx == null) break;
    all[cardioIdx]!.kind = "rest";
  }
  return all;
}
