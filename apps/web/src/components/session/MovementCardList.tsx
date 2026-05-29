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
import {
  addSessionMovementAction,
  removeSessionMovementAction,
} from "@/lib/sessions/session-movement-actions";
import type { ResolvedFreestyleMovement } from "@/lib/sessions/freestyle-resolver";

export type MovementCardListProps = {
  sessionId: string;
  isComplete: boolean;
  prescription: Prescription | null;
  sets: LoggedSet[];
  tmBySlug: Record<string, number>;
  oneRmBySlug: Record<string, number>;
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
  /**
   * Phase 4 BW gate state, keyed by movement family. Forwarded verbatim
   * to each prescribed `<MovementCard>` so the focus view can render the
   * "Next:" chip + popover.
   */
  bwGateStateByFamily?: Readonly<
    Record<
      string,
      {
        weeksAtNode: number;
        weeksRequired: number;
        tutAccumulated: number;
        tutRequired: number;
        recentOverCompleted: boolean;
      }
    >
  >;
  /**
   * Server-resolved freestyle movement list (persisted +
   * set_logs-derived union). When supplied, replaces the legacy
   * "movements derived from set_logs only" computation that used to
   * live in this component.
   */
  resolvedFreestyle?: ReadonlyArray<ResolvedFreestyleMovement>;
  /**
   * Suppress the inline "+ Add off-plan movement" button + picker at
   * the bottom of the card list. The session page sets this on
   * pure-cardio sessions so the +Add button can be rendered AFTER the
   * cardio block instead of appearing as the first interactive thing
   * on an otherwise-empty strength surface (Fix 3 of the
   * active-session UX overhaul).
   */
  hideAddOffPlan?: boolean;
};

export function MovementCardList({
  sessionId,
  isComplete,
  prescription,
  sets,
  tmBySlug,
  oneRmBySlug,
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
  bwGateStateByFamily,
  resolvedFreestyle,
  hideAddOffPlan,
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
  // Used as the fallback when the server didn't supply a resolved list.
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
  // anything the server already knows about. Also acts as the
  // optimistic-remove ledger: we hide ids the user asked to remove
  // before the next server fetch lands.
  const [pendingFreestyle, setPendingFreestyle] = useState<LoggedSet["movement"][]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [showPicker, setShowPicker] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Final ordered list of (movement, loggedSetCount) tuples for the
  // freestyle render block. When the server supplied a resolved union
  // we honour it verbatim (modulo optimistic pending/removed). When it
  // didn't, we fall back to the legacy "derived from sets" shape so
  // older callers (and tests) keep working.
  const freestyleMerged = useMemo<
    Array<{ movement: LoggedSet["movement"]; loggedSetCount: number }>
  >(() => {
    const setsCount = new Map<string, number>();
    for (const s of sets) {
      if (!s.movement.id) continue;
      setsCount.set(s.movement.id, (setsCount.get(s.movement.id) ?? 0) + 1);
    }

    const seen = new Set<string>();
    const out: Array<{ movement: LoggedSet["movement"]; loggedSetCount: number }> = [];

    if (resolvedFreestyle && resolvedFreestyle.length > 0) {
      for (const r of resolvedFreestyle) {
        if (prescribedIds.has(r.movement.id)) continue;
        if (removedIds.has(r.movement.id)) continue;
        seen.add(r.movement.id);
        out.push({ movement: r.movement, loggedSetCount: r.loggedSetCount });
      }
    } else {
      for (const m of freestyleMovements) {
        if (removedIds.has(m.id)) continue;
        seen.add(m.id);
        out.push({ movement: m, loggedSetCount: setsCount.get(m.id) ?? 0 });
      }
    }

    for (const m of pendingFreestyle) {
      if (seen.has(m.id)) continue;
      if (prescribedIds.has(m.id)) continue;
      if (removedIds.has(m.id)) continue;
      out.push({ movement: m, loggedSetCount: setsCount.get(m.id) ?? 0 });
    }
    return out;
  }, [
    resolvedFreestyle,
    freestyleMovements,
    pendingFreestyle,
    prescribedIds,
    removedIds,
    sets,
  ]);

  const handlePick = async (m: MovementSearchResult | null) => {
    if (!m) return;
    setAddError(null);
    setAddBusy(true);
    // Optimistic insert into pending. If the server rejects we roll
    // back so the card never appears.
    const movement = {
      id: m.id,
      slug: m.slug,
      display_name: m.display_name,
      primary_region: m.primary_region,
    };
    // If the user previously removed this same id during the same
    // session, drop the tombstone so the card reappears.
    setRemovedIds((prev) => {
      if (!prev.has(m.id)) return prev;
      const next = new Set(prev);
      next.delete(m.id);
      return next;
    });
    setPendingFreestyle((prev) =>
      prev.find((x) => x.id === m.id) ? prev : [...prev, movement],
    );
    setShowPicker(false);
    try {
      const result = await addSessionMovementAction(sessionId, m.id);
      if (!result.ok) {
        // Roll back optimistic add.
        setPendingFreestyle((prev) => prev.filter((x) => x.id !== m.id));
        setAddError(result.error);
      }
    } catch (err) {
      setPendingFreestyle((prev) => prev.filter((x) => x.id !== m.id));
      setAddError(err instanceof Error ? err.message : "Could not add movement.");
    } finally {
      setAddBusy(false);
    }
  };

  const handleRemove = (movementId: string) => {
    // Strip from pending (covers the just-added-not-yet-refreshed
    // case) AND drop into the tombstone set (covers persisted rows
    // that already came down from the server).
    setPendingFreestyle((prev) => prev.filter((x) => x.id !== movementId));
    setRemovedIds((prev) => {
      if (prev.has(movementId)) return prev;
      const next = new Set(prev);
      next.add(movementId);
      return next;
    });
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
        oneRmBySlug={oneRmBySlug}
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
        bwGateStateByFamily={bwGateStateByFamily}
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

      {freestyleMerged.map(({ movement: m, loggedSetCount }) => (
        <FreestyleMovementCard
          key={m.id}
          sessionId={sessionId}
          movement={m}
          loggedSets={setsByMovement.get(m.id) ?? []}
          loggedSetCount={loggedSetCount}
          tmKg={tmBySlug[m.slug]}
          oneRmKg={oneRmBySlug[m.slug]}
          priorBest={priorBests[m.id]}
          addStrengthSet={addStrengthSet}
          removeSessionMovement={removeSessionMovementAction}
          onRemove={handleRemove}
          hapticsEnabled={hapticsEnabled}
          timerSoundEnabled={timerSoundEnabled}
        />
      ))}

      {!isComplete && !hideAddOffPlan && (
        <div
          style={{
            display: "grid",
            justifyItems: "center",
            gap: 6,
            padding: "8px 0",
          }}
        >
          {!showPicker ? (
            <button
              type="button"
              onClick={() => {
                setAddError(null);
                setShowPicker(true);
              }}
              data-testid="movement-card-add"
              disabled={addBusy}
              style={{
                // Small text-link-style button so it doesn't compete with the
                // movement cards above. Reporting an off-plan movement is
                // rare; the button shouldn't read as a primary action.
                background: "transparent",
                border: "1px dashed var(--cp-border)",
                borderRadius: 999,
                padding: "4px 14px",
                fontSize: 12,
                color: "var(--cp-text-muted)",
                cursor: addBusy ? "default" : "pointer",
                opacity: addBusy ? 0.6 : 1,
              }}
            >
              {addBusy ? "Adding…" : "+ Add off-plan movement"}
            </button>
          ) : (
            <div
              className="cp-card"
              style={{ padding: 12, display: "grid", gap: 8, width: "100%", maxWidth: 520 }}
            >
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
          {addError && (
            <div
              role="alert"
              data-testid="movement-card-add-error"
              style={{ fontSize: 12, color: "var(--cp-danger)" }}
            >
              {addError}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

function PrescribedCard(props: {
  sessionId: string;
  group: MovementGroup;
  tmBySlug: Record<string, number>;
  oneRmBySlug: Record<string, number>;
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
  bwGateStateByFamily?: Readonly<
    Record<
      string,
      {
        weeksAtNode: number;
        weeksRequired: number;
        tutAccumulated: number;
        tutRequired: number;
        recentOverCompleted: boolean;
      }
    >
  >;
}) {
  const tmKg = props.group.movementSlug
    ? props.tmBySlug[props.group.movementSlug]
    : undefined;
  const oneRmKg = props.group.movementSlug
    ? props.oneRmBySlug[props.group.movementSlug]
    : undefined;
  const priorBest = props.priorBests[props.group.movementId];
  const focusLogged = props.loggedSets.map((s) => ({
    id: s.id,
    weightKg: s.weight_kg == null ? null : Number(s.weight_kg),
    reps: s.reps,
    distanceM: s.distance_m ?? null,
    durationSec: s.duration_sec ?? null,
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
      oneRmKg={oneRmKg}
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
      bwGateStateByFamily={props.bwGateStateByFamily}
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
