"use client";

/**
 * Focus view for one prescribed movement card. Owns the dot strip,
 * the steppers, the save submit, PR-flash UI, and the auto/manual
 * cursor model. Pure UI — the parent `<MovementCard>` supplies the
 * logged-set data, prior bests, and the server action to call.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PrescriptionItem } from "@hta/db";
import {
  autoCursorForGroup,
  effectiveCursor,
  lastMainSlot,
  bucketLabelForKind,
  roundToPlate,
  type MovementGroup,
} from "@/lib/sessions/movement-grouping";
import { bestEstimateOneRm } from "@/lib/engine/one-rm";
import { restSecondsForKind } from "@/lib/sessions/rest";
import { hapticTick } from "@/lib/feedback";
import { RestTimer } from "./RestTimer";

export type FocusLoggedSet = {
  id: string;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
};

export type FocusViewProps = {
  sessionId: string;
  group: MovementGroup;
  tmKg: number | undefined;
  loggedItemIndices: ReadonlySet<number>;
  /** Canonical logged set per matched item index (used for the edit link). */
  loggedSetIdByItemIndex: Readonly<Record<number, string>>;
  /** All logged sets for this movement, in order. Used for prior-best fallback. */
  loggedSets: FocusLoggedSet[];
  /** Pre-existing PR snapshot used for the inline PR badges. */
  priorBest: { heaviestWeight: number | null; bestE1rm: number | null } | undefined;
  addStrengthSet: (fd: FormData) => Promise<{ error?: string; ok?: true }>;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
  /** Called after a successful save so the parent can run auto-collapse logic. */
  onSaved?: (info: { itemIndex: number; isLast: boolean }) => void;
};

const SET_KIND_TO_LOG: Record<string, "warmup" | "main" | "back_off" | "accessory" | "tendon"> = {
  warmup: "warmup",
  main: "main",
  back_off: "back_off",
  accessory: "accessory",
  tendon: "tendon",
  power_potentiation: "main",
};

type PrFlash = {
  isWeightPr: boolean;
  isE1rmPr: boolean;
  isRepPr: boolean;
  e1rmKg: number | null;
};

export function MovementFocusView({
  sessionId,
  group,
  tmKg,
  loggedItemIndices,
  loggedSetIdByItemIndex,
  loggedSets,
  priorBest,
  addStrengthSet,
  hapticsEnabled,
  timerSoundEnabled,
  onSaved,
}: FocusViewProps) {
  const totalSlots = group.itemIndices.length;
  const autoCursor = useMemo(
    () => autoCursorForGroup(group, loggedItemIndices),
    [group, loggedItemIndices],
  );
  const [manualCursor, setManualCursor] = useState<number | null>(null);
  const cursor = effectiveCursor(autoCursor, manualCursor);

  const activeItem = group.items[cursor];
  const activeItemIndex = group.itemIndices[cursor]!;
  const isActiveLogged = loggedItemIndices.has(activeItemIndex);
  const loggedSetId = loggedSetIdByItemIndex[activeItemIndex];

  const lastMain = lastMainSlot(group);
  const isAmrap =
    activeItem?.kind === "main" && lastMain != null && cursor === lastMain;

  // Target weight / reps derived from the prescription + TM.
  const targetWeight = useMemo(() => {
    if (!activeItem) return 0;
    if (activeItem.percentTm != null && tmKg) {
      return roundToPlate((tmKg * activeItem.percentTm) / 100);
    }
    // Fall back to the most recent logged weight for this movement.
    return loggedSets[loggedSets.length - 1]?.weightKg ?? 0;
  }, [activeItem, tmKg, loggedSets]);
  const targetReps = activeItem?.reps ?? 5;

  // Stepper state. We snap defaults back to target whenever the cursor
  // moves so the user always starts at the prescription.
  const [weight, setWeight] = useState<number>(targetWeight);
  const [reps, setReps] = useState<number>(targetReps);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prFlash, setPrFlash] = useState<PrFlash | null>(null);
  const [justLoggedAt, setJustLoggedAt] = useState<number | null>(null);
  const [restSeconds, setRestSeconds] = useState(0);
  const [restToken, setRestToken] = useState(0);
  const [justLogged, setJustLogged] = useState(false);
  useEffect(() => {
    if (justLoggedAt == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror the just-logged flag locally so the PR flash can self-clear
    setJustLogged(true);
    const id = window.setTimeout(() => setJustLogged(false), 1500);
    return () => window.clearTimeout(id);
  }, [justLoggedAt]);

  // Snap weight/reps to the target whenever the active slot changes.
  const cursorKey = `${group.movementId}:${cursor}:${isActiveLogged ? "done" : "open"}`;
  const lastCursorKey = useRef(cursorKey);
  useEffect(() => {
    if (lastCursorKey.current === cursorKey) return;
    lastCursorKey.current = cursorKey;
    setWeight(targetWeight);
    setReps(targetReps);
    setError(null);
  }, [cursorKey, targetWeight, targetReps]);

  // Auto-clear PR flash after 4.5s.
  useEffect(() => {
    if (!prFlash) return;
    const id = window.setTimeout(() => setPrFlash(null), 4500);
    return () => window.clearTimeout(id);
  }, [prFlash]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    if (!activeItem) return;
    if (weight <= 0 || reps <= 0) {
      setError("Enter weight and reps before logging.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("movementId", group.movementId);
    fd.set("setKind", SET_KIND_TO_LOG[activeItem.kind] ?? "main");
    fd.set("weightKg", String(weight));
    fd.set("reps", String(reps));
    fd.set("prescriptionItemIndex", String(activeItemIndex));

    // Optimistic PR detection against the prior-best snapshot.
    const newE1rm = bestEstimateOneRm({ weight, reps, rpe: null });
    const flash: PrFlash = {
      isWeightPr:
        priorBest?.heaviestWeight != null && weight > priorBest.heaviestWeight,
      isE1rmPr:
        newE1rm != null &&
        priorBest?.bestE1rm != null &&
        newE1rm > priorBest.bestE1rm + 0.05,
      isRepPr: false,
      e1rmKg: isAmrap ? newE1rm : null,
    };

    try {
      const result = await addStrengthSet(fd);
      if (result?.error) {
        setError(result.error);
        return;
      }
      hapticTick(hapticsEnabled);
      // Reset manual cursor — auto will advance when the parent rerenders
      // with the new loggedItemIndices.
      setManualCursor(null);
      setJustLoggedAt(Date.now());
      if (flash.isWeightPr || flash.isE1rmPr || flash.e1rmKg != null) {
        setPrFlash(flash);
      }
      // Inline rest timer.
      const secs = restSecondsForKind(SET_KIND_TO_LOG[activeItem.kind] ?? "main");
      if (secs > 0) {
        setRestSeconds(secs);
        setRestToken((t) => t + 1);
      }
      onSaved?.({
        itemIndex: activeItemIndex,
        isLast: cursor >= totalSlots - 1,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!activeItem) return null;

  const ctaLabel = isActiveLogged ? "Update set ↗" : submitting ? "Logging…" : "Log set";
  const nextSlot = cursor + 1 < totalSlots ? cursor + 1 : null;
  const nextItem = nextSlot != null ? group.items[nextSlot]! : null;
  const nextWeight =
    nextItem && nextItem.percentTm != null && tmKg
      ? roundToPlate((tmKg * nextItem.percentTm) / 100)
      : null;

  return (
    <div
      data-testid="movement-focus-view"
      style={{ display: "grid", gap: 14 }}
    >
      {restSeconds > 0 && (
        <RestTimer
          key={restToken}
          seconds={restSeconds}
          onDone={() => setRestSeconds(0)}
          hapticsEnabled={hapticsEnabled}
          timerSoundEnabled={timerSoundEnabled}
          movementName={group.movementName}
        />
      )}

      <DotStrip
        group={group}
        loggedItemIndices={loggedItemIndices}
        cursor={cursor}
        onPickSlot={(i) => setManualCursor(i)}
      />

      <div
        data-testid="movement-focus-caption"
        style={{
          fontSize: 11,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        Set {cursor + 1} of {totalSlots}
      </div>

      <div
        className="cp-card"
        data-testid="movement-focus-card"
        data-just-logged={justLogged ? "true" : "false"}
        style={{
          padding: 18,
          display: "grid",
          gap: 10,
          textAlign: "center",
          borderColor: justLogged
            ? "color-mix(in oklab, var(--cp-success) 60%, var(--cp-border))"
            : "var(--cp-border)",
          background: justLogged
            ? "color-mix(in oklab, var(--cp-success) 6%, transparent)"
            : "var(--cp-surface-soft)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 600,
          }}
        >
          <span>{bucketLabelForKind(activeItem.kind, cursor, totalSlots)}</span>
          {activeItem.percentTm != null && (
            <span
              className="mono"
              style={{
                padding: "1px 6px",
                borderRadius: 999,
                background: "var(--cp-accent-soft)",
                color: "var(--cp-accent)",
                fontSize: 10,
              }}
            >
              {activeItem.percentTm}% TM
            </span>
          )}
        </div>
        <div
          className="mono"
          style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.05 }}
        >
          {weight > 0 ? `${weight}` : "—"}
          <span style={{ fontSize: 18, color: "var(--cp-text-muted)", marginLeft: 6 }}>
            kg
          </span>
        </div>
        <div style={{ fontSize: 14, color: "var(--cp-text-muted)" }}>
          × {targetReps} {isAmrap ? "reps+" : "reps"}
        </div>

        {prFlash && (
          <div
            data-testid="pr-flash"
            style={{
              display: "flex",
              gap: 6,
              justifyContent: "center",
              flexWrap: "wrap",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {prFlash.isWeightPr && (
              <span style={badgeStyle("var(--cp-accent)")}>⭐ Weight PR</span>
            )}
            {prFlash.isRepPr && (
              <span style={badgeStyle("var(--cp-accent)")}>⭐ Rep PR</span>
            )}
            {prFlash.isE1rmPr && (
              <span style={badgeStyle("var(--cp-accent)")}>⭐ e1RM PR</span>
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
      </div>

      <form
        onSubmit={handleSubmit}
        data-testid="session-log-form"
        style={{ display: "grid", gap: 12 }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Stepper
            label="Weight (kg)"
            value={weight}
            step={2.5}
            integer={false}
            onMinus={() => setWeight((v) => Math.max(0, Math.round((v - 2.5) * 10) / 10))}
            onPlus={() => setWeight((v) => Math.round((v + 2.5) * 10) / 10)}
            onSet={setWeight}
          />
          <Stepper
            label="Reps"
            value={reps}
            step={1}
            integer
            onMinus={() => setReps((v) => Math.max(0, v - 1))}
            onPlus={() => setReps((v) => v + 1)}
            onSet={(n) => setReps(Math.max(0, Math.round(n)))}
          />
        </div>

        {error && (
          <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
            {error}
          </div>
        )}

        {isActiveLogged && loggedSetId ? (
          <a
            href={`/app/sessions/${sessionId}/sets/${loggedSetId}/edit`}
            data-testid={`logged-set-edit-${loggedSetId}`}
            className="cp-btn primary big"
            style={{ textDecoration: "none", textAlign: "center" }}
          >
            {ctaLabel}
          </a>
        ) : (
          <button
            type="submit"
            className="cp-btn primary big"
            disabled={submitting}
            data-testid="movement-focus-log-button"
          >
            {ctaLabel}
            {!submitting && weight > 0 && reps > 0 && (
              <>
                {" · "}
                <span className="mono">
                  {weight} kg × {reps}
                </span>
              </>
            )}
          </button>
        )}

        {nextItem && (
          <div
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              textAlign: "right",
            }}
          >
            Next:{" "}
            {bucketLabelForKind(nextItem.kind, nextSlot!, totalSlots).split(" · ")[0]}
            {nextWeight != null ? (
              <>
                {" · "}
                <span className="mono">
                  {nextWeight} kg × {nextItem.reps ?? targetReps}
                </span>
              </>
            ) : null}
          </div>
        )}
      </form>
    </div>
  );
}

function badgeStyle(color: string): React.CSSProperties {
  return {
    padding: "2px 8px",
    borderRadius: 999,
    background: `color-mix(in oklab, ${color} 14%, transparent)`,
    color,
    fontSize: 11,
    fontWeight: 700,
  };
}

function DotStrip({
  group,
  loggedItemIndices,
  cursor,
  onPickSlot,
}: {
  group: MovementGroup;
  loggedItemIndices: ReadonlySet<number>;
  cursor: number;
  onPickSlot: (slot: number) => void;
}) {
  return (
    <div
      role="tablist"
      data-testid="movement-dot-strip"
      style={{ display: "flex", justifyContent: "center", gap: 6 }}
    >
      {group.itemIndices.map((idx, slot) => {
        const isLogged = loggedItemIndices.has(idx);
        const isActive = slot === cursor;
        const base: React.CSSProperties = {
          height: 10,
          borderRadius: 999,
          border: "none",
          padding: 0,
          cursor: "pointer",
          transition: "all 140ms ease-out",
        };
        let style: React.CSSProperties;
        if (isLogged) {
          style = {
            ...base,
            width: isActive ? 26 : 18,
            background: "var(--cp-success)",
            color: "var(--cp-accent-fg, #fff)",
            fontSize: 8,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          };
        } else if (isActive) {
          style = {
            ...base,
            width: 26,
            background: "var(--cp-accent)",
          };
        } else {
          style = {
            ...base,
            width: 12,
            background: "transparent",
            border: "1px solid var(--cp-border)",
          };
        }
        return (
          <button
            key={idx}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`movement-dot-${slot}`}
            data-logged={isLogged ? "true" : "false"}
            onClick={() => onPickSlot(slot)}
            style={style}
            aria-label={`Set ${slot + 1} of ${group.itemIndices.length}${isLogged ? " — logged" : ""}`}
          >
            {isLogged && isActive ? "✓" : null}
          </button>
        );
      })}
    </div>
  );
}

function Stepper({
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
        background: "var(--cp-surface)",
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        padding: 12,
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
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          onClick={onMinus}
          className="cp-btn"
          aria-label={`Decrease ${label}`}
          style={{ padding: "8px 12px", minWidth: 40 }}
        >
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
            fontSize: 20,
            width: "100%",
            padding: 0,
            color: "var(--cp-text)",
          }}
        />
        <button
          type="button"
          onClick={onPlus}
          className="cp-btn"
          aria-label={`Increase ${label}`}
          style={{ padding: "8px 12px", minWidth: 40 }}
        >
          +
        </button>
      </div>
      <div style={{ fontSize: 10, color: "var(--cp-text-muted)", textAlign: "center" }}>
        ± {step}
      </div>
    </div>
  );
}

// Avoid unused type import warning.
export type _PrescriptionItem = PrescriptionItem;
