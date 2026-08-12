"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  movementGroupKey,
  type MovementGroup,
} from "@/lib/sessions/movement-grouping";
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
import {
  buildLinkedCircuitByMovementId,
  circuitMembersFor,
  circuitRoundFor,
  firstOpenCircuitMovementId,
  firstOpenMovementId,
} from "@/lib/sessions/linked-circuit";
import { hapticTick } from "@/lib/feedback";
import { SKIP_REASONS, type SkipReason } from "@/lib/sessions/skip-reasons";
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
  groups: readonly Pick<MovementGroup, "groupKey" | "movementId">[],
): Record<string, SwapTarget> {
  let next: Record<string, SwapTarget> | null = null;
  for (const [originalId, replacement] of Object.entries(previous)) {
    const originalStillPresent = groups.some(
      (group) => movementGroupKey(group) === originalId,
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

type FocusSectionKey = "rehab" | "main" | "accessories";

function focusSectionFor(group: MovementGroup): FocusSectionKey {
  if (group.items.every((item) => item.meta?.rehab === true)) return "rehab";
  const bucket = bucketForGroup(group);
  return bucket === "main" || bucket === "supplemental"
    ? "main"
    : "accessories";
}

const FOCUS_SECTION_LABEL: Record<FocusSectionKey, string> = {
  rehab: "Rehab",
  main: "Main",
  accessories: "Accessories",
};

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
  const linkedCircuitByMovementId = useMemo(
    () => buildLinkedCircuitByMovementId(groups),
    [groups],
  );
  const firstOpenId = useMemo(() => {
    return firstOpenMovementId(
      groups,
      linkedCircuitByMovementId,
      loggedItemIndices,
    );
  }, [groups, linkedCircuitByMovementId, loggedItemIndices]);
  const [activeId, setActiveId] = useState(firstOpenId);
  const [declinedOptionalIds, setDeclinedOptionalIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [swapOpen, setSwapOpen] = useState(false);
  const [skipRehabOpen, setSkipRehabOpen] = useState(false);
  const [skipRehabPending, setSkipRehabPending] = useState(false);
  const [skipRehabError, setSkipRehabError] = useState<string | null>(null);
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
    if (groups.some((group) => movementGroupKey(group) === activeId)) return;
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
    groups.find((group) => movementGroupKey(group) === activeId) ?? groups[0];
  if (!activeOriginal) return null;
  const activeOriginalKey = movementGroupKey(activeOriginal);
  const activeSwap = swapped[activeOriginalKey];
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
  const movementIdIsShared = groups.some(
    (group) =>
      movementGroupKey(group) !== activeOriginalKey &&
      group.movementId === activeOriginal.movementId,
  );
  const activeLoggedSets = focusLoggedSets.filter(
    (set) =>
      activeLoggedSetIds.has(set.id) ||
      (!movementIdIsShared &&
        set.movementId === activeOriginal.movementId),
  );

  const activeRequired = requiredIndices(activeOriginal);
  const activeOptional = optionalIndices(activeOriginal);
  const requiredDone =
    coveredCount(activeRequired, loggedItemIndices) === activeRequired.length;
  const optionalOpen = activeOptional.filter(
    (index) => !loggedItemIndices.has(index),
  );
  const declinedOptional = declinedOptionalIds.has(activeOriginalKey);
  const activeSuperset =
    focusSectionFor(activeOriginal) === "rehab"
      ? undefined
      : supersetByMovementId?.get(activeOriginal.movementId);
  const supersetPartner = activeSuperset
    ? groups.find((group) => {
        if (
          movementGroupKey(group) === activeOriginalKey ||
          focusSectionFor(group) === "rehab"
        ) {
          return false;
        }
        return (
          supersetByMovementId?.get(group.movementId)?.groupId ===
          activeSuperset.groupId
        );
      })
    : undefined;
  const activeCircuit = linkedCircuitByMovementId.get(
    activeOriginalKey,
  );
  const activeCircuitMembers = activeCircuit
    ? circuitMembersFor(
        activeOriginalKey,
        groups,
        linkedCircuitByMovementId,
      )
    : [];
  const activeCircuitRound = activeCircuit
    ? circuitRoundFor(activeOriginal, activeCircuit, loggedItemIndices)
    : null;

  const totalRequired = groups.reduce(
    (sum, group) => sum + requiredIndices(group).length,
    0,
  );
  const totalRequiredDone = groups.reduce(
    (sum, group) =>
      sum + coveredCount(requiredIndices(group), loggedItemIndices),
    0,
  );
  const sectionSummaries = ([
    "rehab",
    "main",
    "accessories",
  ] as const).flatMap((key) => {
    const sectionGroups = groups.filter(
      (group) => focusSectionFor(group) === key,
    );
    if (sectionGroups.length === 0) return [];
    const indices = sectionGroups.flatMap((group) => group.itemIndices);
    return [
      {
        key,
        label: FOCUS_SECTION_LABEL[key],
        groups: sectionGroups,
        done: coveredCount(indices, loggedItemIndices),
        total: indices.length,
      },
    ];
  });

  const advance = (
    declinedIds = declinedOptionalIds,
    coveredIndices = loggedItemIndices,
  ) => {
    const start = groups.findIndex(
      (group) => movementGroupKey(group) === activeId,
    );
    for (let offset = 1; offset <= groups.length; offset += 1) {
      const candidate = groups[(start + offset) % groups.length]!;
      const requiredOpen = requiredIndices(candidate).some(
        (index) => !coveredIndices.has(index),
      );
      const optionalOpenForCandidate = optionalIndices(candidate).some(
        (index) => !coveredIndices.has(index),
      );
      if (
        requiredOpen ||
        (optionalOpenForCandidate &&
          !declinedIds.has(movementGroupKey(candidate)))
      ) {
        setActiveId(movementGroupKey(candidate));
        return;
      }
    }
  };
  const hasOpenWork = (
    group: MovementGroup,
    declinedIds = declinedOptionalIds,
    coveredIndices = loggedItemIndices,
  ) =>
    requiredIndices(group).some((index) => !coveredIndices.has(index)) ||
    (optionalIndices(group).some(
      (index) => !coveredIndices.has(index),
    ) &&
      !declinedIds.has(movementGroupKey(group)));

  const role = bucketForGroup(activeOriginal);
  const isRehabGroup = activeOriginal.items.every(
    (item) => item.meta?.rehab === true,
  );
  const currentSection = focusSectionFor(activeOriginal);
  const hasEmbeddedRehab =
    sectionSummaries.some((section) => section.key === "rehab") &&
    sectionSummaries.some((section) => section.key !== "rehab");
  const remainingRehab = groups.flatMap((group) =>
    focusSectionFor(group) === "rehab"
      ? group.itemIndices
          .map((itemIndex, slot) => ({
            itemIndex,
            movementId: group.movementId,
            kind: group.items[slot]?.kind ?? "tendon",
          }))
          .filter(({ itemIndex }) => !loggedItemIndices.has(itemIndex))
      : [],
  );
  const roleLabel =
    isRehabGroup
      ? hasEmbeddedRehab
        ? "Rehab · during warm-up"
        : "Rehab"
      : role === "main"
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
  const skipRemainingRehab = async (reason: SkipReason) => {
    if (skipRehabPending || remainingRehab.length === 0) return;
    setSkipRehabPending(true);
    setSkipRehabError(null);
    try {
      for (const item of remainingRehab) {
        const formData = new FormData();
        formData.set("sessionId", sessionId);
        formData.set("movementId", item.movementId);
        formData.set("setKind", item.kind);
        formData.set("weightKg", "0");
        formData.set("reps", "0");
        formData.set("prescriptionItemIndex", String(item.itemIndex));
        formData.set("skipped", "true");
        formData.set("skipReason", reason);
        const result = await addStrengthSet(formData);
        if (result?.error) {
          setSkipRehabError(result.error);
          return;
        }
      }
      hapticTick(hapticsEnabled);
      setSkipRehabOpen(false);
      const nextSection = sectionSummaries.find(
        (section) => section.key !== "rehab",
      );
      const nextGroup =
        nextSection?.groups.find((group) =>
          requiredIndices(group).some(
            (index) => !loggedItemIndices.has(index),
          ),
        ) ?? nextSection?.groups[0];
      if (nextGroup) setActiveId(movementGroupKey(nextGroup));
    } finally {
      setSkipRehabPending(false);
    }
  };

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
      {hasEmbeddedRehab && (
        <div
          data-testid="focus-strip-section-nav"
          role="navigation"
          aria-label="Workout sections"
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            paddingBottom: 2,
          }}
        >
          {sectionSummaries.map((section) => {
            const current = section.key === currentSection;
            return (
              <button
                key={section.key}
                type="button"
                aria-pressed={current}
                data-section={section.key}
                onClick={() => {
                  const target =
                    section.groups.find((group) => hasOpenWork(group)) ??
                    section.groups[0];
                  if (target) setActiveId(movementGroupKey(target));
                }}
                style={{
                  flex: "0 0 auto",
                  minHeight: 44,
                  padding: "0 12px",
                  borderRadius: 10,
                  border: `1px solid ${
                    current ? "var(--cp-accent)" : "var(--cp-border)"
                  }`,
                  background: current
                    ? "var(--cp-accent-soft)"
                    : "var(--cp-surface)",
                  color: current
                    ? "var(--cp-accent)"
                    : "var(--cp-text-muted)",
                  fontSize: 12,
                  fontWeight: current ? 700 : 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {section.label} · {section.done}/{section.total}
              </button>
            );
          })}
        </div>
      )}
      {currentSection === "rehab" && remainingRehab.length > 0 && (
        <div
          data-testid="focus-strip-skip-rehab"
          style={{
            display: "grid",
            gap: 8,
            padding: 10,
            border: "1px solid var(--cp-accent)",
            borderRadius: 10,
            background: "var(--cp-accent-soft)",
          }}
        >
          <button
            type="button"
            className="cp-btn"
            onClick={() => setSkipRehabOpen((open) => !open)}
            disabled={skipRehabPending}
          >
            {skipRehabPending
              ? "Skipping…"
              : `Skip remaining rehab (${remainingRehab.length})`}
          </button>
          {skipRehabOpen && (
            <div
              role="group"
              aria-label="Why are you skipping rehab?"
              style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
            >
              {SKIP_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className="cp-btn"
                  disabled={skipRehabPending}
                  onClick={() => void skipRemainingRehab(reason)}
                  style={{ minHeight: 40, textTransform: "capitalize" }}
                >
                  {reason}
                </button>
              ))}
            </div>
          )}
          {skipRehabError && (
            <span role="alert" style={{ color: "var(--cp-danger)", fontSize: 12 }}>
              {skipRehabError}
            </span>
          )}
        </div>
      )}
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
                  (group) =>
                    group.movementId === movementId &&
                    focusSectionFor(group) === "accessories",
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
          const groupKey = movementGroupKey(group);
          const required = requiredIndices(group);
          const optional = optionalIndices(group);
          const all = [...required, ...optional];
          const done = coveredCount(all, loggedItemIndices);
          const settled =
            coveredCount(required, loggedItemIndices) === required.length &&
            (optional.every((index) => loggedItemIndices.has(index)) ||
              declinedOptionalIds.has(groupKey));
          const current = groupKey === activeOriginalKey;
          return (
            <button
              key={groupKey}
              type="button"
              data-testid={`focus-strip-queue-${groupKey}`}
              data-current={current ? "true" : "false"}
              aria-pressed={current}
              onClick={() => setActiveId(groupKey)}
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
                    next.delete(activeOriginalKey);
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
           {activeCircuit && activeCircuitRound != null && (
             <div
               data-testid="focus-strip-circuit-cue"
               style={{
                 padding: "8px 10px",
                 borderRadius: 10,
                 border: "1px solid var(--cp-border)",
                 background: "var(--cp-surface-soft)",
                 color: "var(--cp-text-muted)",
                 fontSize: 12,
                 lineHeight: 1.45,
               }}
             >
               <div>
                 <strong style={{ color: "var(--cp-text)" }}>
                   {activeCircuit.name}
                 </strong>
                 {" · "}Round {activeCircuitRound} of {activeCircuit.rounds}
                 {" · "}Movement {activeCircuit.position + 1} of{" "}
                 {activeCircuit.size}
               </div>
               <div>
                 {activeCircuitMembers
                   .map((member) => member.movementName)
                   .join(" → ")}
               </div>
             </div>
           )}
           {!activeCircuit && activeSuperset && supersetPartner && (
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
                activeCircuit
                  ? activeCircuit.position < activeCircuit.size - 1
                  : activeSuperset?.slot === "A1" && supersetPartner != null
              }
              focusStrip
              onSaved={({ itemIndex, isLast }) => {
                const projected = new Set(loggedItemIndices);
                projected.add(itemIndex);
                const circuitNext = activeCircuit
                  ? firstOpenCircuitMovementId(
                      activeCircuit.id,
                      groups,
                      linkedCircuitByMovementId,
                      projected,
                    )
                  : null;
                if (circuitNext) {
                  setActiveId(circuitNext);
                } else if (
                  supersetPartner &&
                  hasOpenWork(
                    supersetPartner,
                    declinedOptionalIds,
                    projected,
                  )
                ) {
                  setActiveId(movementGroupKey(supersetPartner));
                } else if (isLast) {
                  advance(declinedOptionalIds, projected);
                }
              }}
            />
            {requiredDone && optionalOpen.length > 0 && (
              <button
                type="button"
                data-testid="focus-strip-end-movement"
                onClick={() => {
                  const next = new Set(declinedOptionalIds);
                  next.add(activeOriginalKey);
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
          rehab: isRehabGroup,
        }}
        onSwapped={(next) => {
          setSwapped((previous) => ({
            ...previous,
            [activeOriginalKey]: next,
          }));
          setSwapOpen(false);
          router.refresh();
        }}
      />
    </section>
  );
}
