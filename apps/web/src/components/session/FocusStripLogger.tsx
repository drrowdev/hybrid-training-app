"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MovementGroup } from "@/lib/sessions/movement-grouping";
import { bucketForGroup } from "@/lib/sessions/movement-summary";
import { summariseGroupForHeader } from "@/lib/sessions/movement-summary";
import type { LastSetHint, LoggedSet } from "./SessionLogClient";
import type { FocusLoggedSet } from "./MovementFocusView";
import { MovementFocusView } from "./MovementFocusView";
import { LastSetHintRow } from "./MovementCard";
import { SwapMovementModal } from "./SwapMovementModal";
import { MovementHowToButton } from "./MovementHowToButton";
import type { PlateInventoryItem } from "./plate-math";
import type { SupersetCardInfo } from "@/lib/sessions/superset-cards";
import { hapticTick } from "@/lib/feedback";
import type {
  addStrengthSet,
  updateStrengthSetInline,
} from "@/lib/sessions/actions";

export type FocusStripLoggerProps = {
  sessionId: string;
  groups: MovementGroup[];
  setsByMovement: ReadonlyMap<string, LoggedSet[]>;
  tmBySlug: Record<string, number>;
  oneRmBySlug: Record<string, number>;
  loggedItemIndices: ReadonlySet<number>;
  skippedItemIndices?: ReadonlySet<number>;
  loggedSetIdByItemIndex: Readonly<Record<number, string>>;
  priorBests: Record<
    string,
    { heaviestWeight: number | null; bestE1rm: number | null }
  >;
  lastSetHints?: Readonly<Record<string, LastSetHint>>;
  supersetByMovementId?: ReadonlyMap<string, SupersetCardInfo>;
  reorderableMovementIds?: readonly string[];
  onReorderMovements?: (movementIds: string[]) => void;
  addStrengthSet: typeof addStrengthSet;
  updateStrengthSet: typeof updateStrengthSetInline;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
  barbellKg?: number;
  trapBarKg?: number;
  plateInventory?: PlateInventoryItem[];
  preferStandardLbPlates?: boolean;
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
  bodyweightMovementIds?: ReadonlySet<string>;
};

type SwapTarget = { id: string; slug: string; displayName: string };

export function reconcileConfirmedSwaps(
  previous: Readonly<Record<string, SwapTarget>>,
  groups: readonly Pick<MovementGroup, "movementId">[],
): Record<string, SwapTarget> {
  let next: Record<string, SwapTarget> | null = null;
  for (const [originalId, replacement] of Object.entries(previous)) {
    const originalStillPresent = groups.some(
      (group) => group.movementId === originalId,
    );
    const replacementPresent = groups.some(
      (group) => group.movementId === replacement.id,
    );
    if (!originalStillPresent && replacementPresent) {
      next ??= { ...previous };
      delete next[originalId];
    }
  }
  return next ?? previous;
}

function requiredIndices(group: MovementGroup): number[] {
  return group.itemIndices.filter((_, slot) => !group.items[slot]?.optional);
}

function optionalIndices(group: MovementGroup): number[] {
  return group.itemIndices.filter((_, slot) => group.items[slot]?.optional);
}

function coveredCount(
  indices: readonly number[],
  loggedItemIndices: ReadonlySet<number>,
): number {
  return indices.filter((index) => loggedItemIndices.has(index)).length;
}

function focusSets(sets: LoggedSet[]): FocusLoggedSet[] {
  return sets.map((set) => ({
    id: set.id,
    movementId: set.movement.id,
    weightKg: set.weight_kg == null ? null : Number(set.weight_kg),
    reps: set.reps,
    distanceM: set.distance_m ?? null,
    durationSec: set.duration_sec ?? null,
    rpe: set.rpe == null ? null : Number(set.rpe),
    skipped: set.skipped ?? false,
    skipReason:
      (set.skip_reason as FocusLoggedSet["skipReason"] | null | undefined) ??
      null,
  }));
}

export function FocusStripLogger({
  sessionId,
  groups,
  setsByMovement,
  tmBySlug,
  oneRmBySlug,
  loggedItemIndices,
  skippedItemIndices,
  loggedSetIdByItemIndex,
  priorBests,
  lastSetHints = {},
  supersetByMovementId,
  reorderableMovementIds,
  onReorderMovements,
  addStrengthSet,
  updateStrengthSet,
  hapticsEnabled,
  timerSoundEnabled,
  barbellKg,
  trapBarKg,
  plateInventory,
  preferStandardLbPlates,
  bwGateStateByFamily,
  bodyweightMovementIds,
}: FocusStripLoggerProps) {
  const router = useRouter();
  const firstOpenId = useMemo(() => {
    const open = groups.find((group) =>
      requiredIndices(group).some((index) => !loggedItemIndices.has(index)),
    );
    return open?.movementId ?? groups[0]?.movementId ?? "";
  }, [groups, loggedItemIndices]);
  const [activeId, setActiveId] = useState(firstOpenId);
  const [declinedOptionalIds, setDeclinedOptionalIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapped, setSwapped] = useState<Record<string, SwapTarget>>({});
  const allLoggedSets = useMemo(
    () => Array.from(setsByMovement.values()).flatMap((sets) => sets),
    [setsByMovement],
  );
  const focusLoggedSets = useMemo(
    () => focusSets(allLoggedSets),
    [allLoggedSets],
  );

  useEffect(() => {
    if (groups.some((group) => group.movementId === activeId)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep active queue item valid when a swap/revalidation replaces groups
    setActiveId(firstOpenId);
  }, [activeId, firstOpenId, groups]);
  useEffect(() => {
    // Drop an optimistic swap as soon as the refreshed prescription reflects it.
    // Otherwise an A → B → A sequence can reapply the stale A → B override.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile temporary swap paint with the authoritative refreshed groups
    setSwapped((previous) => reconcileConfirmedSwaps(previous, groups));
  }, [groups]);

  const activeOriginal =
    groups.find((group) => group.movementId === activeId) ?? groups[0];
  if (!activeOriginal) return null;
  const activeSwap = swapped[activeOriginal.movementId];
  const activeGroup = activeSwap
    ? {
        ...activeOriginal,
        movementId: activeSwap.id,
        movementSlug: activeSwap.slug,
        movementName: activeSwap.displayName,
      }
    : activeOriginal;
  const activeLoggedSetIds = new Set(
    activeOriginal.itemIndices
      .map((index) => loggedSetIdByItemIndex[index])
      .filter((id): id is string => id != null),
  );
  const activeLoggedSets = focusLoggedSets.filter(
    (set) =>
      set.movementId === activeOriginal.movementId ||
      activeLoggedSetIds.has(set.id),
  );

  const activeRequired = requiredIndices(activeOriginal);
  const activeOptional = optionalIndices(activeOriginal);
  const requiredDone =
    coveredCount(activeRequired, loggedItemIndices) === activeRequired.length;
  const optionalOpen = activeOptional.filter(
    (index) => !loggedItemIndices.has(index),
  );
  const declinedOptional = declinedOptionalIds.has(activeOriginal.movementId);
  const activeSuperset = supersetByMovementId?.get(
    activeOriginal.movementId,
  );
  const supersetPartner = activeSuperset
    ? groups.find((group) => {
        if (group.movementId === activeOriginal.movementId) return false;
        return (
          supersetByMovementId?.get(group.movementId)?.groupId ===
          activeSuperset.groupId
        );
      })
    : undefined;

  const totalRequired = groups.reduce(
    (sum, group) => sum + requiredIndices(group).length,
    0,
  );
  const totalRequiredDone = groups.reduce(
    (sum, group) =>
      sum + coveredCount(requiredIndices(group), loggedItemIndices),
    0,
  );

  const advance = (declinedIds = declinedOptionalIds) => {
    const start = groups.findIndex((group) => group.movementId === activeId);
    for (let offset = 1; offset <= groups.length; offset += 1) {
      const candidate = groups[(start + offset) % groups.length]!;
      const requiredOpen = requiredIndices(candidate).some(
        (index) => !loggedItemIndices.has(index),
      );
      const optionalOpenForCandidate = optionalIndices(candidate).some(
        (index) => !loggedItemIndices.has(index),
      );
      if (
        requiredOpen ||
        (optionalOpenForCandidate &&
          !declinedIds.has(candidate.movementId))
      ) {
        setActiveId(candidate.movementId);
        return;
      }
    }
  };
  const hasOpenWork = (
    group: MovementGroup,
    declinedIds = declinedOptionalIds,
  ) =>
    requiredIndices(group).some((index) => !loggedItemIndices.has(index)) ||
    (optionalIndices(group).some(
      (index) => !loggedItemIndices.has(index),
    ) &&
      !declinedIds.has(group.movementId));

  const role = bucketForGroup(activeOriginal);
  const roleLabel =
    role === "main"
      ? "Main lift"
      : role === "supplemental"
        ? "Supplemental"
        : role === "accessory"
          ? "Accessory"
          : "Movement";
  const tmKg = activeGroup.movementSlug
    ? tmBySlug[activeGroup.movementSlug]
    : undefined;
  const oneRmKg = activeGroup.movementSlug
    ? oneRmBySlug[activeGroup.movementSlug]
    : undefined;
  const targetSummary = summariseGroupForHeader(
    activeGroup,
    [],
    tmKg,
    oneRmKg != null && tmKg != null && Math.abs(tmKg - oneRmKg) < 0.001
      ? "1RM"
      : "TM",
  );

  return (
    <section
      data-testid="focus-strip-logger"
      style={{ display: "grid", gap: 12, maxWidth: 560, marginInline: "auto" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 700,
            }}
          >
            Workout progress
          </div>
          <div style={{ fontSize: 13, color: "var(--cp-text-soft)" }}>
            {totalRequiredDone} of {totalRequired} required sets
          </div>
        </div>
      </div>
      {reorderableMovementIds &&
        reorderableMovementIds.length > 1 &&
        onReorderMovements && (
          <details
            data-testid="focus-strip-reorder"
            style={{
              border: "1px solid var(--cp-border)",
              borderRadius: 10,
              padding: "8px 10px",
              background: "var(--cp-surface)",
            }}
          >
            <summary
              className="cp-link"
              style={{ cursor: "pointer", fontSize: 12 }}
            >
              Reorder accessories
            </summary>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {reorderableMovementIds.map((movementId, index) => {
                const movement = groups.find(
                  (group) => group.movementId === movementId,
                );
                if (!movement) return null;
                const move = (offset: -1 | 1) => {
                  const next = [...reorderableMovementIds];
                  const target = index + offset;
                  [next[index], next[target]] = [next[target]!, next[index]!];
                  hapticTick(hapticsEnabled);
                  onReorderMovements(next);
                };
                return (
                  <div
                    key={movementId}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto auto",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 12,
                      }}
                    >
                      {movement.movementName}
                    </span>
                    <button
                      type="button"
                      className="cp-btn"
                      aria-label={`Move ${movement.movementName} earlier`}
                      disabled={index === 0}
                      onClick={() => move(-1)}
                      style={{ minWidth: 44, minHeight: 44, padding: 8 }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="cp-btn"
                      aria-label={`Move ${movement.movementName} later`}
                      disabled={index === reorderableMovementIds.length - 1}
                      onClick={() => move(1)}
                      style={{ minWidth: 44, minHeight: 44, padding: 8 }}
                    >
                      ↓
                    </button>
                  </div>
                );
              })}
            </div>
          </details>
        )}

      <div
        data-testid="focus-strip-movement-queue"
        role="navigation"
        aria-label="Choose movement"
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          paddingBottom: 2,
        }}
      >
        {groups.map((group) => {
          const required = requiredIndices(group);
          const optional = optionalIndices(group);
          const all = [...required, ...optional];
          const done = coveredCount(all, loggedItemIndices);
          const settled =
            coveredCount(required, loggedItemIndices) === required.length &&
            (optional.every((index) => loggedItemIndices.has(index)) ||
              declinedOptionalIds.has(group.movementId));
          const current = group.movementId === activeOriginal.movementId;
          return (
            <button
              key={group.movementId}
              type="button"
              data-testid={`focus-strip-queue-${group.movementId}`}
              data-current={current ? "true" : "false"}
              aria-pressed={current}
              onClick={() => setActiveId(group.movementId)}
              style={{
                flex: "0 0 auto",
                minHeight: 44,
                padding: "0 11px",
                borderRadius: 999,
                border: `1px solid ${
                  current ? "var(--cp-accent)" : "var(--cp-border)"
                }`,
                background: current
                  ? "var(--cp-accent-soft)"
                  : "var(--cp-surface)",
                color: settled
                  ? "var(--cp-success)"
                  : current
                    ? "var(--cp-accent)"
                    : "var(--cp-text-muted)",
                fontSize: 12,
                fontWeight: current ? 700 : 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {group.movementName} {settled ? "✓" : `${done}/${all.length}`}
            </button>
          );
        })}
      </div>

      <div
        className="cp-card"
        style={{ padding: 16, display: "grid", gap: 12 }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 24,
                  letterSpacing: "-0.025em",
                }}
              >
                {activeGroup.movementName}
              </h2>
              <MovementHowToButton
                movementId={activeGroup.movementId}
                displayName={activeGroup.movementName}
              />
            </div>
            <div
              style={{
                marginTop: 3,
                color: "var(--cp-text-muted)",
                fontSize: 12,
              }}
            >
              {roleLabel}
              {targetSummary ? ` · ${targetSummary}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSwapOpen(true)}
            aria-label={`Swap ${activeGroup.movementName}`}
            data-testid="focus-strip-swap"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "1px solid var(--cp-border)",
              background: "var(--cp-surface)",
              color: "var(--cp-text-muted)",
              fontSize: 18,
              cursor: "pointer",
              flex: "0 0 auto",
            }}
          >
            ⇄
          </button>
        </div>

        {declinedOptional ? (
          <div
            data-testid="focus-strip-optional-declined"
            style={{
              display: "grid",
              gap: 10,
              padding: 16,
              borderRadius: 12,
              background: "var(--cp-surface-soft)",
              border: "1px solid var(--cp-border)",
            }}
          >
            <div>
              <strong>Optional sets declined</strong>
              <div
                style={{
                  marginTop: 3,
                  color: "var(--cp-text-muted)",
                  fontSize: 12,
                }}
              >
                Required work is preserved. Reopen this lift at any time.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="cp-btn"
                data-testid="focus-strip-reopen-optional"
                onClick={() =>
                  setDeclinedOptionalIds((previous) => {
                    const next = new Set(previous);
                    next.delete(activeOriginal.movementId);
                    return next;
                  })
                }
              >
                Reopen optional sets
              </button>
              <button
                type="button"
                className="cp-btn primary"
                onClick={() => advance()}
              >
                Next movement
              </button>
            </div>
          </div>
        ) : (
          <>
           {activeSuperset && supersetPartner && (
             <div
               data-testid="focus-strip-superset-cue"
               style={{
                 padding: "8px 10px",
                 borderRadius: 10,
                 border: "1px solid var(--cp-border)",
                 background: "var(--cp-surface-soft)",
                 color: "var(--cp-text-muted)",
                 fontSize: 12,
               }}
             >
               <strong style={{ color: "var(--cp-text)" }}>Superset</strong>
               {" · "}alternate with {supersetPartner.movementName}, then rest
               once.
             </div>
           )}
           {role === "accessory" && (
             <LastSetHintRow
               hint={lastSetHints[activeOriginal.movementId]}
               label={activeGroup.movementName}
             />
           )}
            <MovementFocusView
              sessionId={sessionId}
              group={activeGroup}
              tmKg={tmKg}
              oneRmKg={oneRmKg}
              loggedItemIndices={loggedItemIndices}
              skippedItemIndices={skippedItemIndices}
              loggedSetIdByItemIndex={loggedSetIdByItemIndex}
              loggedSets={activeLoggedSets}
              priorBest={priorBests[activeOriginal.movementId]}
              addStrengthSet={addStrengthSet}
              updateStrengthSet={updateStrengthSet}
              hapticsEnabled={hapticsEnabled}
              timerSoundEnabled={timerSoundEnabled}
              barbellKg={barbellKg}
              trapBarKg={trapBarKg}
              plateInventory={plateInventory}
              preferStandardLbPlates={preferStandardLbPlates}
              bwGateStateByFamily={bwGateStateByFamily}
              bodyweightCapable={
                bodyweightMovementIds?.has(activeOriginal.movementId) ?? false
              }
              suppressRestAfterSave={
                activeSuperset?.slot === "A1" && supersetPartner != null
              }
              focusStrip
              onSaved={({ isLast }) => {
                if (supersetPartner && hasOpenWork(supersetPartner)) {
                  setActiveId(supersetPartner.movementId);
                } else if (isLast) {
                  advance();
                }
              }}
            />
            {requiredDone && optionalOpen.length > 0 && (
              <button
                type="button"
                data-testid="focus-strip-end-movement"
                onClick={() => {
                  const next = new Set(declinedOptionalIds);
                  next.add(activeOriginal.movementId);
                  setDeclinedOptionalIds(next);
                  advance(next);
                }}
                style={{
                  justifySelf: "start",
                  border: 0,
                  background: "transparent",
                  color: "var(--cp-text-muted)",
                  textDecoration: "underline",
                  fontSize: 12,
                  cursor: "pointer",
                  minHeight: 44,
                  padding: "4px 0",
                }}
              >
                End movement
              </button>
            )}
          </>
        )}
      </div>

      <SwapMovementModal
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        sessionId={sessionId}
        original={{
          id: activeGroup.movementId,
          displayName: activeGroup.movementName,
        }}
        onSwapped={(next) => {
          setSwapped((previous) => ({
            ...previous,
            [activeOriginal.movementId]: next,
          }));
          setSwapOpen(false);
          router.refresh();
        }}
      />
    </section>
  );
}
