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
import { bucketForGroup } from "@/lib/sessions/movement-summary";
import { MovementCard } from "./MovementCard";
import { FreestyleMovementCard } from "./FreestyleMovementCard";
import type { PlateInventoryItem } from "./plate-math";
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
  skippedItemIndices?: ReadonlySet<number>;
  loggedSetIdByItemIndex: Readonly<Record<number, string>>;
  priorBests: Record<string, { heaviestWeight: number | null; bestE1rm: number | null }>;
  addStrengthSet: typeof addStrengthSetAction;
  fillFromPlan: typeof fillSessionFromPlanAction;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
  /** User equipment props forwarded to each prescribed card. */
  barbellKg?: number;
  trapBarKg?: number;
  plateInventory?: PlateInventoryItem[];
};

export function MovementCardList({
  sessionId,
  isComplete,
  prescription,
  sets,
  tmBySlug,
  loggedItemIndices,
  skippedItemIndices,
  loggedSetIdByItemIndex,
  priorBests,
  addStrengthSet,
  fillFromPlan,
  hapticsEnabled,
  timerSoundEnabled,
  barbellKg,
  trapBarKg,
  plateInventory,
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

  // Partition prescribed groups into main vs accessory buckets for
  // the two sub-section headings. Order within each bucket is the
  // original first-appearance order from the prescription.
  const { mainGroups, accessoryGroups, otherGroups } = useMemo(() => {
    const main: MovementGroup[] = [];
    const accessory: MovementGroup[] = [];
    const other: MovementGroup[] = [];
    for (const g of groups) {
      const b = bucketForGroup(g);
      if (b === "main") main.push(g);
      else if (b === "accessory") accessory.push(g);
      else other.push(g);
    }
    return { mainGroups: main, accessoryGroups: accessory, otherGroups: other };
  }, [groups]);

  const allSetsLoggedAcrossSession = sets.length;
  // First prescribed card with no logged sets across the whole session
  // shows the session-level "Same as planned" button.
  const showFillOnFirst = !isComplete && sets.length === 0;

  // Build a single ordered render list so the "first card" check for
  // the session-level fill button stays correct across both sections.
  const orderedGroups: MovementGroup[] = useMemo(
    () => [...mainGroups, ...accessoryGroups, ...otherGroups],
    [mainGroups, accessoryGroups, otherGroups],
  );

  const renderCard = (group: MovementGroup) => {
    const idx = orderedGroups.indexOf(group);
    return (
      <PrescribedCard
        key={group.movementId}
        sessionId={sessionId}
        group={group}
        tmBySlug={tmBySlug}
        loggedItemIndices={loggedItemIndices}
        skippedItemIndices={skippedItemIndices}
        loggedSetIdByItemIndex={loggedSetIdByItemIndex}
        loggedSets={setsByMovement.get(group.movementId) ?? []}
        priorBests={priorBests}
        addStrengthSet={addStrengthSet}
        fillFromPlan={fillFromPlan}
        showFillFromPlan={idx === 0 && showFillOnFirst}
        hapticsEnabled={hapticsEnabled}
        timerSoundEnabled={timerSoundEnabled}
        barbellKg={barbellKg}
        trapBarKg={trapBarKg}
        plateInventory={plateInventory}
      />
    );
  };

  return (
    <div data-testid="movement-card-list" style={{ display: "grid", gap: 12 }}>
      {mainGroups.length > 0 && (
        <>
          <SectionDivider label="Main lifts" testId="movement-group-main" />
          {mainGroups.map(renderCard)}
        </>
      )}

      {accessoryGroups.length > 0 && (
        <>
          <SectionDivider
            label="Accessory work"
            testId="movement-group-accessory"
          />
          {accessoryGroups.map(renderCard)}
        </>
      )}

      {(otherGroups.length > 0 || freestyleMerged.length > 0) && (
        <SectionDivider label="Other" testId="movement-group-other" />
      )}
      {otherGroups.map(renderCard)}

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
                {sets.map((s) => {
                  const isSkipped = !!s.skipped;
                  return (
                    <tr
                      key={s.id}
                      data-testid={`logged-set-row-${s.id}`}
                      data-skipped={isSkipped ? "true" : "false"}
                      style={{
                        borderTop: "1px solid var(--cp-border)",
                        opacity: isSkipped ? 0.6 : 1,
                      }}
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
                        {isSkipped ? (
                          <span style={{ color: "var(--cp-warning)" }}>
                            skipped{s.skip_reason ? ` (${s.skip_reason})` : ""}
                          </span>
                        ) : (
                          <>
                            {s.weight_kg ? `${s.weight_kg} kg` : ""}
                            {s.reps ? ` × ${s.reps}` : ""}
                          </>
                        )}
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
                  );
                })}
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
  skippedItemIndices?: ReadonlySet<number>;
  loggedSetIdByItemIndex: Readonly<Record<number, string>>;
  loggedSets: LoggedSet[];
  priorBests: Record<string, { heaviestWeight: number | null; bestE1rm: number | null }>;
  addStrengthSet: typeof addStrengthSetAction;
  fillFromPlan: typeof fillSessionFromPlanAction;
  showFillFromPlan: boolean;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
  barbellKg?: number;
  trapBarKg?: number;
  plateInventory?: PlateInventoryItem[];
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
    skipped: s.skipped ?? false,
    skipReason: (s.skip_reason as
      | "pain"
      | "fatigue"
      | "time"
      | "equipment"
      | "other"
      | null
      | undefined) ?? null,
  }));
  return (
    <MovementCard
      sessionId={props.sessionId}
      group={props.group}
      tmKg={tmKg}
      loggedItemIndices={props.loggedItemIndices}
      skippedItemIndices={props.skippedItemIndices}
      loggedSetIdByItemIndex={props.loggedSetIdByItemIndex}
      loggedSets={focusLogged}
      priorBest={priorBest}
      addStrengthSet={props.addStrengthSet}
      fillFromPlan={props.fillFromPlan}
      showFillFromPlan={props.showFillFromPlan}
      hapticsEnabled={props.hapticsEnabled}
      timerSoundEnabled={props.timerSoundEnabled}
      barbellKg={props.barbellKg}
      trapBarKg={props.trapBarKg}
      plateInventory={props.plateInventory}
      persistKeyPrefix={`mc:${props.sessionId}`}
    />
  );
}

function SectionDivider({
  label,
  testId,
}: {
  label: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--cp-text-muted)",
        fontWeight: 600,
        padding: "10px 0 2px",
      }}
    >
      <span
        aria-hidden="true"
        style={{ height: 1, flex: 1, background: "var(--cp-border)" }}
      />
      {label}
      <span
        aria-hidden="true"
        style={{ height: 1, flex: 1, background: "var(--cp-border)" }}
      />
    </div>
  );
}
