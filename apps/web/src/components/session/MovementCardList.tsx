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
import {
  segmentAccessoryGroups,
  type SupersetCardInfo,
} from "@/lib/sessions/superset-cards";
import { MovementCard } from "./MovementCard";
import { FreestyleMovementCard } from "./FreestyleMovementCard";
import type { PlateInventoryItem } from "./plate-math";
import type { LoggedSet, LastSetHint } from "./SessionLogClient";
import type {
  addStrengthSet as addStrengthSetAction,
  fillSessionFromPlan as fillSessionFromPlanAction,
} from "@/lib/sessions/actions";
import { removeSessionMovementAction } from "@/lib/sessions/session-movement-actions";
import type { ResolvedFreestyleMovement } from "@/lib/sessions/freestyle-resolver";

const EMPTY_SUPERSET_MAP: ReadonlyMap<string, SupersetCardInfo> = new Map();

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
  /**
   * Prior-session "last time: X kg × Y (date)" top set per movementId,
   * computed server-side. Surfaced on accessory cards only — mains have
   * a TM-derived prescribed weight, so the hint would be redundant noise
   * there. Optional (defaults to `{}`) so existing callers/tests are
   * unaffected.
   */
  lastSetHints?: Record<string, LastSetHint>;
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
   * ADR 0026 P5b — accessory movementId -> antagonist-superset membership, built
   * server-side from the (unpaired) prescription so paired accessory CARDS can be
   * bracketed and pulled adjacent WITHOUT reordering the index-bearing items.
   * Empty / omitted = no supersets (every card renders solo, as before).
   */
  supersetByMovementId?: ReadonlyMap<string, SupersetCardInfo>;
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
  lastSetHints = {},
  addStrengthSet,
  fillFromPlan,
  hapticsEnabled,
  timerSoundEnabled,
  barbellKg,
  trapBarKg,
  plateInventory,
  bwGateStateByFamily,
  resolvedFreestyle,
  supersetByMovementId,
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
  //
  // The actual "+ Add" entry point now lives in `<AddToWorkout>` at
  // the page level (issue #210 unification — the inline picker that
  // used to be rendered below this list was a duplicate surface).
  // `pendingFreestyle` is retained as a no-op slot so the optimistic
  // round-trip continues to work if a future caller wires it back up;
  // today, the only mutator left is `setRemovedIds` via `handleRemove`.
  const [pendingFreestyle] = useState<LoggedSet["movement"][]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());

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

  const handleRemove = (movementId: string) => {
    // Drop into the tombstone set so the card disappears immediately;
    // the server action will revalidate on its own.
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

  // ADR 0026 P5b — fold the accessory cards into solo cards + antagonist
  // superset clusters (A2 pulled adjacent to A1). Membership is derived
  // server-side from the unpaired prescription; the underlying items are NOT
  // reordered, so the index-based set matching is untouched. Empty map (pref
  // off / no pairs) => every entry is solo, original order preserved.
  const accessorySegments = useMemo(
    () => segmentAccessoryGroups(accessoryGroups, supersetByMovementId ?? EMPTY_SUPERSET_MAP),
    [accessoryGroups, supersetByMovementId],
  );

  // Accessory movementIds — the only bucket that surfaces the
  // prior-session "last time" hint (mains use a TM-derived target).
  const accessoryIds = useMemo(
    () => new Set(accessoryGroups.map((g) => g.movementId)),
    [accessoryGroups],
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
        lastSetHint={
          accessoryIds.has(group.movementId)
            ? lastSetHints[group.movementId]
            : undefined
        }
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
          {accessorySegments.map((seg) =>
            seg.kind === "solo" ? (
              renderCard(seg.group)
            ) : (
              <SupersetCardBracket key={seg.groupId} groupId={seg.groupId}>
                {seg.groups.map(renderCard)}
              </SupersetCardBracket>
            ),
          )}
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
  lastSetHint?: LastSetHint;
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
      lastSetHint={props.lastSetHint}
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

/**
 * ADR 0026 P5b — bracket around an antagonist superset pair in the logger.
 * Wraps the two paired accessory cards with a left accent rule + a "Superset ·
 * alternate, rest once" caption so the lifter does them back-to-back and rests
 * a single time per round. Internal A1/A2 slot codes are NOT surfaced.
 */
function SupersetCardBracket({
  groupId,
  children,
}: {
  groupId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid="superset-card-bracket"
      data-superset-group={groupId}
      style={{
        display: "grid",
        gap: 12,
        borderLeft: "2px solid var(--cp-accent, var(--cp-text-muted))",
        paddingLeft: 10,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--cp-accent, var(--cp-text-muted))",
          fontWeight: 600,
        }}
      >
        Superset · alternate, rest once
      </div>
      {children}
    </div>
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
