"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { MovementPicker, type MovementSearchResult } from "@/components/movement-picker";

export type LoggedSet = {
  id: string;
  set_index: number;
  set_kind: string;
  weight_kg: number | string | null;
  reps: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  rpe: number | string | null;
  movement: {
    id: string;
    slug: string;
    display_name: string;
    primary_region: string;
  };
};

export type ActiveMovement = {
  id: string;
  slug: string;
  display_name: string;
  primary_region: string;
};

type SetAction = (fd: FormData) => Promise<{ error?: string; ok?: true }>;

const SET_KINDS = ["warmup", "main", "back_off", "accessory", "tendon"] as const;

/**
 * Calculator-grade session log.
 *
 * Owns three pieces of state:
 *  - activeMovement: which lift the entry sheet is currently logging.
 *  - weight / reps / rpe: the values about to be submitted.
 *  - showPicker: whether the "add a movement to this session" picker is open.
 *
 * Server data (sets, TM dict) arrives via props and re-flows on revalidation.
 */
export function SessionLogClient({
  sessionId,
  isComplete,
  sets,
  tmBySlug,
  addStrengthSet,
}: {
  sessionId: string;
  isComplete: boolean;
  sets: LoggedSet[];
  tmBySlug: Record<string, number>;
  addStrengthSet: SetAction;
}) {
  // Distinct movements logged so far in order of first appearance.
  const movementsInSession = useMemo(() => {
    const seen = new Map<string, ActiveMovement>();
    for (const s of sets) {
      if (!seen.has(s.movement.id)) {
        seen.set(s.movement.id, {
          id: s.movement.id,
          slug: s.movement.slug,
          display_name: s.movement.display_name,
          primary_region: s.movement.primary_region,
        });
      }
    }
    return Array.from(seen.values());
  }, [sets]);

  const lastLoggedSet = sets[sets.length - 1] ?? null;
  const defaultActive =
    movementsInSession.find((m) => m.id === lastLoggedSet?.movement.id) ??
    movementsInSession[0] ??
    null;

  const [active, setActive] = useState<ActiveMovement | null>(defaultActive);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local active with new server data after a set is logged
    if (!active && defaultActive) setActive(defaultActive);
  }, [active, defaultActive]);

  const lastSetForActive = useMemo(() => {
    if (!active) return null;
    for (let i = sets.length - 1; i >= 0; i--) {
      if (sets[i]!.movement.id === active.id) return sets[i]!;
    }
    return null;
  }, [active, sets]);

  const initialWeight = lastSetForActive?.weight_kg
    ? Number(lastSetForActive.weight_kg)
    : 0;
  const initialReps = lastSetForActive?.reps ?? 5;

  const [weight, setWeight] = useState<number>(initialWeight);
  const [reps, setReps] = useState<number>(initialReps);
  const [rpe, setRpe] = useState<number | null>(null);
  const [setKind, setSetKind] = useState<(typeof SET_KINDS)[number]>("main");
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(movementsInSession.length === 0);

  useEffect(() => {
    if (!active) return;
    const lastForThis = (() => {
      for (let i = sets.length - 1; i >= 0; i--) {
        if (sets[i]!.movement.id === active.id) return sets[i]!;
      }
      return null;
    })();
    /* eslint-disable react-hooks/set-state-in-effect -- snap entry defaults to the freshly-active movement */
    setWeight(lastForThis?.weight_kg ? Number(lastForThis.weight_kg) : 0);
    setReps(lastForThis?.reps ?? 5);
    setRpe(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [active, sets]);

  const tmKg = active ? tmBySlug[active.slug] : undefined;
  const tmPct = tmKg && weight > 0 ? Math.round((weight / tmKg) * 100) : null;

  const handleAddMovement = (m: MovementSearchResult | null) => {
    if (!m) return;
    const next: ActiveMovement = {
      id: m.id,
      slug: m.slug,
      display_name: m.display_name,
      primary_region: m.primary_region,
    };
    setActive(next);
    setShowPicker(false);
    setWeight(0);
    setReps(5);
    setRpe(null);
  };

  const setsByMovement = useMemo(() => {
    const groups = new Map<string, LoggedSet[]>();
    for (const s of sets) {
      const arr = groups.get(s.movement.id) ?? [];
      arr.push(s);
      groups.set(s.movement.id, arr);
    }
    return groups;
  }, [sets]);

  const submit = async (fd: FormData) => {
    setError(null);
    if (!active) {
      setError("Pick a movement first.");
      return;
    }
    fd.set("sessionId", sessionId);
    fd.set("movementId", active.id);
    fd.set("setKind", setKind);
    fd.set("weightKg", String(weight));
    fd.set("reps", String(reps));
    if (rpe != null) fd.set("rpe", String(rpe));
    const result = await addStrengthSet(fd);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setRpe(null);
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="cp-card" style={{ padding: 12, display: "grid", gap: 8 }}>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Session
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
          {movementsInSession.map((m) => {
            const isActiveM = active?.id === m.id;
            const count = setsByMovement.get(m.id)?.length ?? 0;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setActive(m)}
                style={{
                  flexShrink: 0,
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: `1px solid ${isActiveM ? "var(--cp-accent)" : "var(--cp-border)"}`,
                  background: isActiveM ? "var(--cp-accent-soft)" : "var(--cp-surface)",
                  color: isActiveM ? "var(--cp-accent)" : "var(--cp-text)",
                  fontWeight: isActiveM ? 600 : 500,
                  fontSize: 12,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {m.display_name}
                <span style={{ marginLeft: 6, color: "var(--cp-text-muted)", fontSize: 11 }}>
                  ×{count}
                </span>
              </button>
            );
          })}
          {!isComplete && (
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              style={{
                flexShrink: 0,
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px dashed var(--cp-border-strong)",
                background: "transparent",
                color: "var(--cp-text-muted)",
                fontSize: 12,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {showPicker ? "× cancel" : "+ add movement"}
            </button>
          )}
        </div>

        {showPicker && !isComplete && (
          <div style={{ paddingTop: 6, borderTop: "1px solid var(--cp-border)" }}>
            <MovementPicker
              name="__movement_picker"
              onChange={handleAddMovement}
              placeholder="Search the catalog…"
            />
          </div>
        )}
      </div>

      {!isComplete && active && (
        <form
          action={submit}
          className="cp-card"
          style={{ padding: 20, display: "grid", gap: 14 }}
        >
          <div>
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Now logging
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{active.display_name}</div>
            {lastSetForActive && (
              <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 4 }}>
                Last set:{" "}
                <span style={{ color: "var(--cp-text)", fontWeight: 500 }} className="mono">
                  {lastSetForActive.weight_kg ? `${lastSetForActive.weight_kg} kg` : ""}
                  {lastSetForActive.reps ? ` × ${lastSetForActive.reps}` : ""}
                  {lastSetForActive.rpe ? ` @ ${lastSetForActive.rpe}` : ""}
                </span>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SET_KINDS.map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => setSetKind(k)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: `1px solid ${setKind === k ? "var(--cp-accent)" : "var(--cp-border)"}`,
                  background: setKind === k ? "var(--cp-accent-soft)" : "transparent",
                  color: setKind === k ? "var(--cp-accent)" : "var(--cp-text-muted)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                }}
              >
                {k.replace("_", " ")}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <EntryBlock
              label="Weight (kg)"
              value={weight}
              onMinus={() => setWeight((v) => Math.max(0, Math.round((v - 2.5) * 10) / 10))}
              onPlus={() => setWeight((v) => Math.round((v + 2.5) * 10) / 10)}
              step={2.5}
              footnote={tmPct != null && tmKg ? `${tmPct}% of TM (${tmKg} kg)` : null}
              onSet={(n) => setWeight(n)}
            />
            <EntryBlock
              label="Reps"
              value={reps}
              integer
              onMinus={() => setReps((v) => Math.max(0, v - 1))}
              onPlus={() => setReps((v) => v + 1)}
              step={1}
              onSet={(n) => setReps(Math.max(0, Math.round(n)))}
            />
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                RPE — how hard
                <span className="cp-info" tabIndex={0} aria-label="RPE scale">
                  i
                  <span className="pop" style={{ width: 260 }}>
                    <strong>RPE / RIR scale</strong>
                    <br />
                    <span className="mono">1–4</span> warm-up / very easy
                    <br />
                    <span className="mono">5</span> moderate, many reps left
                    <br />
                    <span className="mono">6</span> 4 reps in reserve
                    <br />
                    <span className="mono">7</span> 3 reps in reserve
                    <br />
                    <span className="mono">8</span> 2 reps in reserve
                    <br />
                    <span className="mono">9</span> 1 rep in reserve
                    <br />
                    <span className="mono">10</span> absolute max — failure
                  </span>
                </span>
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                {rpe == null ? "tap to rate after the set" : `selected: ${rpe}`}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 4 }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                const sel = rpe === n;
                return (
                  <button
                    type="button"
                    key={n}
                    onClick={() => setRpe(sel ? null : n)}
                    style={{
                      padding: "10px 0",
                      borderRadius: 8,
                      border: `1px solid ${sel ? "var(--cp-accent)" : "var(--cp-border)"}`,
                      background: sel ? "var(--cp-accent)" : "var(--cp-surface)",
                      color: sel ? "var(--cp-accent-fg)" : "var(--cp-text)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: "var(--cp-danger)" }} role="alert">{error}</div>
          )}

          <LogButton weight={weight} reps={reps} />

          <div style={{ textAlign: "center", fontSize: 11, color: "var(--cp-text-muted)", marginTop: -4 }}>
            weight &amp; reps pre-filled from last set · RPE stays blank until you tap
          </div>
        </form>
      )}

      {sets.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>This session ({sets.length} sets)</h2>
          <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
            {Array.from(setsByMovement.entries()).map(([mid, arr]) => {
              const m = arr[0]!.movement;
              return (
                <div key={mid}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{m.display_name}</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <tbody>
                      {arr.map((s) => (
                        <tr key={s.id} style={{ borderTop: "1px solid var(--cp-border)" }}>
                          <td className="mono" style={{ padding: "6px 8px 6px 0", color: "var(--cp-text-muted)", width: 28 }}>
                            #{s.set_index + 1}
                          </td>
                          <td className="mono" style={{ padding: "6px 8px" }}>
                            {s.weight_kg ? `${s.weight_kg} kg` : ""}
                            {s.reps ? ` × ${s.reps}` : ""}
                          </td>
                          <td style={{ padding: "6px 8px", color: "var(--cp-text-muted)" }}>
                            {s.set_kind.replace("_", " ")}
                          </td>
                          <td className="mono" style={{ padding: "6px 0 6px 8px", textAlign: "right", color: "var(--cp-text-muted)" }}>
                            {s.rpe ? `@ ${s.rpe}` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function EntryBlock({
  label,
  value,
  onMinus,
  onPlus,
  step,
  footnote,
  integer,
  onSet,
}: {
  label: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
  step: number;
  footnote?: string | null;
  integer?: boolean;
  onSet: (n: number) => void;
}) {
  return (
    <div
      style={{
        background: "var(--cp-surface-soft)",
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        padding: 12,
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 10, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <input
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onSet(n);
        }}
        className="mono"
        style={{
          background: "transparent",
          border: "none",
          outline: "none",
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          padding: 0,
          width: "100%",
        }}
        aria-label={label}
      />
      {footnote && (
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>{footnote}</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 2 }}>
        <button type="button" onClick={onMinus} className="cp-btn" style={{ padding: "8px 0" }}>
          −{step}
        </button>
        <button type="button" onClick={onPlus} className="cp-btn" style={{ padding: "8px 0" }}>
          +{step}
        </button>
      </div>
    </div>
  );
}

function LogButton({ weight, reps }: { weight: number; reps: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="cp-btn primary big" disabled={pending}>
      {pending ? "Logging…" : (
        <>
          Log set · <span className="mono">{weight} kg × {reps}</span>
        </>
      )}
    </button>
  );
}
