"use client";

/**
 * Top-level container for the session log: one collapsible
 * `<MovementCard>` per prescribed movement, plus a freestyle "Add
 * movement" path for sets logged off-plan, plus the compact
 * "All logged sets" table at the bottom.
 *
 * Replaces the older `<PrescriptionItemsList>` + `<SessionLogClient>`
 * pair when there is a linked prescription. Freestyle sessions
 * (no prescription) still flow through the freestyle add-movement
 * path here, so the user always sees the same card-shaped UI.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Prescription } from "@hta/db";
import {
  groupPrescriptionByMovement,
  type MovementGroup,
} from "@/lib/sessions/movement-grouping";
import { MovementCard } from "./MovementCard";
import { FreestyleMovementCard } from "./FreestyleMovementCard";
import { MovementPicker, type MovementSearchResult } from "@/components/movement-picker";
import type { LoggedSet } from "./SessionLogClient";
import type {
  addStrengthSet as addStrengthSetAction,
  fillSessionFromPlan as fillSessionFromPlanAction,
} from "@/lib/sessions/actions";

export type MovementCardListProps = {
  sessionId: string;
  isComplete: boolean;
  prescription: Prescription | null;
  sets: LoggedSet[];
  tmBySlug: Record<string, number>;
  loggedItemIndices: ReadonlySet<number>;
  loggedSetIdByItemIndex: Readonly<Record<number, string>>;
  priorBests: Record<string, { heaviestWeight: number | null; bestE1rm: number | null }>;
  addStrengthSet: typeof addStrengthSetAction;
  fillFromPlan: typeof fillSessionFromPlanAction;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
};

export function MovementCardList({
  sessionId,
  isComplete,
  prescription,
  sets,
  tmBySlug,
  loggedItemIndices,
  loggedSetIdByItemIndex,
  priorBests,
  addStrengthSet,
  fillFromPlan,
  hapticsEnabled,
  timerSoundEnabled,
}: MovementCardListProps) {
  const groups = useMemo(
    () => groupPrescriptionByMovement(prescription),
    [prescription],
  );

  // Map prescribed movementIds for the freestyle add to skip duplicates.
  const prescribedIds = useMemo(
    () => new Set(groups.map((g) => g.movementId)),
    [groups],
  );

  // Logged sets bucketed by movementId for both the prescribed cards
  // (prior-set summary) and the freestyle cards (their own dot strip).
  const setsByMovement = useMemo(() => {
    const m = new Map<string, LoggedSet[]>();
    for (const s of sets) {
      if (!s.movement.id) continue;
      const arr = m.get(s.movement.id) ?? [];
      arr.push(s);
      m.set(s.movement.id, arr);
    }
    return m;
  }, [sets]);

  // Freestyle movement ids = logged movements that aren't in the prescription.
  const freestyleMovements = useMemo(() => {
    const seen = new Map<string, LoggedSet["movement"]>();
    for (const s of sets) {
      if (!s.movement.id) continue;
      if (prescribedIds.has(s.movement.id)) continue;
      if (!seen.has(s.movement.id)) seen.set(s.movement.id, s.movement);
    }
    return Array.from(seen.values());
  }, [sets, prescribedIds]);

  // User-added (yet-unlogged) freestyle movements — stacked on top of
  // anything they've already logged off-plan.
  const [pendingFreestyle, setPendingFreestyle] = useState<LoggedSet["movement"][]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [allSetsExpanded, setAllSetsExpanded] = useState(false);

  const freestyleMerged = useMemo(() => {
    const out: LoggedSet["movement"][] = [...freestyleMovements];
    for (const m of pendingFreestyle) {
      if (out.find((x) => x.id === m.id)) continue;
      if (prescribedIds.has(m.id)) continue;
      out.push(m);
    }
    return out;
  }, [freestyleMovements, pendingFreestyle, prescribedIds]);

  const handlePick = (m: MovementSearchResult | null) => {
    if (!m) return;
    setPendingFreestyle((prev) =>
      prev.find((x) => x.id === m.id)
        ? prev
        : [
            ...prev,
            {
              id: m.id,
              slug: m.slug,
              display_name: m.display_name,
              primary_region: m.primary_region,
            },
          ],
    );
    setShowPicker(false);
  };

  const allSetsLoggedAcrossSession = sets.length;
  // First prescribed card with no logged sets across the whole session
  // shows the session-level "Same as planned" button.
  const showFillOnFirst = !isComplete && sets.length === 0;

  return (
    <div data-testid="movement-card-list" style={{ display: "grid", gap: 12 }}>
      {groups.map((group, i) => (
        <PrescribedCard
          key={group.movementId}
          sessionId={sessionId}
          group={group}
          tmBySlug={tmBySlug}
          loggedItemIndices={loggedItemIndices}
          loggedSetIdByItemIndex={loggedSetIdByItemIndex}
          loggedSets={setsByMovement.get(group.movementId) ?? []}
          priorBests={priorBests}
          addStrengthSet={addStrengthSet}
          fillFromPlan={fillFromPlan}
          showFillFromPlan={i === 0 && showFillOnFirst}
          hapticsEnabled={hapticsEnabled}
          timerSoundEnabled={timerSoundEnabled}
        />
      ))}

      {freestyleMerged.map((m) => (
        <FreestyleMovementCard
          key={m.id}
          sessionId={sessionId}
          movement={m}
          loggedSets={setsByMovement.get(m.id) ?? []}
          tmKg={tmBySlug[m.slug]}
          priorBest={priorBests[m.id]}
          addStrengthSet={addStrengthSet}
          hapticsEnabled={hapticsEnabled}
          timerSoundEnabled={timerSoundEnabled}
        />
      ))}

      {!isComplete && (
        <div
          className="cp-card"
          style={{ padding: 12, display: "grid", gap: 8 }}
        >
          {!showPicker ? (
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              data-testid="movement-card-add"
              className="cp-btn"
              style={{ padding: "10px 12px", fontSize: 13 }}
            >
              + Add movement
            </button>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <MovementPicker
                name="__add_movement"
                onChange={handlePick}
                placeholder="Search the catalog…"
              />
              <button
                type="button"
                onClick={() => setShowPicker(false)}
                className="cp-btn"
                style={{ padding: "6px 10px", fontSize: 11 }}
              >
                × cancel
              </button>
            </div>
          )}
        </div>
      )}

      {allSetsLoggedAcrossSession > 0 && (
        <section
          className="cp-card"
          data-testid="all-logged-sets"
          style={{ padding: 12 }}
        >
          <button
            type="button"
            onClick={() => setAllSetsExpanded((v) => !v)}
            aria-expanded={allSetsExpanded}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13, flex: "1 1 auto" }}>
              All logged sets ({allSetsLoggedAcrossSession})
            </span>
            <span aria-hidden="true" style={{ color: "var(--cp-text-muted)" }}>
              {allSetsExpanded ? "▾" : "▸"}
            </span>
          </button>
          {allSetsExpanded && (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
                marginTop: 8,
              }}
            >
              <tbody>
                {sets.map((s) => (
                  <tr
                    key={s.id}
                    data-testid={`logged-set-row-${s.id}`}
                    style={{ borderTop: "1px solid var(--cp-border)" }}
                  >
                    <td
                      className="mono"
                      style={{
                        padding: "6px 8px 6px 0",
                        color: "var(--cp-text-muted)",
                        width: 28,
                      }}
                    >
                      #{s.set_index + 1}
                    </td>
                    <td style={{ padding: "6px 8px", fontWeight: 500 }}>
                      {s.movement.display_name}
                    </td>
                    <td className="mono" style={{ padding: "6px 8px" }}>
                      {s.weight_kg ? `${s.weight_kg} kg` : ""}
                      {s.reps ? ` × ${s.reps}` : ""}
                    </td>
                    <td
                      style={{
                        padding: "6px 8px",
                        color: "var(--cp-text-muted)",
                      }}
                    >
                      {String(s.set_kind).replace("_", " ")}
                    </td>
                    {!isComplete && (
                      <td
                        style={{
                          padding: "6px 0 6px 8px",
                          textAlign: "right",
                          width: 36,
                        }}
                      >
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
          )}
        </section>
      )}
    </div>
  );
}

function PrescribedCard(props: {
  sessionId: string;
  group: MovementGroup;
  tmBySlug: Record<string, number>;
  loggedItemIndices: ReadonlySet<number>;
  loggedSetIdByItemIndex: Readonly<Record<number, string>>;
  loggedSets: LoggedSet[];
  priorBests: Record<string, { heaviestWeight: number | null; bestE1rm: number | null }>;
  addStrengthSet: typeof addStrengthSetAction;
  fillFromPlan: typeof fillSessionFromPlanAction;
  showFillFromPlan: boolean;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
}) {
  const tmKg = props.group.movementSlug
    ? props.tmBySlug[props.group.movementSlug]
    : undefined;
  const priorBest = props.priorBests[props.group.movementId];
  const focusLogged = props.loggedSets.map((s) => ({
    id: s.id,
    weightKg: s.weight_kg == null ? null : Number(s.weight_kg),
    reps: s.reps,
    rpe: s.rpe == null ? null : Number(s.rpe),
  }));
  return (
    <MovementCard
      sessionId={props.sessionId}
      group={props.group}
      tmKg={tmKg}
      loggedItemIndices={props.loggedItemIndices}
      loggedSetIdByItemIndex={props.loggedSetIdByItemIndex}
      loggedSets={focusLogged}
      priorBest={priorBest}
      addStrengthSet={props.addStrengthSet}
      fillFromPlan={props.fillFromPlan}
      showFillFromPlan={props.showFillFromPlan}
      hapticsEnabled={props.hapticsEnabled}
      timerSoundEnabled={props.timerSoundEnabled}
      persistKeyPrefix={`mc:${props.sessionId}`}
    />
  );
}
