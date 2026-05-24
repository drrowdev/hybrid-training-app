"use client";

/**
 * Movement card for off-plan ("+ Add movement") work. No prescription
 * header, no progress chip, no auto-collapse — the user explicitly
 * taps "Done with this movement" to collapse the card to a recap.
 */

import { useState } from "react";
import type { LoggedSet } from "./SessionLogClient";
import type { addStrengthSet as addStrengthSetAction } from "@/lib/sessions/actions";
import { bestEstimateOneRm } from "@/lib/engine/one-rm";
import { detectTmAnchoredPr } from "@/lib/engine/tm-anchored-pr";
import { restSecondsForKind } from "@/lib/sessions/rest";
import { hapticTick } from "@/lib/feedback";
import { RestTimer } from "./RestTimer";

type SetKind = "warmup" | "main" | "back_off" | "accessory" | "tendon";

const SET_KINDS: SetKind[] = ["warmup", "main", "back_off", "accessory", "tendon"];

export function FreestyleMovementCard({
  sessionId,
  movement,
  loggedSets,
  tmKg,
  oneRmKg,
  priorBest,
  addStrengthSet,
  hapticsEnabled,
  timerSoundEnabled,
}: {
  sessionId: string;
  movement: LoggedSet["movement"];
  loggedSets: LoggedSet[];
  tmKg: number | undefined;
  /** Saved 1RM from training_maxes.one_rm_kg. Drives TM-anchored PR flash. */
  oneRmKg: number | undefined;
  priorBest: { heaviestWeight: number | null; bestE1rm: number | null } | undefined;
  addStrengthSet: typeof addStrengthSetAction;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
}) {
  // priorBest used to drive historical-max PR detection; the flash is
  // now anchored to the saved 1RM (see lib/engine/tm-anchored-pr.ts).
  // The prop is retained for back-compat with the parent prop chain.
  void priorBest;
  const [collapsed, setCollapsed] = useState(false);
  const last = loggedSets[loggedSets.length - 1];
  const [weight, setWeight] = useState<number>(
    last?.weight_kg ? Number(last.weight_kg) : 0,
  );
  const [reps, setReps] = useState<number>(last?.reps ?? 5);
  const [setKind, setSetKind] = useState<SetKind>("main");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restSeconds, setRestSeconds] = useState(0);
  const [restToken, setRestToken] = useState(0);
  const [prFlash, setPrFlash] = useState<{
    weight: boolean;
    e1rm: boolean;
    e1rmKg: number | null;
  } | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    if (weight <= 0 || reps <= 0) {
      setError("Enter weight and reps before logging.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("movementId", movement.id);
    fd.set("setKind", setKind);
    fd.set("weightKg", String(weight));
    fd.set("reps", String(reps));

    // TM-anchored PR detection. Freestyle cards have no prescription
    // so there's no Rep PR (no prescribed-reps anchor). The Weight /
    // e1RM flags still fire against the user's saved 1RM. When `oneRmKg`
    // is unset, no PR can fire.
    const tmAnchored = detectTmAnchoredPr({
      weightKg: weight,
      reps,
      rpe: null,
      kind: setKind,
      prescribedReps: null,
      isTopSet: setKind === "main",
      tmKg: oneRmKg ?? null,
    });
    const newE1rmDisplay = bestEstimateOneRm({ weight, reps, rpe: null });
    const flash = {
      weight: tmAnchored.isWeightPr,
      e1rm: tmAnchored.isE1rmPr,
      e1rmKg: newE1rmDisplay,
    };

    try {
      const result = await addStrengthSet(fd);
      if (result?.error) {
        setError(result.error);
        return;
      }
      hapticTick(hapticsEnabled);
      if (flash.weight || flash.e1rm) setPrFlash(flash);
      const secs = restSecondsForKind(setKind);
      if (secs > 0) {
        setRestSeconds(secs);
        setRestToken((t) => t + 1);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      data-testid={`freestyle-card-${movement.id}`}
      className="cp-card"
      style={{ padding: 0, display: "grid" }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 15, flex: "1 1 auto" }}>
          {movement.display_name}
        </span>
        <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          {loggedSets.length} logged
        </span>
        <span aria-hidden="true" style={{ color: "var(--cp-text-muted)" }}>
          {collapsed ? "▸" : "▾"}
        </span>
      </button>

      {!collapsed && (
        <div style={{ padding: "0 14px 14px", display: "grid", gap: 10 }}>
          {restSeconds > 0 && (
            <RestTimer
              key={restToken}
              seconds={restSeconds}
              onDone={() => setRestSeconds(0)}
              hapticsEnabled={hapticsEnabled}
              timerSoundEnabled={timerSoundEnabled}
              movementName={movement.display_name}
            />
          )}

          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {SET_KINDS.map((k) => (
              <button
                key={k}
                type="button"
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

          <form
            onSubmit={submit}
            data-testid="session-log-form"
            style={{ display: "grid", gap: 10 }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <FreestyleStepper
                label="Weight (kg)"
                value={weight}
                step={2.5}
                integer={false}
                onMinus={() => setWeight((v) => Math.max(0, Math.round((v - 2.5) * 10) / 10))}
                onPlus={() => setWeight((v) => Math.round((v + 2.5) * 10) / 10)}
                onSet={setWeight}
              />
              <FreestyleStepper
                label="Reps"
                value={reps}
                step={1}
                integer
                onMinus={() => setReps((v) => Math.max(0, v - 1))}
                onPlus={() => setReps((v) => v + 1)}
                onSet={(n) => setReps(Math.max(0, Math.round(n)))}
              />
            </div>
            {tmKg != null && weight > 0 && (
              <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                {Math.round((weight / tmKg) * 100)}% of TM ({tmKg} kg)
              </div>
            )}
            {prFlash && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11 }}>
                {prFlash.weight && (
                  <span style={pillStyle("var(--cp-accent)")}>⭐ Weight PR</span>
                )}
                {prFlash.e1rm && (
                  <span style={pillStyle("var(--cp-accent)")}>⭐ e1RM PR</span>
                )}
                {prFlash.e1rmKg != null && (
                  <span
                    className="mono"
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "var(--cp-surface)",
                      border: "1px solid var(--cp-border)",
                      color: "var(--cp-text-muted)",
                    }}
                  >
                    e1RM {Math.round(prFlash.e1rmKg * 10) / 10} kg
                  </span>
                )}
              </div>
            )}
            {error && (
              <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              className="cp-btn primary big"
              disabled={submitting}
            >
              {submitting ? "Logging…" : `Log set · ${weight} kg × ${reps}`}
            </button>
          </form>

          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="cp-btn"
            style={{ padding: "6px 10px", fontSize: 11, justifySelf: "end" }}
            data-testid={`freestyle-done-${movement.id}`}
          >
            Done with this movement
          </button>
        </div>
      )}
    </section>
  );
}

function pillStyle(color: string): React.CSSProperties {
  return {
    padding: "2px 8px",
    borderRadius: 999,
    background: `color-mix(in oklab, ${color} 14%, transparent)`,
    color,
    fontWeight: 700,
  };
}

function FreestyleStepper({
  label,
  value,
  step,
  integer,
  onMinus,
  onPlus,
  onSet,
}: {
  label: string;
  value: number;
  step: number;
  integer: boolean;
  onMinus: () => void;
  onPlus: () => void;
  onSet: (n: number) => void;
}) {
  return (
    <div
      style={{
        background: "var(--cp-surface-soft)",
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        padding: 10,
        display: "grid",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 6,
          alignItems: "center",
        }}
      >
        <button type="button" onClick={onMinus} className="cp-btn" style={{ padding: "6px 10px" }}>
          −
        </button>
        <input
          type="text"
          inputMode={integer ? "numeric" : "decimal"}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onSet(n);
          }}
          className="mono"
          aria-label={label}
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            textAlign: "center",
            fontWeight: 700,
            fontSize: 18,
            width: "100%",
            color: "var(--cp-text)",
          }}
        />
        <button type="button" onClick={onPlus} className="cp-btn" style={{ padding: "6px 10px" }}>
          +
        </button>
      </div>
      <div style={{ fontSize: 10, color: "var(--cp-text-muted)", textAlign: "center" }}>
        ± {step}
      </div>
    </div>
  );
}
