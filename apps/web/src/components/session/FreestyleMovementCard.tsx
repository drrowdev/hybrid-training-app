"use client";

/**
 * Movement card for off-plan ("+ Add movement") work. No prescription
 * header, no progress chip, no auto-collapse — the user explicitly
 * taps "Done with this movement" to collapse the card to a recap.
 *
 * Two behaviours differ from the prescribed `<MovementCard>`:
 *
 *   1. Remove. A kebab (⋯) in the card header surfaces a single
 *      "Remove movement" item that calls `removeSessionMovementAction`
 *      and notifies the parent via `onRemove(id)`. The kebab is
 *      hidden once any set is logged — at that point the user should
 *      tap "Done with this movement" (which just collapses the card)
 *      so the historical record stays intact.
 *
 *   2. Collapsed chips. Freestyle sessions don't have an engine
 *      picking a `set_kind` for you, so the five-chip rail is
 *      visually noisy by default. We collapse it to a "Set type:
 *      Main ▾" disclosure; tapping expands the full rail. Picking
 *      anything other than Main forces the rail to stay expanded so
 *      the user can see what they selected.
 */
import { useEffect, useRef, useState } from "react";
import type { LoggedSet } from "./SessionLogClient";
import type { addStrengthSet as addStrengthSetAction } from "@/lib/sessions/actions";
import type { removeSessionMovementAction as removeSessionMovementActionType } from "@/lib/sessions/session-movement-actions";
import { bestEstimateOneRm } from "@/lib/engine/one-rm";
import { detectTmAnchoredPr } from "@/lib/engine/tm-anchored-pr";
import { restSecondsForKind } from "@/lib/sessions/rest";
import { hapticTick } from "@/lib/feedback";
import { RestTimer } from "./RestTimer";
import {
  SET_KINDS,
  SET_KIND_LABELS,
  type SetKind,
} from "@/lib/sessions/set-kind-labels";

export type { SetKind };

/**
 * Derive the visibility of the chip rail from the current set-kind
 * pick plus whether the user has manually opened the disclosure.
 *
 * Rule: the rail is open whenever the user explicitly opened it, OR
 * whenever the selected kind is anything other than "main" (so picking
 * Warm-up doesn't hide the selection under the user). Switching back
 * to Main does NOT collapse — the user is in charge once they've
 * opened the rail.
 *
 * Exported so the unit test can drive it without a DOM.
 */
export function freestyleChipsOpen(
  setKind: SetKind,
  userOpened: boolean,
): boolean {
  return userOpened || setKind !== "main";
}

export function FreestyleMovementCard({
  sessionId,
  movement,
  loggedSets,
  loggedSetCount,
  tmKg,
  oneRmKg,
  priorBest,
  addStrengthSet,
  removeSessionMovement,
  onRemove,
  hapticsEnabled,
  timerSoundEnabled,
}: {
  sessionId: string;
  movement: LoggedSet["movement"];
  loggedSets: LoggedSet[];
  /**
   * Total sets logged against this movement in the current session.
   * Drives Remove-button visibility. Defaults to `loggedSets.length`
   * when the parent doesn't supply it (legacy callers).
   */
  loggedSetCount?: number;
  tmKg: number | undefined;
  /** Saved 1RM from training_maxes.one_rm_kg. Drives TM-anchored PR flash. */
  oneRmKg: number | undefined;
  priorBest: { heaviestWeight: number | null; bestE1rm: number | null } | undefined;
  addStrengthSet: typeof addStrengthSetAction;
  /**
   * Server action that removes the (session, movement) pair from
   * `session_movements`. Optional so older callers (tests) that don't
   * supply it still render. When absent, the kebab is hidden entirely
   * regardless of loggedSetCount.
   */
  removeSessionMovement?: typeof removeSessionMovementActionType;
  /**
   * Callback the card invokes after a successful remove so the parent
   * can strip its rendering of the card optimistically.
   */
  onRemove?: (movementId: string) => void;
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

  // Collapsed by default. The rail also forces open when the user
  // picks a non-Main kind (so the selection isn't hidden under them).
  // See `freestyleChipsOpen` for the rule.
  const [chipsUserOpened, setChipsUserOpened] = useState(false);
  const chipsOpen = freestyleChipsOpen(setKind, chipsUserOpened);

  // Kebab popover state.
  const [menuOpen, setMenuOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the popover on click outside / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const effectiveLoggedCount = loggedSetCount ?? loggedSets.length;
  const canRemove = !!removeSessionMovement && effectiveLoggedCount === 0;

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

  const onPickSetKind = (k: SetKind) => {
    setSetKind(k);
    // No additional state — `freestyleChipsOpen` already forces the
    // rail open whenever `setKind !== "main"`, and once the user has
    // expanded the rail manually we honour that as well.
  };

  const onRemoveClick = async () => {
    if (!removeSessionMovement) return;
    if (effectiveLoggedCount > 0) return;
    setMenuOpen(false);
    setRemoveError(null);
    setRemoving(true);
    try {
      const result = await removeSessionMovement(sessionId, movement.id);
      if (!result.ok) {
        setRemoveError(result.error);
        return;
      }
      onRemove?.(movement.id);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Could not remove movement.");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section
      data-testid={`freestyle-card-${movement.id}`}
      className="cp-card"
      style={{ padding: 0, display: "grid" }}
    >
      <div
        style={{
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          style={{
            all: "unset",
            cursor: "pointer",
            flex: "1 1 auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 15, flex: "1 1 auto" }}>
            {movement.display_name}
          </span>
          <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
            {effectiveLoggedCount} logged
          </span>
          <span aria-hidden="true" style={{ color: "var(--cp-text-muted)" }}>
            {collapsed ? "▸" : "▾"}
          </span>
        </button>

        {/* Kebab — hidden once at least one set is logged. We keep the
            spacing stable when hidden so the row doesn't jitter when
            the first set lands. */}
        <div
          ref={menuRef}
          style={{ position: "relative", width: 28, display: "flex", justifyContent: "flex-end" }}
        >
          {canRemove ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Movement actions"
              data-testid={`freestyle-kebab-${movement.id}`}
              disabled={removing}
              style={{
                all: "unset",
                cursor: removing ? "default" : "pointer",
                padding: "2px 6px",
                borderRadius: 6,
                color: "var(--cp-text-muted)",
                fontSize: 16,
                lineHeight: 1,
                opacity: removing ? 0.5 : 1,
              }}
            >
              ⋯
            </button>
          ) : (
            <span
              aria-hidden="true"
              title={
                removeSessionMovement
                  ? "Log no sets to remove. Use 'Done with this movement' instead."
                  : undefined
              }
              data-testid={`freestyle-kebab-disabled-${movement.id}`}
              style={{ width: 16, height: 16 }}
            />
          )}

          {menuOpen && (
            <div
              role="menu"
              data-testid={`freestyle-menu-${movement.id}`}
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                background: "var(--cp-surface)",
                border: "1px solid var(--cp-border)",
                borderRadius: 8,
                boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
                padding: 4,
                zIndex: 10,
                minWidth: 160,
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={onRemoveClick}
                data-testid={`freestyle-remove-${movement.id}`}
                style={{
                  all: "unset",
                  display: "block",
                  width: "calc(100% - 16px)",
                  padding: "8px",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "var(--cp-danger)",
                  borderRadius: 6,
                }}
              >
                Remove movement
              </button>
            </div>
          )}
        </div>
      </div>

      {removeError && (
        <div
          role="alert"
          data-testid={`freestyle-remove-error-${movement.id}`}
          style={{
            padding: "0 14px 8px",
            fontSize: 12,
            color: "var(--cp-danger)",
          }}
        >
          {removeError}
        </div>
      )}

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

          {/* Collapsed chip disclosure — freestyle only. Defaults to a
              one-line "Set type: Main ▾" so casual freestyle sessions
              don't see a 5-chip rail by default. Tapping the
              disclosure (or picking a non-Main kind) expands the
              full rail + caption. */}
          {!chipsOpen ? (
            <button
              type="button"
              onClick={() => setChipsUserOpened(true)}
              aria-expanded={false}
              aria-controls={`freestyle-chips-${movement.id}`}
              data-testid={`freestyle-chips-toggle-${movement.id}`}
              style={{
                all: "unset",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--cp-text-muted)",
                padding: "2px 0",
              }}
            >
              Set type: {SET_KIND_LABELS[setKind].label} ▾
            </button>
          ) : (
            <div id={`freestyle-chips-${movement.id}`}>
              <div
                style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}
                data-testid={`freestyle-chips-rail-${movement.id}`}
              >
                {SET_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => onPickSetKind(k)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${setKind === k ? "var(--cp-accent)" : "var(--cp-border)"}`,
                      background: setKind === k ? "var(--cp-accent-soft)" : "transparent",
                      color: setKind === k ? "var(--cp-accent)" : "var(--cp-text-muted)",
                      fontSize: 11,
                      letterSpacing: "0.04em",
                      cursor: "pointer",
                    }}
                  >
                    {SET_KIND_LABELS[k].label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setChipsUserOpened(false)}
                  aria-label="Collapse set type chips"
                  data-testid={`freestyle-chips-collapse-${movement.id}`}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    marginLeft: "auto",
                    fontSize: 11,
                    color: "var(--cp-text-muted)",
                    padding: "2px 6px",
                  }}
                >
                  ▴
                </button>
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--cp-text-muted)",
                  margin: 0,
                  marginTop: 6,
                  minHeight: 16,
                }}
              >
                {SET_KIND_LABELS[setKind].caption}
              </p>
            </div>
          )}

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
