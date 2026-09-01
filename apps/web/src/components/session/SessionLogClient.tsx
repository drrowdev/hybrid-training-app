"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { MovementPicker, type MovementSearchResult } from "@/components/movement-picker";
import { bestEstimateOneRm } from "@/lib/engine/one-rm";
import { restSecondsForSet } from "@/lib/sessions/rest";
import { formatHintDate } from "@/lib/sessions/format-hint-date";
import { hapticTick } from "@/lib/feedback";
import { RestTimer } from "./RestTimer";
import { SwapMovementModal } from "./SwapMovementModal";
import {
  SET_KINDS,
  SET_KIND_LABELS,
  setKindLabel,
  type SetKind,
} from "@/lib/sessions/set-kind-labels";

export type LoggedSet = {
  id: string;
  set_index: number;
  set_kind: string;
  weight_kg: number | string | null;
  external_load_kg?: number | string | null;
  reps: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  rpe: number | string | null;
  skipped?: boolean;
  skip_reason?: string | null;
  /**
   * Prescription slot this set was logged against (when linked). Optional so
   * legacy callers/fixtures that don't project it stay valid; the optimistic
   * overlay uses it to reconcile a pending client entry against the server row.
   */
  prescription_item_index?: number | null;
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

/** "Last time" hint for a movement — top set from the prior session. */
export type LastSetHint = {
  weightKg: number;
  reps: number;
  performedAt: string;
};

/**
 * Pre-existing personal best for a movement, captured server-side at
 * page render. Used by the client-side PR badge to give instant
 * feedback without waiting for the next server round-trip — the
 * canonical PR detection still runs server-side in `getSessionPrs`.
 */
export type PriorBest = {
  /** Heaviest weight ever lifted on this movement. */
  heaviestWeight: number | null;
  /** Highest estimated 1RM across all prior sets. */
  bestE1rm: number | null;
};

/**
 * Driven by the parent when the user taps a prescription row. Each new
 * tap MUST bump `token` even if the underlying values match the
 * previous tap so the form re-applies the prefill (a stale tap on the
 * same item still feels responsive). `prescriptionItemIndex` is
 * threaded through `addStrengthSet` so the resulting set_logs row
 * carries the canonical link to the planned item.
 */
export type PrescriptionPrefillRequest = {
  token: number;
  movement: ActiveMovement;
  weightKg: number;
  reps: number;
  setKind: SetKind;
  prescriptionItemIndex: number;
};

type SetAction = (fd: FormData) => Promise<{ error?: string; ok?: true }>;
type FillAction = (
  fd: FormData,
) => Promise<{ ok?: true; error?: string; inserted?: number }>;

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
  fillFromPlan,
  hasPlan,
  lastSetHints,
  priorBests,
  hapticsEnabled = true,
  timerSoundEnabled = true,
  restTimerEnabled = true,
  prefillRequest = null,
}: {
  sessionId: string;
  isComplete: boolean;
  sets: LoggedSet[];
  tmBySlug: Record<string, number>;
  addStrengthSet: SetAction;
  /** Server action for "Same as planned" — null when there is no linked plan. */
  fillFromPlan?: FillAction | null;
  /** True when a planned_session is linked, so the "Same as planned" CTA is meaningful. */
  hasPlan?: boolean;
  /** Map of movement_id → top set from the user's most recent prior session (B2). */
  lastSetHints?: Record<string, LastSetHint>;
  /** Map of movement_id → prior personal-best snapshot used for the PR badge (B3). */
  priorBests?: Record<string, PriorBest>;
  /** Phase 3 C1 — haptic tick on set save + rest-timer zero. */
  hapticsEnabled?: boolean;
  /** Phase 3 C2 — tone at rest-timer zero. */
  timerSoundEnabled?: boolean;
  /**
   * Lifter's opt-out for the inter-set countdown. False suppresses the timer,
   * not the rest — logging, auto-advance and completion are unaffected.
   */
  restTimerEnabled?: boolean;
  /** feat/logging-works — prefill driven by a prescription row tap. */
  prefillRequest?: PrescriptionPrefillRequest | null;
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
  const [swapOpen, setSwapOpen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local active with new server data after a set is logged
    if (!active && defaultActive) setActive(defaultActive);
  }, [active, defaultActive]);

  // Form ref for scroll-into-view when a prescription row prefills. The
  // rest-timer wraps this whole component so we scroll the entry form,
  // not the page top.
  const entryFormRef = useRef<HTMLFormElement | null>(null);

  // Pending prescription-item link applied to the next submitted set.
  // Cleared after submit (or when the user manually switches movement).
  const [pendingPrescriptionItemIndex, setPendingPrescriptionItemIndex] = useState<number | null>(
    null,
  );

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
  const [setKind, setSetKind] = useState<SetKind>("main");
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(movementsInSession.length === 0);

  // Rest-timer state (B4). `restToken` forces a remount when a new
  // set fires so the countdown restarts cleanly. `restSeconds=0` is
  // the "no timer running" sentinel.
  const [restSeconds, setRestSeconds] = useState(0);
  const [restToken, setRestToken] = useState(0);

  // Client-side "just logged a PR" badge state (B3). The canonical
  // detection runs server-side; this is the instant-feedback layer.
  const [pendingPrFlash, setPendingPrFlash] = useState<{ movementId: string; setId?: string } | null>(null);

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

  // Apply a prescription-row prefill request. Keyed on `token` so a
  // repeat tap on the same row still re-snaps the form. The setKind
  // here is the prescription's classification — the user can still
  // tweak the pill row before logging.
  useEffect(() => {
    if (!prefillRequest) return;
    /* eslint-disable react-hooks/set-state-in-effect -- prefill is a deliberate one-shot reset triggered by parent */
    setActive(prefillRequest.movement);
    setWeight(prefillRequest.weightKg);
    setReps(prefillRequest.reps);
    setRpe(null);
    setSetKind(prefillRequest.setKind);
    setShowPicker(false);
    setPendingPrescriptionItemIndex(prefillRequest.prescriptionItemIndex);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    // Defer the scroll until React has flushed the state update so the
    // form is mounted and visible.
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        entryFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only fires on token change
  }, [prefillRequest?.token]);

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
    // Free-form movement add isn't tied to any prescription item.
    setPendingPrescriptionItemIndex(null);
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
    if (pendingPrescriptionItemIndex != null) {
      fd.set("prescriptionItemIndex", String(pendingPrescriptionItemIndex));
    }

    // Client-side PR detection BEFORE we hit the server so the badge
    // can light up the instant the form submits. The server-side
    // detection in `getSessionPrs` is the canonical record — this
    // mirror avoids a second flash when the server response arrives.
    const prior = priorBests?.[active.id];
    const newE1rm = bestEstimateOneRm({ weight, reps, rpe: rpe ?? null });
    const isWeightPr = prior?.heaviestWeight != null && weight > prior.heaviestWeight;
    const isE1rmPr =
      newE1rm != null && prior?.bestE1rm != null && newE1rm > prior.bestE1rm + 0.05;
    if ((isWeightPr || isE1rmPr) && (rpe == null || rpe < 10)) {
      setPendingPrFlash({ movementId: active.id });
    }

    const result = await addStrengthSet(fd);
    if (result?.error) {
      setError(result.error);
      setPendingPrFlash(null);
      return;
    }
    // Phase 3 C1 — haptic tick on a committed set (server returned ok).
    hapticTick(hapticsEnabled);
    setRpe(null);
    // Each prescription row tap is a one-shot — clear the link so the
    // user's next free-form set on the same movement doesn't double-
    // mark the prescription item as done.
    setPendingPrescriptionItemIndex(null);
    // Kick the rest timer based on the set kind (B4). A full state
    // transition, not a conditional start: when the lifter has the timer off
    // (or this kind never rests) any countdown still on screen from an earlier
    // set must be cleared, not left running.
    const secs = restSecondsForSet(setKind, { restTimerEnabled });
    setRestSeconds(secs);
    if (secs > 0) {
      setRestToken((t) => t + 1);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {!isComplete && hasPlan && fillFromPlan && sets.length === 0 && (
        <SameAsPlannedCard fillFromPlan={fillFromPlan} sessionId={sessionId} />
      )}

      <div className="cp-card" style={{ padding: 12, display: "grid", gap: 8 }}>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Session
        </div>
        {!isComplete && !active && sets.length === 0 && (
          <div
            data-testid="empty-session-helper"
            style={{ fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.4 }}
          >
            Pick a movement to start logging, or tap a planned set above to prefill the form.
          </div>
        )}
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
                  padding: "10px 16px",
                  minHeight: 44,
                  borderRadius: 999,
                  border: `1px solid ${isActiveM ? "var(--cp-accent)" : "var(--cp-border)"}`,
                  background: isActiveM ? "var(--cp-accent-soft)" : "var(--cp-surface)",
                  color: isActiveM ? "var(--cp-accent)" : "var(--cp-text)",
                  fontWeight: isActiveM ? 600 : 500,
                  fontSize: 13,
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
                padding: "10px 16px",
                minHeight: 44,
                borderRadius: 999,
                border: "1px dashed var(--cp-border-strong)",
                background: "transparent",
                color: "var(--cp-text-muted)",
                fontSize: 13,
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
          ref={entryFormRef}
          data-testid="session-log-form"
          className="cp-card"
          style={{ padding: 20, display: "grid", gap: 14 }}
        >
          <div>
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Now logging
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                marginTop: 2,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {active.display_name}
              {pendingPrFlash?.movementId === active.id && (
                <span
                  data-testid="pr-badge"
                  aria-label="Personal record"
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "var(--cp-accent)",
                    color: "var(--cp-accent-fg)",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                  }}
                >
                  ⭐ PR!
                </span>
              )}
              <button
                type="button"
                data-testid="swap-movement-trigger"
                onClick={() => setSwapOpen(true)}
                style={{
                  marginLeft: 4,
                  background: "transparent",
                  border: 0,
                  padding: "2px 4px",
                  color: "var(--cp-text-muted)",
                  fontSize: 12,
                  fontWeight: 500,
                  textDecoration: "underline",
                  textDecorationStyle: "dotted",
                  textUnderlineOffset: 3,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Swap movement
              </button>
            </div>
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
            {!lastSetForActive && lastSetHints?.[active.id] && (
              <div
                data-testid="last-time-hint"
                style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 4 }}
              >
                Last {active.display_name.toLowerCase()}:{" "}
                <span style={{ color: "var(--cp-text)", fontWeight: 500 }} className="mono">
                  {lastSetHints[active.id]!.weightKg} kg × {lastSetHints[active.id]!.reps}
                </span>
                <span style={{ marginLeft: 6, color: "var(--cp-text-muted)" }}>
                  ({formatHintDate(lastSetHints[active.id]!.performedAt)})
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
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                }}
              >
                {SET_KIND_LABELS[k].label}
              </button>
            ))}
          </div>
          <p
            style={{
              fontSize: 12,
              color: "var(--cp-text-muted)",
              margin: 0,
              marginTop: -2,
              minHeight: 16,
            }}
          >
            {SET_KIND_LABELS[setKind].caption}
          </p>

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
                      padding: "14px 0",
                      minHeight: 44,
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
                        <tr
                          key={s.id}
                          data-testid={`logged-set-row-${s.id}`}
                          data-state="done"
                          style={{
                            borderTop: "1px solid var(--cp-border)",
                            // Phase 3 E3 — committed sets get a subtle
                            // success tint so the user can scan at a
                            // glance which prescription items are done.
                            background:
                              "color-mix(in oklab, var(--cp-success) 6%, transparent)",
                          }}
                        >
                          <td className="mono" style={{ padding: "6px 8px 6px 0", color: "var(--cp-text-muted)", width: 28 }}>
                            #{s.set_index + 1}
                          </td>
                          <td className="mono" style={{ padding: "6px 8px" }}>
                            {s.weight_kg ? `${s.weight_kg} kg` : ""}
                            {s.reps ? ` × ${s.reps}` : ""}
                          </td>
                          <td style={{ padding: "6px 8px", color: "var(--cp-text-muted)" }}>
                            {setKindLabel(s.set_kind)}
                          </td>
                          <td className="mono" style={{ padding: "6px 8px", textAlign: "right", color: "var(--cp-text-muted)" }}>
                            {s.rpe ? `@ ${s.rpe}` : ""}
                          </td>
                          {!isComplete && (
                            <td style={{ padding: "6px 0 6px 8px", textAlign: "right", width: 36 }}>
                              <Link
                                href={`/app/sessions/${sessionId}/sets/${s.id}/edit`}
                                data-testid={`logged-set-edit-${s.id}`}
                                aria-label="Edit set"
                                title="Edit set"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: 28,
                                  height: 28,
                                  borderRadius: 6,
                                  color: "var(--cp-text-muted)",
                                  fontSize: 13,
                                  textDecoration: "none",
                                }}
                              >
                                ✎
                              </Link>
                            </td>
                          )}
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

      {!isComplete && (
        <RestTimer
          key={restToken}
          seconds={restSeconds}
          onDone={() => setRestSeconds(0)}
          hapticsEnabled={hapticsEnabled}
          timerSoundEnabled={timerSoundEnabled}
          movementName={active?.display_name ?? null}
        />
      )}

      {active && (
        <SwapMovementModal
          open={swapOpen}
          onClose={() => setSwapOpen(false)}
          sessionId={sessionId}
          original={{ id: active.id, displayName: active.display_name }}
          onSwapped={(next) => {
            setActive({
              id: next.id,
              slug: next.slug,
              display_name: next.displayName,
              primary_region: active.primary_region,
            });
          }}
        />
      )}
    </div>
  );
}

function SameAsPlannedCard({
  fillFromPlan,
  sessionId,
}: {
  fillFromPlan: FillAction;
  sessionId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (fd: FormData) => {
    setError(null);
    fd.set("sessionId", sessionId);
    const result = await fillFromPlan(fd);
    if (result?.error) setError(result.error);
  };
  return (
    <form
      action={submit}
      data-testid="same-as-planned"
      className="cp-card"
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        borderColor: "var(--cp-accent)",
        background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "var(--cp-text)" }}>
          <strong>Logging the planned session?</strong>{" "}
          <span style={{ color: "var(--cp-text-muted)" }}>
            Pre-fill every set from the prescription — adjust later if anything changes.
          </span>
        </div>
        <SameAsPlannedButton />
      </div>
      {error && (
        <div style={{ fontSize: 12, color: "var(--cp-danger)" }} role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

function SameAsPlannedButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="cp-btn primary"
      disabled={pending}
      style={{ minHeight: 48 }}
    >
      {pending ? "Filling…" : "Same as planned"}
    </button>
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
        className="mono cp-entry-input"
        style={{
          background: "transparent",
          border: "none",
          outline: "none",
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
