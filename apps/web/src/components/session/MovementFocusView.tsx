"use client";

/**
 * Focus view for one prescribed movement card. Owns the dot strip,
 * the steppers, the save submit, PR-flash UI, and the auto/manual
 * cursor model. Pure UI — the parent `<MovementCard>` supplies the
 * logged-set data, prior bests, and the server action to call.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PrescriptionItem } from "@hta/db";
import { NumberEntryInput } from "./NumberEntryInput";
import type { SkipReason } from "@/lib/sessions/skip-reasons";
import {
  autoCursorForGroup,
  bucketForKind,
  bucketPositionForSlot,
  effectiveCursor,
  bucketLabelForKind,
  isMovementFullyCovered,
  movementGroupKey,
  pinnedCursorForGroup,
  roundToPlate,
  type MovementGroup,
} from "@/lib/sessions/movement-grouping";
import { detectTmAnchoredPr } from "@/lib/engine/tm-anchored-pr";
import { restSecondsForSet } from "@/lib/sessions/rest";
import { shouldFireOnSaved } from "@/lib/sessions/focus-advance";
import { resolveBarWeightKg } from "@/lib/sessions/bar-kind";
import { resolveLoadIncrement } from "@/lib/sessions/load-increment";
import { roundWarmupLoadKg } from "@/lib/planner/warmups";
import {
  resolvePrescriptionSetWork,
  resolvePrescribedSnapshot,
  resolveTargetLoadKg,
  isRehabItem,
} from "@hta/domain";
import { SET_KIND_TO_LOG as SHARED_SET_KIND_TO_LOG } from "@/lib/sessions/set-kind";
import { hapticTick } from "@/lib/feedback";
import { useUnits } from "@/lib/units/context";
import {
  type WeightUnit,
  displayWeight,
  roundDisplayWeight,
  toKg,
  weightUnitLabel,
  weightStepDisplay,
  stepWeightKg,
  formatWeight,
} from "@/lib/stats/units";
import { RestTimer } from "./RestTimer";
import { SessionDock } from "./SessionDock";
import { deleteSet } from "@/lib/sessions/actions";
import {
  draftAppliesTo,
  readResume,
  remainingRestSeconds,
  writeResume,
} from "@/lib/sessions/session-resume";
import { RpeZonePicker } from "./RpeZonePicker";
import { SkipSetMenu } from "./SkipSetMenu";
import { PlateView } from "./PlateView";
import type { PlateInventoryItem } from "./plate-math";

export type FocusLoggedSet = {
  id: string;
  /** Stored attribution can differ after a forward-only movement swap. */
  movementId?: string;
  weightKg: number | null;
  reps: number | null;
  /** Distance in metres for loaded-carry sets (set_logs.distance_m). */
  distanceM?: number | null;
  /** Hold duration in seconds for isometric sets (set_logs.duration_sec). */
  durationSec?: number | null;
  rpe: number | null;
  skipped?: boolean;
  skipReason?: SkipReason | null;
};

export type FocusViewProps = {
  sessionId: string;
  group: MovementGroup;
  tmKg: number | undefined;
  /**
   * The lifter's bodyweight (kg). Required to resolve a load for a movement
   * whose max includes bodyweight — see `isSystemLoad`.
   */
  bodyweightKg?: number | undefined;
  /**
   * True when this movement's max counts bodyweight plus belt (weighted
   * pull-ups / dips), so a percentage of it is a total and the prescribed load
   * is that total minus bodyweight.
   */
  isSystemLoad?: boolean;
  /** Saved 1RM from training_maxes.one_rm_kg. Drives TM-anchored PR flash. */
  oneRmKg: number | undefined;
  loggedItemIndices: ReadonlySet<number>;
  /** Subset of loggedItemIndices that were skipped (for dot-strip render). */
  skippedItemIndices?: ReadonlySet<number>;
  /** Canonical logged set per matched item index (used for the edit link). */
  loggedSetIdByItemIndex: Readonly<Record<number, string>>;
  /** All logged sets for this movement, in order. Used for prior-best fallback. */
  loggedSets: FocusLoggedSet[];
  /** Pre-existing PR snapshot used for the inline PR badges. */
  priorBest: { heaviestWeight: number | null; bestE1rm: number | null } | undefined;
  /**
   * Prior-session top set for this movement. Seeds the load when the
   * prescription carries no target (typical for accessories), so the stepper
   * opens at a usable number instead of 0 — reaching a 135 kg leg press from
   * zero was 27 taps, which pushed users into the keyboard.
   */
  lastSetHint?: { weightKg: number; reps: number; performedAt: string } | null;
  addStrengthSet: (fd: FormData) => Promise<{
    error?: string;
    ok?: true;
    /**
     * The persisted row. Present once the write resolves online; absent when
     * the set was queued offline (there is no server row to act on yet), which
     * is why Undo only appears when an id came back.
     */
    set?: { id: string };
  }>;
  updateStrengthSet?: (
    fd: FormData,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
  /**
   * Lifter's opt-out for the inter-set countdown. Gates both starting a rest
   * and restoring a persisted one after a reload.
   */
  restTimerEnabled: boolean;
  /**
   * Phase 4 — per-BW-family gate state, keyed by family. Surfaced
   * inside the "Next:" popover beneath each BW main-lift's headline.
   * Optional — when missing, the popover collapses to the prescription
   * preview without the live counters.
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
   * Equipment — fed in by the parent card from the user's profile so
   * the plate-per-side breakdown can subtract the correct bar weight
   * and walk a real inventory. When `plateInventory` is empty the
   * focus view renders a "Set up plate inventory →" link instead of
   * the breakdown.
   *
   * These are the RAW stored values: `barbellKg === 0` and a missing /
   * null `trapBarKg` / `safetyBarKg` mean "the user owns no such bar".
   * Never default them to 20 / 25 here — `resolveBarWeightKg` owns that
   * decision and the server-side warm-up materialisation reads the same
   * signal, so a default applied here would silently disagree with the
   * persisted `set_logs.weight_kg`.
   */
  barbellKg?: number | null;
  trapBarKg?: number | null;
  safetyBarKg?: number | null;
  plateInventory?: PlateInventoryItem[];
  preferStandardLbPlates?: boolean;
  /**
   * The catalog `movements.equipment` tag for this movement, when the
   * parent has it. Feeds `resolveLoadIncrement` so a dumbbell movement
   * steps by 1 kg instead of the 2.5 kg plate default. Omitted ⇒ the
   * increment falls back to the slug heuristic.
   */
  equipmentTag?: string | null;
  /**
   * Optional manual cursor pinned by the parent — e.g. clicking
   * "Edit sets" on a recap-row opens the focus view at the last
   * logged slot. Null means "let the auto cursor decide".
   */
  initialCursor?: number | null;
  /** Called after a successful save so the parent can run auto-collapse logic. */
  onSaved?: (info: {
    /**
     * Every prescription item this save covered. Usually one; "skip remaining
     * sets" covers many at once, and reporting only the cursor slot left the
     * parent believing the rest were still open — which stranded the lifter on
     * a circuit member whose next-open lookup kept pointing back at itself.
     */
    coveredIndices: readonly number[];
  }) => void;
  /**
   * True when the movement is bodyweight-capable (`body_weight_loaded`):
   * pull-ups, dips, inverted rows, push-ups, etc. For these the weight field
   * is OPTIONAL added load — logging at 0 kg (pure bodyweight) is valid — so
   * the default-kind validation no longer demands a weight.
   */
  bodyweightCapable?: boolean;
  /** Compact hierarchy used by the single-movement Focus Strip logger. */
  focusStrip?: boolean;
  /**
   * True once the focus strip's one-shot resume application (see
   * `FocusStripLogger`) has run — whether or not it changed anything.
   * `undefined`/omitted defaults to ready (non-focus-strip callers, e.g.
   * `MovementCard`, never gate on resume at all: their own `focusStrip` is
   * unset and the restore/persist effects below already no-op for them).
   *
   * Gates this component's OWN resume restoration (cursor/draft/rest) and
   * its draft-persistence effect. Without this gate, a focus-strip remount
   * on the SSR-safe `firstOpenId` fallback would restore/persist against
   * the WRONG (first-open) movement in the brief window before the parent's
   * effect corrects `activeId` to the actually-resumed one — overwriting the
   * resume snapshot before it can ever be read for the right movement.
   */
  resumeReady?: boolean;
  /**
   * Rendered beside the primary action inside the session dock (the focus
   * strip passes its movement-navigator trigger here). Only used when
   * `focusStrip` is set — the inline card layout has no dock.
   */
  dockAccessory?: React.ReactNode;
  /** Superset A1 advances immediately; its A2 partner owns the shared rest. */
  /**
   * Decides whether saving a given prescription item should SKIP the rest
   * timer — used for linked supersets, where you move straight to the next
   * station and rest once at the end of the round.
   *
   * A predicate rather than a boolean on purpose: the slot being saved is this
   * component's own cursor, which can be pinned by the user or by the parent,
   * so it is not always the "next open" slot the parent would guess. Passing
   * the decision down lets it be made against the index actually being logged.
   */
  suppressRestForItemIndex?: (itemIndex: number) => boolean;
  /**
   * Called when the lifter cancels an edit on a movement that has nothing left
   * to log. Without it Cancel leaves them parked on the set they just declined
   * to change, which reads as "Cancel did nothing".
   */
  onExitEdit?: () => void;
};

const SET_KIND_TO_LOG: Record<string, "warmup" | "main" | "back_off" | "accessory" | "tendon"> =
  SHARED_SET_KIND_TO_LOG;

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
  bodyweightKg,
  isSystemLoad = false,
  oneRmKg,
  loggedItemIndices,
  skippedItemIndices,
  loggedSetIdByItemIndex,
  loggedSets,
  priorBest,
  lastSetHint = null,
  addStrengthSet,
  updateStrengthSet,
  hapticsEnabled,
  timerSoundEnabled,
  restTimerEnabled,
  barbellKg,
  trapBarKg,
  safetyBarKg,
  plateInventory,
  preferStandardLbPlates = true,
  equipmentTag,
  initialCursor = null,
  onSaved,
  bwGateStateByFamily,
  bodyweightCapable = false,
  focusStrip = false,
  resumeReady = true,
  dockAccessory = null,
  suppressRestForItemIndex,
  onExitEdit,
}: FocusViewProps) {
  const router = useRouter();
  const units = useUnits();
  const unitLabel = weightUnitLabel(units);
  // priorBest is no longer consumed for PR detection — the flash is now
  // anchored to the saved 1RM (see lib/engine/tm-anchored-pr.ts). The
  // prop is preserved on the public type to keep the parent prop chain
  // intact (the server still computes priorBests for other consumers).
  void priorBest;
  const totalSlots = group.itemIndices.length;
  const groupKey = movementGroupKey(group);
  const autoCursor = useMemo(
    () => autoCursorForGroup(group, loggedItemIndices),
    [group, loggedItemIndices],
  );
  // The manual cursor is pinned to the movement it was picked on. The focus
  // strip reuses ONE instance of this component for every movement in the
  // session, so a bare slot number leaks across movements: pin slot 4 while
  // editing a 5-set lift, tap a 3-set lift, and slot 4 resolves to no
  // prescription item — the card renders its header and nothing else. Scoping
  // the pin makes a different movement fall back to its own auto cursor.
  // Editing is an INTENT, not a position.
  //
  // It used to be derived purely from "the cursor is sitting on a logged set",
  // which made it both un-enterable-on-purpose and un-exitable:
  //   - landing on a fully-logged movement auto-opened edit mode, so the card
  //     appeared to enter it by itself; and
  //   - Cancel cleared the manual pin, the auto cursor fell back to the last
  //     slot (`autoCursorForGroup` returns `length - 1` once everything is
  //     logged), that slot is logged, and edit mode re-derived instantly. Cancel
  //     and Update both looked completely dead, and the only escape was leaving
  //     the session.
  // Holding the intent explicitly means Cancel has something to actually clear.
  const [editIntent, setEditIntent] = useState<{
    key: string;
    slot: number;
  } | null>(null);
  const isSlotLogged = (slot: number) => {
    const index = group.itemIndices[slot];
    return index != null && loggedItemIndices.has(index);
  };
  const beginEditIfLogged = (slot: number) => {
    setEditIntent(isSlotLogged(slot) ? { key: groupKey, slot } : null);
  };
  const [manualPin, setManualPin] = useState<{ key: string; slot: number } | null>(
    initialCursor != null ? { key: groupKey, slot: initialCursor } : null,
  );
  // Adopt parent-pinned cursor changes (e.g. user taps "Edit sets" on
  // a different completed card). We do NOT clear back to null when
  // the parent passes null — `setManualPin(null)` after a save is
  // already the path that hands control back to the auto cursor.
  useEffect(() => {
    if (initialCursor == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror parent-pinned cursor into local state
    setManualPin({ key: groupKey, slot: initialCursor });
    // A parent pin that lands on a logged set IS an edit request ("Edit sets"
    // on a completed card), so it carries the intent with it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same parent-driven mirror
    setEditIntent(
      isSlotLogged(initialCursor) ? { key: groupKey, slot: initialCursor } : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isSlotLogged is derived from props read here
  }, [groupKey, initialCursor]);
  const manualCursor = pinnedCursorForGroup(manualPin, groupKey);
  const cursor = effectiveCursor(autoCursor, manualCursor, totalSlots);

  const activeItem = group.items[cursor];
  const activeItemIndex = group.itemIndices[cursor]!;
  const isActiveLogged = loggedItemIndices.has(activeItemIndex);
  const isActiveSkipped = skippedItemIndices?.has(activeItemIndex) ?? false;
  const loggedSetId = loggedSetIdByItemIndex[activeItemIndex];
  const activeLoggedSet = isActiveLogged
    ? loggedSets.find((set) => set.id === loggedSetId)
    : undefined;
  const pendingSetSync = isActiveLogged && loggedSetId == null;
  // Nothing left to log here — every slot is covered, optional included.
  // Cancelling an edit in this state has nowhere useful to put the cursor, so
  // the parent is asked to move on instead. Where to move on TO is the
  // parent's call: `lib/sessions/focus-advance`.
  const allSlotsCovered = isMovementFullyCovered(group, loggedItemIndices);
  const loggedBeforeSwap =
    activeLoggedSet?.movementId != null &&
    activeLoggedSet.movementId !== group.movementId;
  const isWarmup = activeItem?.kind === "warmup";  const isRehab = isRehabItem(activeItem);
  // How big is one tap of the ± weight stepper? Bar work moves in plate
  // pairs (2.5 kg); a dumbbell rack moves in 1 kg. Single home:
  // `lib/sessions/load-increment.ts`.
  const weightStep = useMemo(
    () => resolveLoadIncrement({ slug: group.movementSlug, equipment: equipmentTag }),
    [equipmentTag, group.movementSlug],
  );
  // Position of the active slot within its own kind-bucket
  // (warmup / working / accessory). Drives the "Set X of Y" caption
  // so warm-ups don't inflate the working-set count.
  const bucketSlot = useMemo(
    () => bucketPositionForSlot(group, cursor),
    [group, cursor],
  );
  const displaySlot = useMemo(() => {
    if (!activeItem?.optional) return bucketSlot;
    const optionalSlots = group.items
      .map((item, slot) => (item.optional ? slot : -1))
      .filter((slot) => slot >= 0);
    return {
      bucket: bucketSlot.bucket,
      position: Math.max(0, optionalSlots.indexOf(cursor)),
      total: optionalSlots.length,
    };
  }, [activeItem?.optional, bucketSlot, cursor, group.items]);

  // AMRAP detection. Platform programs (5/3/1, Tactical Barbell, …) always mark
  // an AMRAP set explicitly via `isAmrap`, so we trust that flag alone. (The old
  // positional "last main set is an open AMRAP" fallback mis-fired for straight-
  // set programs like Tactical Barbell and fixed-5s, showing a bogus "5 reps+".)
  const isAmrap = activeItem?.isAmrap === true;

  // Canonical bar mass for this movement — null when the movement isn't
  // barbell-loaded OR the user owns no such bar. Shared with the server
  // (`fillSessionFromPlan`) so the displayed warm-up load and the
  // persisted one always agree.
  const barWeightKg = useMemo(
    () => resolveBarWeightKg(group.movementSlug, { barbellKg, trapBarKg, safetyBarKg }),
    [barbellKg, group.movementSlug, trapBarKg, safetyBarKg],
  );

  const warmupLoadOptions = useMemo(
    () => ({
      barWeightKg: barWeightKg ?? undefined,
      availablePlateWeightsKg: plateInventory?.map((plate) => plate.weightKg) ?? [],
    }),
    [barWeightKg, plateInventory],
  );

  const targetWeightForItem = useCallback(
    (item: PrescriptionItem): number | null => {
      const systemLoad = isSystemLoad || item.systemLoad === true;
      const roundKg = (kg: number) =>
        item.kind === "warmup" ? roundWarmupLoadKg(kg, warmupLoadOptions) : roundToPlate(kg);
      return resolveTargetLoadKg(item, {
        tmKg: tmKg ?? null,
        ...(systemLoad ? { isSystemLoad: true } : {}),
        bodyweightKg: bodyweightKg ?? null,
        roundKg,
        roundAbsoluteKg: roundKg,
      });
    },
    [bodyweightKg, isSystemLoad, tmKg, warmupLoadOptions],
  );

  // Target weight / reps derived from the prescription + TM.
  // Resolution order, most to least authoritative:
  //   1. the prescription (percent-of-TM or an absolute target)
  //   2. the last set logged for this movement THIS session
  //   3. the prior session's top set for this movement
  //   4. 0 — genuinely unknown, the user types it
  // Step 3 is what stops an unprescribed accessory from opening at 0 kg.
  const seededFromLastSession = useMemo(() => {
    if (!lastSetHint) return null;
    return lastSetHint.weightKg > 0 ? lastSetHint.weightKg : null;
  }, [lastSetHint]);

  const targetWeight = useMemo(() => {
    if (!activeItem) return 0;
    const prescribedWeight = targetWeightForItem(activeItem);
    if (prescribedWeight != null) return prescribedWeight;
    // Fall back to the most recent logged weight attributed to this movement.
    // A forward-only swap can include an older movement's row for inline review;
    // that historical load must not seed the replacement movement.
    const thisSession = loggedSets.findLast(
      (set) => set.movementId == null || set.movementId === group.movementId,
    )?.weightKg;
    if (thisSession != null && thisSession > 0) return thisSession;
    return seededFromLastSession ?? 0;
  }, [
    activeItem,
    group.movementId,
    loggedSets,
    seededFromLastSession,
    targetWeightForItem,
  ]);

  /**
   * True when nothing in the prescription set this load — the number on
   * screen came from the user's own history. Surfaced so the card says so
   * instead of presenting a remembered load as a prescribed target.
   */
  const loadFromHistory =
    activeItem != null &&
    targetWeightForItem(activeItem) == null &&
    targetWeight > 0;
  const warmupFloorWarning = useMemo(() => {
    if (activeItem?.kind !== "warmup") return null;
    const rawKg =
      activeItem.percentTm != null && tmKg
        ? (tmKg * activeItem.percentTm) / 100
        : activeItem.targetWeightKg != null && activeItem.targetWeightKg > 0
          ? activeItem.targetWeightKg
          : null;
    if (rawKg == null || barWeightKg == null || rawKg >= barWeightKg) {
      return null;
    }
    // `formatWeight` already appends the unit label — appending
    // `unitLabel` again rendered "Raised to the 20 kg kg bar minimum".
    return `Raised to the ${formatWeight(barWeightKg, units)} bar minimum`;
  }, [activeItem, barWeightKg, tmKg, units]);
  const targetWork = useMemo(
    () => resolvePrescriptionSetWork(activeItem),
    [activeItem],
  );
  const targetReps = targetWork.reps ?? 5;
  // Detect kind from prescription fields. `distanceM` = loaded carry
  // (programmed by metres, McGill 2014); `holdSec` = isometric hold.
  // `bw` = bodyweight Phase 3 prescription (reps OR isometric hold;
  // hides the weight column because no TM anchors a load).
  // Legacy items that don't carry these fields stay on the default
  // weight + reps grid.
  const isBwItem = !!activeItem?.bw && tmKg == null;
  const isBwHold =
    isBwItem && activeItem?.bw?.prescriptionType === "isometric_hold";
  const itemKind: "carry" | "isometric" | "bw_reps" | "default" = activeItem?.distanceM
    ? "carry"
    : activeItem?.holdSec || isBwHold
      ? "isometric"
      : isBwItem
        ? "bw_reps"
        : "default";
  const targetDistance = targetWork.distanceM ?? 0;
  const targetDuration = targetWork.durationSec ?? 0;

  // Stepper state. We snap defaults back to target whenever the cursor
  // moves so the user always starts at the prescription.
  const initialLoggedSet =
    activeLoggedSet && !activeLoggedSet.skipped
      ? activeLoggedSet
      : undefined;
  const [weight, setWeight] = useState<number>(
    initialLoggedSet?.weightKg ?? targetWeight,
  );
  const [reps, setReps] = useState<number>(
    initialLoggedSet?.reps != null && initialLoggedSet.reps > 0
      ? initialLoggedSet.reps
      : targetReps,
  );
  const [distanceM, setDistanceM] = useState<number>(
    initialLoggedSet?.distanceM ?? targetDistance,
  );
  const [durationSec, setDurationSec] = useState<number>(
    initialLoggedSet?.durationSec ?? targetDuration,
  );
  // Phase 7 — actual external load applied (vest / belt / ankle / band
  // assist). Mirrors the planner's suggested `bw.externalLoadKg` by
  // default; user can override via the ±2.5 kg stepper. Negative for
  // band-assist.
  const targetExternalLoad = activeItem?.bw?.externalLoadKg ?? 0;
  const [externalLoadKg, setExternalLoadKg] = useState<number>(targetExternalLoad);
  const [rpe, setRpe] = useState<number | null>(
    initialLoggedSet?.rpe ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  // Logging is now optimistic (the parent overlays the set instantly), so there
  // is no blocking "submitting" window — the CTA never shows a "Logging…" spin.
  // Kept as a const-false so the existing label / disabled reads still compile.
  const submitting = false;
  // Re-entrancy guard: a fast double-tap could fire two writes for the same
  // slot before the optimistic overlay re-renders and advances the cursor.
  // Track which prescription indices we've already fired this session so a
  // repeat tap on the same slot is a no-op (cleared on write error to retry).
  const firedIndicesRef = useRef<Set<number>>(new Set());
  // "Latest ref" for the stale-navigation guard (defect #2 follow-up): this
  // component instance is reused across every movement in the strip (see the
  // `onSaved` comment below), so `groupKey` is whatever movement is CURRENTLY
  // displayed — kept in sync by the effect below, including renders that
  // happen while an earlier `handleSubmit` call is still awaiting the
  // server. Comparing a submit's captured `groupKey` against this ref's
  // value once that submit resolves tells us whether the lifter has since
  // navigated elsewhere. A ref write belongs in an effect, not render body
  // (React forbids the latter), so this runs post-commit on every
  // `groupKey` change rather than being assigned directly during render.
  const currentGroupKeyRef = useRef(groupKey);
  useEffect(() => {
    currentGroupKeyRef.current = groupKey;
  }, [groupKey]);
  const [prFlash, setPrFlash] = useState<PrFlash | null>(null);
  const [justLoggedAt, setJustLoggedAt] = useState<number | null>(null);
  const [restSeconds, setRestSeconds] = useState(0);
  const [restToken, setRestToken] = useState(0);
  /**
   * The set just written, offered for one-tap removal.
   *
   * Logging is optimistic and the CTA is now a big docked target, which makes
   * a mis-tap both easier and more consequential. A short-lived Undo is the
   * cheap counterweight — cheaper than a confirmation dialog, which would tax
   * every correct log to guard against the rare wrong one.
   */
  const [undo, setUndo] = useState<{
    setId: string;
    itemIndex: number;
    summary: string;
    at: number;
  } | null>(null);
  const [undoing, setUndoing] = useState(false);
  // Absolute epoch-ms the current rest ends at. Persisted so a reload or a
  // process eviction resumes the SAME countdown instead of restarting it.
  const restDeadlineRef = useRef<number | null>(null);

  // Undo is deliberately short-lived: it's for "that was the wrong button",
  // not for revising a set five minutes later (that's what editing is for).
  useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(id);
  }, [undo]);

  const runUndo = async () => {
    if (!undo || undoing) return;
    setUndoing(true);
    try {
      const fd = new FormData();
      fd.set("id", undo.setId);
      fd.set("sessionId", sessionId);
      await deleteSet(fd);
      // Let the slot be logged again — the re-entrancy guard would otherwise
      // treat the retry as a duplicate and silently drop it.
      firedIndicesRef.current.delete(undo.itemIndex);
      setManualPin({ key: groupKey, slot: cursor });
      setRestSeconds(0);
      restDeadlineRef.current = null;
      setUndo(null);
      hapticTick(hapticsEnabled);
      router.refresh();
    } catch {
      setError("Couldn't undo that set — it's still logged.");
    } finally {
      setUndoing(false);
    }
  };
  const [justLogged, setJustLogged] = useState(false);
  const [skipMenuOpen, setSkipMenuOpen] = useState(false);
  const [skipScope, setSkipScope] = useState<"set" | "movement">("set");
  const [skipPending, setSkipPending] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  useEffect(() => {
    if (justLoggedAt == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror the just-logged flag locally so the PR flash can self-clear
    setJustLogged(true);
    const id = window.setTimeout(() => setJustLogged(false), 1500);
    return () => window.clearTimeout(id);
  }, [justLoggedAt]);

  // ── Interruption recovery ────────────────────────────────────────────────
  // Restore the slot, the unsaved numbers and the remaining rest exactly once
  // on mount. Only applies when the stored draft belongs to THIS movement and
  // slot — see `draftAppliesTo`.
  //
  // Gated on `resumeReady`: the focus strip mounts on the SSR-safe
  // `firstOpenId` fallback first, then corrects `activeId` (and `group`,
  // hence `groupKey`) to the actually-resumed movement in the SAME render as
  // `resumeReady` flipping true. Firing this restore before that correction
  // would read `readResume` against the WRONG `groupKey` (first-open, not
  // resumed) and — because this component instance is reused across every
  // movement rather than remounted — burn its one-shot guard without ever
  // restoring the resumed movement's draft.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !focusStrip || !resumeReady) return;
    restoredRef.current = true;
    const saved = readResume(sessionId);
    if (!saved) return;
    const now = Date.now();
    const restLeft = remainingRestSeconds(saved.restDeadlineMs, now);
    // A persisted deadline outlives the preference, so a lifter who turned the
    // countdown off must not have one restored under them by a reload.
    if (restTimerEnabled && restLeft > 0) {
      restDeadlineRef.current = saved.restDeadlineMs ?? null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore of persisted resume state
      setRestSeconds(restLeft);
      setRestToken((t) => t + 1);
    }
    if (saved.cursor != null && saved.activeKey === groupKey) {
      setManualPin({ key: groupKey, slot: saved.cursor });
      if (draftAppliesTo(saved, groupKey, saved.cursor) && saved.draft) {
        const d = saved.draft;
        if (d.weightKg != null) setWeight(d.weightKg);
        if (d.reps != null) setReps(d.reps);
        if (d.rpe !== undefined) setRpe(d.rpe);
        if (d.distanceM != null) setDistanceM(d.distanceM);
        if (d.durationSec != null) setDurationSec(d.durationSec);
        if (d.externalLoadKg != null) setExternalLoadKg(d.externalLoadKg);
      }
    }
    // Depends on `resumeReady` (NOT mount-only) because the very first
    // invocation, before the focus strip's own one-shot resume application
    // has run, must return early WITHOUT setting `restoredRef.current` — see
    // the comment above. Once `resumeReady` flips true this body runs
    // exactly once (the ref guard) against the now-correct `groupKey`;
    // re-running on later `groupKey`/state changes would fight the lifter's
    // live edits, which is what the ref guard prevents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeReady]);

  // Persist the working state. Cheap (one small localStorage write) and
  // throttled by React's render cadence rather than a timer.
  //
  // Gated on `resumeReady` for the same reason as the restore effect above:
  // the focus strip's first render (before its one-shot resume application
  // has run) is mounted on the SSR-safe `firstOpenId` fallback, not
  // necessarily the resumed movement. Persisting on that render would
  // overwrite the real resume snapshot (pointing at a different movement)
  // with `firstOpenId`'s blank/default draft before it can ever be restored.
  useEffect(() => {
    if (!focusStrip || !resumeReady) return;
    writeResume({
      sessionId,
      activeKey: groupKey,
      cursor,
      draftKey: groupKey,
      draft: {
        weightKg: weight,
        reps,
        rpe,
        distanceM,
        durationSec,
        externalLoadKg,
      },
      // Never persist a deadline the lifter has opted out of — a resume
      // snapshot outlives the preference, and restoring one would put a
      // countdown back on screen that they turned off.
      restDeadlineMs: restTimerEnabled
        ? (restDeadlineRef.current ?? undefined)
        : undefined,
      restLabel: group.movementName,
    });
  }, [
    focusStrip,
    resumeReady,
    sessionId,
    groupKey,
    cursor,
    weight,
    reps,
    rpe,
    distanceM,
    durationSec,
    externalLoadKg,
    group.movementName,
    restSeconds,
    restTimerEnabled,
  ]);

  // Snap weight/reps to the target whenever the active slot changes.
  // Also reset RPE + close the skip menu so each set starts clean.
  const cursorKey = `${group.groupKey ?? group.movementId}:${cursor}:${
    isActiveLogged ? "done" : "open"
  }`;
  const lastCursorKey = useRef(cursorKey);
  useEffect(() => {
    if (lastCursorKey.current === cursorKey) return;
    lastCursorKey.current = cursorKey;
    // Pre-select RPE from an already-logged set when re-opening it,
    // otherwise clear so the picker is the empty "no zone" state.
    const existing = activeLoggedSet;
    setWeight(
      existing && !existing.skipped && existing.weightKg != null
        ? existing.weightKg
        : targetWeight,
    );
    setReps(
      existing && !existing.skipped && existing.reps != null && existing.reps > 0
        ? existing.reps
        : targetReps,
    );
    setDistanceM(
      existing && !existing.skipped && existing.distanceM != null
        ? existing.distanceM
        : targetDistance,
    );
    setDurationSec(
      existing && !existing.skipped && existing.durationSec != null
        ? existing.durationSec
        : targetDuration,
    );
    setExternalLoadKg(targetExternalLoad);
    setRpe(existing?.rpe ?? null);
    setError(null);
    setSkipMenuOpen(false);
    setSkipError(null);
  }, [cursorKey, targetWeight, targetReps, targetDistance, targetDuration, targetExternalLoad, activeLoggedSet]);

  // Auto-clear PR flash after 4.5s.
  useEffect(() => {
    if (!prFlash) return;
    const id = window.setTimeout(() => setPrFlash(null), 4500);
    return () => window.clearTimeout(id);
  }, [prFlash]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeItem) return;
    const updatingExisting =
      isActiveLogged && loggedSetId != null && updateStrengthSet != null;
    if (!updatingExisting && firedIndicesRef.current.has(activeItemIndex)) return;
    // Per-kind validation. Carries log weight + distance (the rep
    // stepper is hidden); isometric holds log weight (optional) +
    // duration; everything else logs weight + reps.
    if (itemKind === "carry") {
      if (weight <= 0 || distanceM <= 0) {
        setError("Enter weight and distance before logging.");
        return;
      }
    } else if (itemKind === "isometric") {
      if (durationSec <= 0) {
        setError("Enter a hold time before logging.");
        return;
      }
    } else if (itemKind === "bw_reps") {
      // Bodyweight Phase 3 — no weight required, reps only.
      if (reps <= 0) {
        setError("Enter reps before logging.");
        return;
      }
    } else {
      // Bodyweight-capable movements (pull-up, dip, inverted row, push-up):
      // the weight field is OPTIONAL added load, so 0 kg (pure bodyweight) is a
      // valid log — only reps are required. Loaded movements still require a
      // weight so an empty stepper can't log a meaningless 0 kg set.
      if (reps <= 0) {
        setError(
          bodyweightCapable
            ? "Enter reps before logging."
            : "Enter weight and reps before logging.",
        );
        return;
      }
      if (!bodyweightCapable && weight <= 0) {
        setError("Enter weight and reps before logging.");
        return;
      }
    }
    setError(null);
    firedIndicesRef.current.add(activeItemIndex);
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("movementId", group.movementId);
    fd.set("setKind", SET_KIND_TO_LOG[activeItem.kind] ?? "main");
    fd.set("weightKg", String(weight));
    if (itemKind === "carry") {
      fd.set("reps", "0");
      fd.set("distanceM", String(distanceM));
    } else if (itemKind === "isometric") {
      fd.set("reps", "0");
      fd.set("durationSec", String(durationSec));
    } else if (itemKind === "bw_reps") {
      // Bodyweight Phase 3: no weight, reps only. weight = 0 lets the
      // logging path treat it as a non-loaded set without inventing a
      // bodyweight kg value (we don't track per-user BW snapshots yet).
      fd.set("reps", String(reps));
    } else {
      fd.set("reps", String(reps));
    }
    fd.set("prescriptionItemIndex", String(activeItemIndex));
    // ADR 0070 — the prescribed values as DISPLAYED on this card. Sent with the
    // log so the server stores what the user actually saw, rather than
    // re-deriving it later from state that may have moved (TM change, taper,
    // offline replay). `targetWeightForItem` returns null when the prescription
    // determines no load, which is exactly when nothing must be recorded: the
    // logger's last-logged-weight fallback is a UI convenience, not a plan.
    const prescribedWeight = targetWeightForItem(activeItem);
    if (prescribedWeight != null) {
      fd.set("targetWeightKg", String(prescribedWeight));
    }
    if (targetWork.reps != null) {
      fd.set("targetReps", String(targetWork.reps));
    }
    if (rpe != null && !isWarmup) {
      fd.set("rpe", String(rpe));
    }
    // Phase 7 — propagate the actual external load the user applied so
    // the per-set side effect can mirror it into clean_rep_history.
    if (itemKind === "bw_reps" && activeItem.bw?.loadSource != null) {
      fd.set("externalLoadKg", String(externalLoadKg));
      fd.set("loadSource", String(activeItem.bw.loadSource));
    }

    if (updatingExisting) {
      fd.set("id", loggedSetId);
      hapticTick(hapticsEnabled);
      setJustLoggedAt(Date.now());
      void updateStrengthSet(fd)
        .then((result) => {
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setEditIntent(null);
          setManualPin({ key: groupKey, slot: cursor });
          router.refresh();
        })
        .catch(() => {
          setError("Couldn't update that set — check your connection and retry.");
        });
      return;
    }

    // TM-anchored PR detection. The flash fires only when the new set
    // beats the user's saved 1RM (Weight / e1RM) or, in an AMRAP context,
    // exceeds the prescribed rep count (Rep PR). If `oneRmKg` is unset,
    // no PR can fire — we don't celebrate against a missing claim.
    // Carries / isometric holds don't trigger TM-anchored PRs (no rep
    // count to anchor an e1RM estimate against).
    //
    // Nor does a system-load movement: the logged weight is what hangs off the
    // belt, the saved max counts bodyweight too, and comparing the two produces
    // an e1RM that means nothing and a PR that can never fire.
    const setKindForPr = SET_KIND_TO_LOG[activeItem.kind] ?? "main";
    const flash =
      itemKind === "default" && !isSystemLoad
        ? detectTmAnchoredPr({
            weightKg: weight,
            reps,
            rpe: !isWarmup ? rpe : null,
            kind: setKindForPr,
            prescribedReps: isAmrap ? (activeItem.reps ?? null) : null,
            isTopSet: isAmrap,
            tmKg: oneRmKg ?? null,
          })
        : null;

    // Optimistic commit. The parent (`SessionWorkArea`) overlays this log
    // immediately, so the cursor advances on the very next render — we do NOT
    // await the server write before moving on. The write + revalidation settle
    // in the background; a write error rolls the overlay back and surfaces here.
    hapticTick(hapticsEnabled);
    // Reset manual cursor — auto advances when the parent rerenders with the
    // optimistic loggedItemIndices.
    setManualPin(null);
    setJustLoggedAt(Date.now());
    if (flash && (flash.isWeightPr || flash.isE1rmPr || flash.e1rmKg != null)) {
      setPrFlash(flash);
      // Celebrate a genuine PR (weight or e1RM beats the saved 1RM) with a
      // heavier, distinct haptic — the e1RM-only readout (no PR) keeps the
      // normal light log tick fired above.
      if (flash.isWeightPr || flash.isE1rmPr) hapticTick(hapticsEnabled, 120);
    }
    // Inline rest timer — skipped after the final slot of this movement (B2).
    // There is no "next set" to rest before, so a running countdown would
    // mislabel itself "next <movement>" and linger over the Finish CTA. We also
    // CLEAR any timer still running from the previous set.
    const isLastSlot = cursor >= totalSlots - 1;
    const undoSummary =
      itemKind === "carry"
        ? `${formatWeight(weight, units)} × ${distanceM} m`
        : itemKind === "isometric"
          ? isBwHold
            ? `${durationSec} s`
            : `${formatWeight(weight, units)} × ${durationSec} s`
          : itemKind === "bw_reps"
            ? `× ${reps}`
            : `${formatWeight(weight, units)} × ${reps}`;
    if (isLastSlot || suppressRestForItemIndex?.(activeItemIndex)) {
      setRestSeconds(0);
      restDeadlineRef.current = null;
    } else {
      // Full state transition. `secs === 0` — the lifter turned the countdown
      // off, or this kind never rests — must also CLEAR any countdown still
      // running from an earlier set and drop its deadline, or a stale timer
      // would keep ticking and get persisted into the resume snapshot.
      const secs = restSecondsForSet(
        SET_KIND_TO_LOG[activeItem.kind] ?? "main",
        { restTimerEnabled },
      );
      setRestSeconds(secs);
      restDeadlineRef.current = secs > 0 ? Date.now() + secs * 1000 : null;
      if (secs > 0) {
        setRestToken((t) => t + 1);
      }
    }
    // `onSaved` tells the FOCUS STRIP (the parent) that this slot is covered,
    // which can advance `activeId` to a different movement entirely once the
    // active one has no open work left. It must only fire once we know the
    // write actually landed — either a persisted server row, or a durable
    // offline-queued acceptance (`{ ok: true }` with no `error`, no `set`).
    // Firing it eagerly let a validation rejection surface its error on
    // whatever movement the strip had already advanced to, because this same
    // component instance is reused (not remounted) across the active
    // movement switch. On rejection we simply never call it, so the strip
    // never leaves the failed movement and the error renders on the slot
    // that actually failed.
    //
    // It must ALSO not fire from a stale closure: if the lifter manually
    // navigates to a different movement while this write is still in
    // flight, `groupKey` here is still the OLD movement's key. Comparing it
    // against the live `currentGroupKeyRef` (updated every render) at
    // resolution time — `shouldFireOnSaved` — lets manual navigation win;
    // the late success is still recorded (the overlay/undo state below is
    // unaffected), it just doesn't yank the lifter back to wherever this
    // stale write thinks they should go next.
    const submittedGroupKey = groupKey;
    void addStrengthSet(fd)
      .then((result) => {
        if (result?.error) {
          firedIndicesRef.current.delete(activeItemIndex);
          setError(result.error);
          setUndo(null);
          return;
        }
        if (shouldFireOnSaved(submittedGroupKey, currentGroupKeyRef.current)) {
          onSaved?.({ coveredIndices: [activeItemIndex] });
        }
        // Only offer Undo once we hold the real row id — deleting requires it,
        // and an offline-queued set has no server row to delete yet.
        if (result?.set?.id) {
          setUndo({
            setId: result.set.id,
            itemIndex: activeItemIndex,
            summary: undoSummary,
            at: Date.now(),
          });
        }
      })
      .catch(() => {
        firedIndicesRef.current.delete(activeItemIndex);
        setError("Couldn't save that set — check your connection and retry.");
        setUndo(null);
      });
  };

  if (!activeItem) return null;

  const handleSkip = async (reason: SkipReason, note: string | null) => {
    if (skipPending) return;
    setSkipPending(true);
    setSkipError(null);
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("movementId", group.movementId);
    fd.set("setKind", SET_KIND_TO_LOG[activeItem.kind] ?? "main");
    fd.set("weightKg", "0");
    fd.set("reps", "0");
    fd.set("prescriptionItemIndex", String(activeItemIndex));
    fd.set("skipped", "true");
    fd.set("skipReason", reason);
    // ADR 0070 — a skip carries its snapshot too: the deviation is exactly "the
    // whole prescribed set", which is the most informative signal for
    // autoregulation, not the least.
    const skippedWeight = targetWeightForItem(activeItem);
    if (skippedWeight != null) {
      fd.set("targetWeightKg", String(skippedWeight));
    }
    if (targetWork.reps != null) {
      fd.set("targetReps", String(targetWork.reps));
    }
    if (note) fd.set("notes", note);
    try {
      const result = await addStrengthSet(fd);
      if (result?.error) {
        setSkipError(result.error);
        return;
      }
      hapticTick(hapticsEnabled);
      setSkipMenuOpen(false);
      setManualPin(null);
      // Skipped sets must not trigger PR/e1RM toasts or the rest timer
      // — they are intentionally "no work".
      onSaved?.({ coveredIndices: [activeItemIndex] });
    } finally {
      setSkipPending(false);
    }
  };

  // Skip every remaining (unlogged) set of this movement in one go, with a
  // single reason. Targets are snapshotted up front from the slots not yet
  // covered, then each is written through the same optimistic `addStrengthSet`
  // path the per-set skip uses — so the dot strip fills in instantly. Writes
  // are sequential so the server's set_index count stays correct.
  const remainingSlots = group.itemIndices
    .map((idx, slot) => ({ idx, kind: group.items[slot]?.kind ?? "main", item: group.items[slot] }))
    .filter(({ idx }) => !loggedItemIndices.has(idx));

  const handleSkipRest = async (reason: SkipReason, note: string | null) => {
    if (skipPending) return;
    setSkipPending(true);
    setSkipError(null);
    const covered: number[] = [];
    let failed = false;
    try {
      for (const { idx, kind, item } of remainingSlots) {
        const fd = new FormData();
        fd.set("sessionId", sessionId);
        fd.set("movementId", group.movementId);
        fd.set("setKind", SET_KIND_TO_LOG[kind] ?? "main");
        fd.set("weightKg", "0");
        fd.set("reps", "0");
        fd.set("prescriptionItemIndex", String(idx));
        fd.set("skipped", "true");
        fd.set("skipReason", reason);
        // ADR 0070 — snapshot each skipped slot from its OWN item (these are
        // other sets, not the active card). Load comes from the same helper the
        // card renders with, so a warm-up slot keeps its bar-floor rounding.
        const snap = resolvePrescribedSnapshot(item, {
          setKind: SET_KIND_TO_LOG[kind] ?? "main",
        });
        const slotWeight = item ? targetWeightForItem(item) : null;
        if (slotWeight != null) {
          fd.set("targetWeightKg", String(slotWeight));
        }
        if (snap.targetReps != null) fd.set("targetReps", String(snap.targetReps));
        if (note) fd.set("notes", note);
        const result = await addStrengthSet(fd);
        if (result?.error) {
          setSkipError(result.error);
          failed = true;
          break;
        }
        // Collected as each write lands, so what the parent is told matches
        // what was actually stored. Reporting only the cursor slot left the
        // parent believing the rest were still open, and a circuit member's
        // round-major lookup then pointed back at the movement the lifter was
        // already on — nothing left to do there, and no way forward.
        covered.push(idx);
      }
      // A run that stopped part-way still reports the half that landed, so the
      // parent's coverage stays truthful — but the menu stays open, because it
      // is the only thing that renders `skipError`, and closing it would trade
      // the message for a success buzz on a movement with slots still unwritten.
      if (covered.length > 0) {
        setManualPin(null);
        onSaved?.({ coveredIndices: covered });
      }
      if (failed) return;
      hapticTick(hapticsEnabled);
      setSkipMenuOpen(false);
    } finally {
      setSkipPending(false);
    }
  };

  const ctaLabel = isActiveLogged
    ? pendingSetSync
      ? "Sync pending"
      : loggedBeforeSwap
        ? "Logged before swap"
        : isActiveSkipped
          ? "Restore set"
          : "Update set"
    : submitting
      ? "Logging…"
      : "Log set";

  /**
   * Editing an already-logged set is a distinct mode: it mutates history
   * rather than appending to it, and it must be abandonable without touching
   * the stored row. It gets its own colour (amber — not the sage "log" accent
   * and not the red "destructive" one), an explicit banner, and a Save/Cancel
   * pair. A primary button that silently relabels itself from "Log set" to
   * "Update set" is not a mode indicator.
   */
  const isEditing =
    isActiveLogged &&
    !isActiveSkipped &&
    !loggedBeforeSwap &&
    !pendingSetSync &&
    editIntent?.key === groupKey &&
    editIntent.slot === cursor;
  const cancelEdit = () => {
    // Drop the intent FIRST — clearing the pin alone hands the cursor back to
    // `autoCursorForGroup`, which parks on the last slot once the movement is
    // fully logged, so edit mode would immediately re-derive and Cancel would
    // look dead.
    setEditIntent(null);
    setManualPin(null);
    setError(null);
    setSkipMenuOpen(false);
    // Nothing is left to do on a fully-logged movement, so hand back to the
    // parent to move on rather than leaving the lifter parked on a set they
    // just declined to change. Optional sets count as something left: this
    // used to ignore them, so cancelling an edit after the third of five sets
    // walked out of the movement.
    if (allSlotsCovered) onExitEdit?.();
  };
  const editedSummary = isEditing
    ? itemKind === "carry"
      ? `${formatWeight(activeLoggedSet?.weightKg ?? 0, units)} × ${activeLoggedSet?.distanceM ?? 0} m`
      : itemKind === "isometric"
        ? `${activeLoggedSet?.durationSec ?? 0} s`
        : itemKind === "bw_reps"
          ? `× ${activeLoggedSet?.reps ?? 0}`
          : `${formatWeight(activeLoggedSet?.weightKg ?? 0, units)} × ${activeLoggedSet?.reps ?? 0}`
    : null;
  // Which slot this card is about, in words ("Working set · 2 of 3"). Shared
  // by the bucket caption and the edit banner so they can never disagree.
  const bucketLabel = activeItem
    ? bucketLabelForKind(
        activeItem.kind,
        displaySlot.position,
        displaySlot.total,
        activeItem.optional,
        activeItem.meta?.rehab === true,
      )
    : "";

  const nextSlot = cursor + 1 < totalSlots ? cursor + 1 : null;
  const nextItem = nextSlot != null ? group.items[nextSlot]! : null;
  const nextWeight = nextItem ? targetWeightForItem(nextItem) : null;
  // The dock hosts the primary action on phones. The button stays a real
  // submit button and reaches back into the form by id, so the existing
  // `onSubmit` path (and Enter-to-submit from an input) is untouched.
  const formId = `session-log-form-${groupKey}`;
  const ctaValueSuffix =
    !submitting &&
    ((itemKind === "bw_reps" && reps > 0) ||
      (itemKind === "isometric" && durationSec > 0 && (isBwHold || weight > 0)) ||
      (weight > 0 &&
        ((itemKind === "carry" && distanceM > 0) ||
          (itemKind === "isometric" && durationSec > 0) ||
          (itemKind === "default" && reps > 0)))) ? (
      <>
        {" · "}
        <span className="mono">
          {itemKind === "carry"
            ? `${formatWeight(weight, units)} × ${distanceM} m`
            : itemKind === "isometric"
              ? isBwHold
                ? `${durationSec} s`
                : `${formatWeight(weight, units)} × ${durationSec} s`
              : itemKind === "bw_reps"
                ? `× ${reps}`
                : `${formatWeight(weight, units)} × ${reps}`}
        </span>
      </>
    ) : null;

  const logButton = (
    <button
      type="submit"
      form={formId}
      className={`cp-btn primary${focusStrip ? " cp-dock-cta" : ""}${
        isEditing ? " cp-dock-cta--editing" : ""
      }`}
      disabled={submitting || pendingSetSync || loggedBeforeSwap}
      data-testid="movement-focus-log-button"
    >
      {ctaLabel}
      {ctaValueSuffix}
    </button>
  );

  // In edit mode the dock swaps the navigator trigger for an explicit Cancel:
  // the escape hatch has to be exactly as reachable as the commit.
  const dockCancelButton = (
    <button
      type="button"
      className="cp-btn cp-dock-accessory"
      data-testid="movement-focus-cancel-edit-dock"
      onClick={cancelEdit}
      style={{ minWidth: 92, fontSize: 15, fontWeight: 650 }}
    >
      Cancel
    </button>
  );

  const restTimerNode =
    restSeconds > 0 ? (
      <RestTimer
        key={restToken}
        seconds={restSeconds}
        defaultSeconds={restSeconds}
        onDone={() => setRestSeconds(0)}
        hapticsEnabled={hapticsEnabled}
        timerSoundEnabled={timerSoundEnabled}
        movementName={group.movementName}
        inline={focusStrip}
      />
    ) : null;

  return (
    <div
      data-testid="movement-focus-view"
      style={{
        display: "grid",
        gap: focusStrip ? 10 : 14,
        // On wide screens the focus card otherwise stretches to ~900px and
        // makes the weight/buttons look oversized. Cap at a comfortable
        // mobile-equivalent width and center.
        maxWidth: 520,
        marginLeft: "auto",
        marginRight: "auto",
        width: "100%",
      }}
    >
      {!focusStrip && restTimerNode}

      {isEditing && (
        <div
          data-testid="movement-focus-edit-banner"
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 11,
            border: "1px solid var(--cp-warning)",
            background: "color-mix(in oklab, var(--cp-warning) 14%, transparent)",
            textAlign: "left",
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
            ✎
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.35 }}>
            <span
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 750,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color: "var(--cp-warning)",
              }}
            >
              Editing a logged set
            </span>
            <span style={{ color: "var(--cp-text-soft)" }}>
              {bucketLabel} — you logged{" "}
              <span className="mono" style={{ color: "var(--cp-text)" }}>
                {editedSummary}
              </span>
            </span>
          </span>
          <button
            type="button"
            className="cp-btn"
            data-testid="movement-focus-cancel-edit"
            onClick={cancelEdit}
            style={{ flex: "0 0 auto", minHeight: 44, padding: "0 12px", fontSize: 13 }}
          >
            Cancel
          </button>
        </div>
      )}

      <DotStrip
        group={group}
        loggedItemIndices={loggedItemIndices}
        skippedItemIndices={skippedItemIndices}
        cursor={cursor}
        onPickSlot={(i) => {
          setManualPin({ key: groupKey, slot: i });
          beginEditIfLogged(i);
        }}
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
        {activeItem.optional ? "Optional set" : "Set"} {displaySlot.position + 1} of{" "}
        {displaySlot.total}
      </div>

      <div
        className="cp-card"
        data-testid="movement-focus-card"
        data-just-logged={justLogged ? "true" : "false"}
        data-editing={isEditing ? "true" : "false"}
        style={{
          padding: focusStrip ? 16 : 18,
          display: "grid",
          gap: 10,
          textAlign: "center",
          borderColor: isEditing
            ? "var(--cp-warning)"
            : justLogged
              ? "color-mix(in oklab, var(--cp-success) 60%, var(--cp-border))"
              : "var(--cp-border)",
          boxShadow: isEditing
            ? "0 0 0 1px var(--cp-warning), 0 0 28px -10px var(--cp-warning)"
            : undefined,
          background: isEditing
            ? "color-mix(in oklab, var(--cp-warning) 7%, var(--cp-surface-soft))"
            : justLogged
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
          <span>{bucketLabel}</span>
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
              {activeItem.percentTm}% {tmKg != null && oneRmKg != null && Math.abs(tmKg - oneRmKg) < 0.001 ? "1RM" : "TM"}
            </span>
          )}
          {activeItem.percentTm != null && activeItem.targetRir && (
            <span
              className="mono"
              data-testid="main-intensity-chip"
              style={{
                padding: "1px 6px",
                borderRadius: 999,
                background: "var(--cp-accent-soft)",
                color: "var(--cp-accent)",
                fontSize: 10,
              }}
            >
              {activeItem.targetRir.min === activeItem.targetRir.max
                ? `RIR ${activeItem.targetRir.min}`
                : `RIR ${activeItem.targetRir.min}–${activeItem.targetRir.max}`}
            </span>
          )}
          {activeItem.percentTm == null &&
            renderIntensityChip(activeItem) && (
              <span
                className="mono"
                data-testid="accessory-intensity-chip"
                style={{
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: "var(--cp-accent-soft)",
                  color: "var(--cp-accent)",
                  fontSize: 10,
                }}
              >
                {renderIntensityChip(activeItem)}
              </span>
            )}
        </div>
        {isBwItem ? (
          <div
            className="mono"
            data-testid="bw-prescription-headline"
            style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}
          >
            {renderBwHeadline(activeItem, units)}
          </div>
        ) : bodyweightCapable ? (
          <div
            className="mono"
            data-testid="bw-capable-headline"
            style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.05 }}
          >
            {weight > 0 ? (
              <>
                +{roundDisplayWeight(displayWeight(weight, units), units)}
                <span style={{ fontSize: 15, color: "var(--cp-text-muted)", marginLeft: 6 }}>
                  {unitLabel}
                </span>
              </>
            ) : (
              "Bodyweight"
            )}
          </div>
        ) : (
          <div
            className="mono"
            style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.05 }}
          >
            {weight > 0 ? `${roundDisplayWeight(displayWeight(weight, units), units)}` : "—"}
            <span style={{ fontSize: 15, color: "var(--cp-text-muted)", marginLeft: 6 }}>
              {unitLabel}
            </span>
          </div>
        )}
        {isBwItem && activeItem.bw && (
          <BwNextHint
            preview={activeItem.bw.nextNodePreview}
            gateState={
              activeItem.bw.family
                ? bwGateStateByFamily?.[activeItem.bw.family]
                : undefined
            }
          />
        )}
        {isBwItem && activeItem.bw?.loadSource && (
          <BwLoadControl
            bw={activeItem.bw}
            value={externalLoadKg}
            onChange={setExternalLoadKg}
            units={units}
          />
        )}
        {!isBwItem && (
          <div style={{ fontSize: 14, color: "var(--cp-text-muted)" }}>
            {renderTargetLine(activeItem, targetReps, isAmrap)}
          </div>
        )}
        {loadFromHistory && !isActiveLogged && (
          <div
            data-testid="load-from-history"
            style={{
              fontSize: 12.5,
              color: "var(--cp-text-muted)",
              lineHeight: 1.35,
            }}
          >
            No prescribed load — starting from last time
          </div>
        )}
        {warmupFloorWarning && (
          <div
            data-testid="warmup-load-floor-warning"
            role="status"
            style={{
              fontSize: 12,
              color: "var(--cp-text-muted)",
              lineHeight: 1.35,
            }}
          >
            {warmupFloorWarning}
          </div>
        )}
        {activeItem.percentTm == null && activeItem.intensityCue && (
          <div
            data-testid="accessory-intensity-cue"
            style={{
              fontSize: 12,
              color: "var(--cp-text-muted)",
              lineHeight: 1.35,
              maxWidth: 320,
              marginInline: "auto",
            }}
          >
            {activeItem.intensityCue}
          </div>
        )}
        {activeItem.percentTm != null && activeItem.intensityCue && (
          <div
            data-testid="main-intensity-cue"
            style={{
              fontSize: 12,
              color: "var(--cp-text-muted)",
              lineHeight: 1.35,
              maxWidth: 320,
              marginInline: "auto",
            }}
          >
            {activeItem.intensityCue}
          </div>
        )}
        {isBwItem && activeItem.bw?.notes && (
          <details
            data-testid="bw-prescription-notes"
            style={{
              fontSize: 12,
              color: "var(--cp-text-muted)",
              lineHeight: 1.4,
              maxWidth: 320,
              marginInline: "auto",
              textAlign: "left",
            }}
          >
            <summary
              className="cp-link"
              style={{
                fontSize: 11,
              }}
            >
              Why this prescription
            </summary>
            <div style={{ marginTop: 6 }}>{activeItem.bw.notes}</div>
          </details>
        )}

        {prFlash && (
          <div
            data-testid="pr-flash"
            className="cp-pop"
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
            {prFlash.isE1rmPr && (
              <span style={badgeStyle("var(--cp-accent)")}>⭐ e1RM PR</span>
            )}
            {prFlash.e1rmKg != null && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "var(--cp-surface)",
                  border: "1px solid var(--cp-border)",
                  color: "var(--cp-text-muted)",
                }}
              >
                e1RM {formatWeight(prFlash.e1rmKg, units)}
              </span>
            )}
          </div>
        )}
      </div>

      {(() => {
        // Plate calculator is only meaningful for main / back-off / warmup
        // sets of a barbell movement (those are the ones loaded on a bar
        // by %TM). Accessories, tendon work, cardio, and freestyle items
        // don't carry plates — hide the breakdown entirely so we don't
        // imply a bar where there isn't one.
        const itemKind = activeItem.kind;
        const isBarbellEligibleKind =
          itemKind === "main" ||
          itemKind === "back_off" ||
          itemKind === "warmup";
        if (!isBarbellEligibleKind) return null;
        // `null` covers both "not a barbell movement" and "the user owns
        // no bar for it" (travel/hotel `barbellKg: 0`, home-gym
        // `trapBarKg: null`) — either way there is no bar to subtract.
        if (barWeightKg == null) return null;
        // Additional safety: if the movement has no training max set,
        // it isn't a tracked main lift and shouldn't claim a bar.
        if (tmKg == null) return null;
        const inv = plateInventory ?? [];
        if (inv.length === 0) {
          return (
            <div
              data-testid="plate-view-empty"
              style={{
                fontSize: 11,
                color: "var(--cp-text-muted)",
                textAlign: "center",
              }}
            >
              <a
                href="/app/settings/equipment"
                className="cp-link"
              >
                Set up plate inventory →
              </a>
            </div>
          );
        }
        const plateView = (
          <div className="cp-plate-wrap">
            <PlateView
              targetWeightKg={weight}
              barWeightKg={barWeightKg}
              inventory={inv}
              units={units}
              preferStandardLbPlates={preferStandardLbPlates}
            />
          </div>
        );
        return focusStrip ? (
          <details
            data-testid="focus-strip-plates"
            style={{
              borderTop: "1px solid var(--cp-border)",
              paddingTop: 8,
              fontSize: 12,
              color: "var(--cp-text-muted)",
            }}
          >
            <summary className="cp-link" style={{ cursor: "pointer" }}>
              Plates
            </summary>
            <div style={{ marginTop: 8 }}>{plateView}</div>
          </details>
        ) : (
          plateView
        );
      })()}

      <form
        id={formId}
        onSubmit={handleSubmit}
        data-testid="session-log-form"
        style={{ display: "grid", gap: 12 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isBwItem ? "1fr" : "1fr 1fr",
            gap: 10,
          }}
        >
          {!isBwItem && (
            <Stepper
              // Remount on a slot change: the parent reloads the prescribed
              // weight for the new set, so half-typed text from the previous
              // one must not survive. Blur usually clears it, but tapping
              // "Log set" does not reliably blur on iOS.
              key={`weight-${activeItemIndex}`}
              label={bodyweightCapable ? `Added weight (${unitLabel})` : `Weight (${unitLabel})`}
              value={roundDisplayWeight(displayWeight(weight, units), units)}
              step={weightStepDisplay(units, weightStep)}
              integer={false}
              testId="stepper-weight"
              onMinus={() => setWeight((v) => stepWeightKg(v, units, -1, { step: weightStep }))}
              onPlus={() => setWeight((v) => stepWeightKg(v, units, 1, { step: weightStep }))}
              onSet={(displayVal) => setWeight(toKg(displayVal, units))}
              showStepHint={!focusStrip}
            />
          )}
          {itemKind === "carry" ? (
            <Stepper
              key={`distance-${activeItemIndex}`}
              label="Distance (m)"
              value={distanceM}
              step={5}
              integer
              testId="stepper-distance"
              onMinus={() => setDistanceM((v) => Math.max(0, v - 5))}
              onPlus={() => setDistanceM((v) => v + 5)}
              onSet={(n) => setDistanceM(Math.max(0, Math.round(n)))}
              showStepHint={!focusStrip}
            />
          ) : itemKind === "isometric" ? (
            <Stepper
              key={`duration-${activeItemIndex}`}
              label="Time (s)"
              value={durationSec}
              step={5}
              integer
              testId="stepper-duration"
              onMinus={() => setDurationSec((v) => Math.max(0, v - 5))}
              onPlus={() => setDurationSec((v) => v + 5)}
              onSet={(n) => setDurationSec(Math.max(0, Math.round(n)))}
              showStepHint={!focusStrip}
            />
          ) : (
            <Stepper
              key={`reps-${activeItemIndex}`}
              label="Reps"
              value={reps}
              step={1}
              integer
              onMinus={() => setReps((v) => Math.max(0, v - 1))}
              onPlus={() => setReps((v) => v + 1)}
              onSet={(n) => setReps(Math.max(0, Math.round(n)))}
              showStepHint={!focusStrip}
            />
          )}
        </div>

        {/* Rehab work is prescribed by protocol, not by effort — asking
            "how did it feel?" invites the user to autoregulate a load that
            is deliberately sub-maximal, and nothing downstream consumes a
            rehab RPE. Warm-ups and BW-node sets are excluded for the same
            "no meaningful effort signal" reason. */}
        {!isWarmup && !isBwItem && !isRehab && (
          <RpeZonePicker
            value={rpe}
            onChange={(next) => setRpe(next)}
            disabled={submitting}
            compact={focusStrip}
          />
        )}

        {error && (
          <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
            {error}
          </div>
        )}
        {pendingSetSync && (
          <div role="status" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
            This set is queued offline. It can be edited after it syncs.
          </div>
        )}
        {loggedBeforeSwap && (
          <div role="status" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
            This set was logged before the movement was swapped, so its original
            movement attribution is preserved.
          </div>
        )}

        <div style={{ display: "grid", gap: 8 }}>
            {!focusStrip && logButton}
            {!isActiveLogged && (
              <div style={{ display: "flex", justifyContent: "flex-start", gap: 16 }}>
                <button
                  type="button"
                  onClick={() => {
                    setSkipScope("set");
                    setSkipMenuOpen((v) => !v);
                    setSkipError(null);
                  }}
                  data-testid="movement-focus-skip-button"
                  disabled={submitting || skipPending}
                  style={{
                    all: "unset",
                    cursor: submitting || skipPending ? "default" : "pointer",
                    fontSize: 13,
                    color: "var(--cp-text-muted)",
                    textDecoration: "underline",
                    minHeight: 44,
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0 4px",
                  }}
                >
                  {skipMenuOpen && skipScope === "set" ? "Cancel skip" : "Skip set"}
                </button>
                {remainingSlots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSkipScope("movement");
                      setSkipMenuOpen((v) => !(v && skipScope === "movement"));
                      setSkipError(null);
                    }}
                    data-testid="movement-focus-skip-rest-button"
                    disabled={submitting || skipPending}
                    style={{
                      all: "unset",
                      cursor: submitting || skipPending ? "default" : "pointer",
                      fontSize: 13,
                      color: "var(--cp-text-muted)",
                      textDecoration: "underline",
                      minHeight: 44,
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "0 4px",
                    }}
                  >
                    {skipMenuOpen && skipScope === "movement"
                      ? "Cancel skip"
                      : `Skip rest (${remainingSlots.length})`}
                  </button>
                )}
              </div>
            )}
          </div>

        {skipMenuOpen && !isActiveLogged && (
          <SkipSetMenu
            onConfirm={skipScope === "movement" ? handleSkipRest : handleSkip}
            prompt={
              skipScope === "movement"
                ? `Why skip the rest of this movement? (${remainingSlots.length} sets)`
                : "Why skip this set?"
            }
            onCancel={() => {
              setSkipMenuOpen(false);
              setSkipScope("set");
              setSkipError(null);
            }}
            pending={skipPending}
            error={skipError}
          />
        )}

        {nextItem && (
          <div
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              textAlign: "right",
            }}
          >
            Next: Set {nextSlot! + 1} of {totalSlots}
            {" · "}
            <span className="mono">
              {nextWeight != null
                ? `${formatWeight(nextWeight, units)} × ${nextItem.reps ?? targetReps}`
                : renderTargetLine(nextItem, nextItem.reps ?? targetReps, false)}
            </span>
          </div>
        )}
      </form>

      {focusStrip && (
        <SessionDock
          rest={restTimerNode}
          primary={logButton}
          accessory={isEditing ? dockCancelButton : dockAccessory}
          editing={isEditing}
          undo={
            undo ? (
              <div className="cp-dock-undo" data-testid="session-dock-undo">
                <span className="cp-dock-undo-msg">
                  Logged <span className="mono">{undo.summary}</span>
                </span>
                <button
                  type="button"
                  className="cp-btn"
                  onClick={() => void runUndo()}
                  disabled={undoing}
                  data-testid="session-dock-undo-button"
                >
                  {undoing ? "Undoing…" : "Undo"}
                </button>
              </div>
            ) : null
          }
        />
      )}
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

/**
 * Format the bodyweight Phase 3 prescription headline. Variants:
 *   - reps:           "X sets × Y reps · Ts lower · RIR R"
 *   - tempo_reps:     "X sets × Y reps · Ts eccentric · RIR R"
 *   - isometric_hold: "X sets × Y sec hold · RIR R"
 *
 * Source: bodyweight progression plan Phase 3 — main-lift focus card
 * copy contract. Plain English, no methodology names (DC-Q6).
 */
function renderBwHeadline(item: PrescriptionItem, units: WeightUnit): string {
  const bw = item.bw;
  if (!bw) return "";
  const rir = `RIR ${bw.targetRir}`;
  const loadSuffix = renderBwLoadSuffix(bw, units);
  if (bw.prescriptionType === "isometric_hold" && bw.holdSeconds != null) {
    return `${bw.sets} sets × ${bw.holdSeconds}s hold · ${rir}${loadSuffix}`;
  }
  if (bw.prescriptionType === "tempo_reps" && bw.reps != null) {
    return `${bw.sets} sets × ${bw.reps} reps · ${bw.tempoEccentricSec}s eccentric · ${rir}${loadSuffix}`;
  }
  if (bw.reps != null) {
    return `${bw.sets} sets × ${bw.reps} reps · ${bw.tempoEccentricSec}s lower · ${rir}${loadSuffix}`;
  }
  return `${bw.sets} sets · ${rir}${loadSuffix}`;
}

/**
 * Phase 7 — render the "· +10 kg vest" / "· −10 kg band" suffix when
 * a load source is applied. Returns empty string when no load (the
 * readiness state — zero externalLoadKg with a defined loadSource —
 * is surfaced via the soft info chip below the headline, not here).
 */
function renderBwLoadSuffix(bw: NonNullable<PrescriptionItem["bw"]>, units: WeightUnit): string {
  if (bw.externalLoadKg == null || bw.externalLoadKg === 0) return "";
  const label = loadSourceLabel(bw.loadSource);
  if (bw.externalLoadKg < 0) {
    return ` · −${formatWeight(Math.abs(bw.externalLoadKg), units)} ${label}`;
  }
  return ` · +${formatWeight(bw.externalLoadKg, units)} ${label}`;
}

function loadSourceLabel(src: NonNullable<PrescriptionItem["bw"]>["loadSource"]): string {
  switch (src) {
    case "weighted_vest":
      return "vest";
    case "dip_belt":
      return "belt";
    case "ankle_weights":
      return "ankle";
    case "band_assist":
      return "band";
    default:
      return "load";
  }
}

/**
 * Phase 4 — "Next:" chip + gate-state popover beneath the BW headline.
 *
 * When the user is at a terminal node we render a "Mastered" chip in
 * `--cp-success`. Otherwise the chip names the lowest-anchor child
 * (stamped at planner-generation time on `bw.nextNodePreview`).
 * Tapping the chip toggles a small absolutely-positioned popover with
 * the three gate counters (weeks at node, TUT, recent over-completion).
 */
function BwNextHint({
  preview,
  gateState,
}: {
  preview?:
    | { nodeKey: string; displayName: string; difficultyAnchor: number }
    | { mastered: true };
  gateState?: {
    weeksAtNode: number;
    weeksRequired: number;
    tutAccumulated: number;
    tutRequired: number;
    recentOverCompleted: boolean;
  };
}) {
  const [open, setOpen] = useState(false);
  if (!preview) return null;
  const mastered = "mastered" in preview && preview.mastered;
  const label = mastered
    ? "Mastered"
    : `Next: ${"displayName" in preview ? preview.displayName : ""}`;
  const color = mastered ? "var(--cp-success)" : "var(--cp-text-muted)";
  return (
    <div
      style={{
        position: "relative",
        display: "inline-block",
        marginTop: 2,
      }}
    >
      <button
        type="button"
        data-testid="bw-next-chip"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 8px",
          borderRadius: 999,
          border: `1px solid ${mastered ? "var(--cp-success)" : "var(--cp-border)"}`,
          background: "transparent",
          color,
          fontSize: 11,
          lineHeight: 1.2,
          cursor: gateState ? "pointer" : "default",
        }}
      >
        {label}
      </button>
      {open && gateState && (
        <div
          data-testid="bw-next-popover"
          role="dialog"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            minWidth: 200,
            padding: 10,
            borderRadius: 10,
            border: "1px solid var(--cp-border)",
            background: "var(--cp-surface)",
            color: "var(--cp-text)",
            fontSize: 11,
            lineHeight: 1.45,
            boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
            textAlign: "left",
          }}
        >
          <div>
            weeks at node {gateState.weeksAtNode}/{gateState.weeksRequired}
          </div>
          <div>
            TUT {gateState.tutAccumulated}/{gateState.tutRequired} sec
          </div>
          <div>
            last 2 sessions over-completed{" "}
            <span
              style={{
                color: gateState.recentOverCompleted
                  ? "var(--cp-success)"
                  : "var(--cp-text-muted)",
              }}
            >
              {gateState.recentOverCompleted ? "✓" : "✗"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Phase 7 — load badge + override stepper for loaded BW prescriptions.
 *
 * Three visual states keyed off `bw.externalLoadKg`:
 *   - undefined          → control hidden (caller checks loadSource)
 *   - 0 with loadSource  → soft "Ready for external load" info chip
 *   - non-zero (incl. <0) → badge with the suggested kg + ±2.5 kg stepper
 *
 * The actual kg the user logs flows back via the parent's `value` /
 * `onChange` so `handleSubmit` can stamp it onto the FormData.
 */
function BwLoadControl({
  bw,
  value,
  onChange,
  units,
}: {
  bw: NonNullable<PrescriptionItem["bw"]>;
  value: number;
  onChange: (next: number) => void;
  units: WeightUnit;
}) {
  const source = bw.loadSource;
  if (!source) return null;
  const suggested = bw.externalLoadKg ?? 0;
  const isReadiness = suggested === 0;
  const isAssist = value < 0 || suggested < 0;
  const label = (() => {
    switch (source) {
      case "weighted_vest":
        return "vest";
      case "dip_belt":
        return "belt";
      case "ankle_weights":
        return "ankle";
      case "band_assist":
        return "band";
    }
  })();
  if (isReadiness) {
    return (
      <div
        data-testid="bw-load-readiness"
        style={{
          marginTop: 2,
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 999,
          border: "1px dashed var(--cp-border)",
          color: "var(--cp-text-muted)",
          fontSize: 11,
          lineHeight: 1.2,
        }}
      >
        Ready for external load — try +{weightStepDisplay(units)} {weightUnitLabel(units)} next session
      </div>
    );
  }
  const display = isAssist
    ? `−${formatWeight(Math.abs(value), units)} ${label}`
    : `+${formatWeight(value, units)} ${label}`;
  return (
    <div
      data-testid="bw-load-control"
      data-source={source}
      style={{
        marginTop: 4,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <button
        type="button"
        aria-label="decrease external load"
        data-testid="bw-load-down"
        onClick={() => onChange(stepWeightKg(value, units, -1, { floorAtZero: false }))}
        style={loadStepperBtn}
      >
        −
      </button>
      <span
        data-testid="bw-load-badge"
        style={{
          padding: "2px 8px",
          borderRadius: 999,
          background: "var(--cp-accent-soft, var(--cp-surface))",
          color: "var(--cp-accent, var(--cp-text))",
          fontSize: 11,
          fontWeight: 600,
          minWidth: 90,
          textAlign: "center",
        }}
      >
        {display}
      </span>
      <button
        type="button"
        aria-label="increase external load"
        data-testid="bw-load-up"
        onClick={() => onChange(stepWeightKg(value, units, 1, { floorAtZero: false }))}
        style={loadStepperBtn}
      >
        +
      </button>
    </div>
  );
}

const loadStepperBtn: React.CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  width: 44,
  height: 44,
  borderRadius: 8,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
  fontSize: 18,
  cursor: "pointer",
};

/**
 * Format a RIR / RPE / hold range as a single label. Returns null when
 * the item carries no autoregulation fields — caller falls back to the
 * legacy "× N reps" render.
 */
function renderIntensityChip(item: PrescriptionItem): string | null {
  if (item.distanceM) {
    const { min, max } = item.distanceM;
    return min === max ? `${min}m carry` : `${min}–${max}m carry`;
  }
  if (item.holdSec) {
    const { min, max } = item.holdSec;
    return min === max ? `Hold ${min}s` : `Hold ${min}–${max}s`;
  }
  if (item.tempoEccentricSec != null && item.targetRir) {
    const r = item.targetRir;
    const rir = r.min === r.max ? `RIR ${r.min}` : `RIR ${r.min}–${r.max}`;
    return `${item.tempoEccentricSec}s lower · ${rir}`;
  }
  if (item.tempoEccentricSec != null) {
    return `${item.tempoEccentricSec}s lower`;
  }
  if (item.targetRir) {
    const r = item.targetRir;
    return r.min === r.max ? `RIR ${r.min}` : `RIR ${r.min}–${r.max}`;
  }
  if (item.targetRpe) {
    const r = item.targetRpe;
    // RPE 10 is the conventional "max intent" marker for plyo / power work.
    if (r.min === r.max && r.min === 10) return "Max intent";
    return r.min === r.max ? `RPE ${r.min}` : `RPE ${r.min}–${r.max}`;
  }
  return null;
}

/**
 * Compose the target-line under the weight readout. Variants:
 *   - Carry:       "× 30–40m carry" (loaded carry — McGill 2014)
 *   - Isometric:   "Hold 30–60s"
 *   - Plyometric:  "× 3–5 reps · max intent"
 *   - Tendon:      "× 8–10 reps · 3s lower"
 *   - Accessory:   "× 8–12 reps"
 *   - Main lift:   "× 5 reps" (legacy, untouched)
 */
export function renderTargetLine(
  item: PrescriptionItem,
  targetReps: number,
  isAmrap: boolean,
): string {
  // Carry — distance replaces the rep readout entirely.
  if (item.distanceM) {
    const { min, max } = item.distanceM;
    return min === max ? `× ${min}m carry` : `× ${min}–${max}m carry`;
  }
  // Isometric — hold replaces the rep readout entirely.
  if (item.holdSec) {
    const { min, max } = item.holdSec;
    return min === max ? `Hold ${min}s` : `Hold ${min}–${max}s`;
  }
  const repsLabel = item.repRange
    ? `${item.repRange.min}–${item.repRange.max} reps`
    : `${targetReps} ${isAmrap ? "reps+" : "reps"}`;
  const maxRepsHint =
    item.notes && /max reps/i.test(item.notes) ? " · max reps allowed" : "";
  // Plyometric — explicit intent cue alongside reps.
  if (item.targetRpe && item.targetRpe.min === 10 && item.targetRpe.max === 10) {
    return `× ${repsLabel} · max intent${maxRepsHint}`;
  }
  // Tendon — surface the eccentric tempo next to the rep line.
  if (item.tempoEccentricSec != null) {
    return `× ${repsLabel} · ${item.tempoEccentricSec}s lower${maxRepsHint}`;
  }
  return `× ${repsLabel}${maxRepsHint}`;
}

function DotStrip({
  group,
  loggedItemIndices,
  skippedItemIndices,
  cursor,
  onPickSlot,
}: {
  group: MovementGroup;
  loggedItemIndices: ReadonlySet<number>;
  skippedItemIndices?: ReadonlySet<number>;
  cursor: number;
  onPickSlot: (slot: number) => void;
}) {
  return (
    <div
      role="tablist"
      data-testid="movement-dot-strip"
      style={{ display: "flex", justifyContent: "center", gap: 0, flexWrap: "wrap" }}
    >
      {group.itemIndices.map((idx, slot) => {
        const isLogged = loggedItemIndices.has(idx);
        const isSkipped = !!skippedItemIndices?.has(idx);
        const isActive = slot === cursor;
        // Insert a small visual gap whenever the kind-bucket changes
        // (warm-up → working set → accessory). Keeps the warmups
        // visually grouped as a distinct cluster from the working
        // sets without changing the underlying cursor model.
        const prevKind = slot > 0 ? group.items[slot - 1]?.kind : null;
        const thisKind = group.items[slot]?.kind ?? null;
        const bucketChanged =
          prevKind != null &&
          thisKind != null &&
          bucketForKind(prevKind) !== bucketForKind(thisKind);
        const base: React.CSSProperties = {
          height: 10,
          borderRadius: 999,
          border: "none",
          padding: 0,
          cursor: "pointer",
          transition: "all 140ms ease-out",
          marginLeft: bucketChanged ? 12 : 0,
        };
        let style: React.CSSProperties;
        if (isSkipped) {
          // Hollow dashed warning — same height as logged so the row
          // stays visually aligned.
          style = {
            ...base,
            width: isActive ? 26 : 18,
            background: "transparent",
            border: "1.5px dashed var(--cp-warning)",
            color: "var(--cp-warning)",
            fontSize: 8,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          };
        } else if (isLogged) {
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
            data-skipped={isSkipped ? "true" : "false"}
            onClick={() => onPickSlot(slot)}
            aria-label={`Set ${slot + 1} of ${group.itemIndices.length}${isSkipped ? " — skipped" : isLogged ? " — logged" : ""}`}
            // The pip stays small — a 44px-tall coloured bar would read as a
            // progress chart, not a set marker. The BUTTON is 44×44 so it can
            // actually be hit with a thumb; the pip is a child of it.
            style={{
              width: 44,
              height: 44,
              minWidth: 44,
              minHeight: 44,
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              marginLeft: bucketChanged ? 12 : 0,
            }}
          >
            <span style={{ ...style, marginLeft: 0 }} aria-hidden="true">
              {isSkipped && isActive ? "—" : isLogged && isActive ? "✓" : null}
            </span>
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
  testId,
  showStepHint = true,
}: {
  label: string;
  value: number;
  step: number;
  integer: boolean;
  onMinus: () => void;
  onPlus: () => void;
  onSet: (n: number) => void;
  testId?: string;
  showStepHint?: boolean;
}) {
  // The ± buttons change the value from outside the text field, so the text
  // being edited has to be dropped or the field would keep showing what was
  // typed before the tap. Remounting the input is the reset.
  const [resetToken, setResetToken] = useState(0);
  const stepAndReset = (run: () => void) => () => {
    setResetToken((n) => n + 1);
    run();
  };
  return (
    <div
      data-testid={testId}
      style={{
        background: "var(--cp-surface)",
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        // Horizontal padding is deliberately tight. Two steppers sit side by
        // side inside the focus card, so at 375px each column is only ~150px:
        // 44+44 for the buttons leaves barely 40px for the number field unless
        // the container gives up its own padding. The field is an interactive
        // target too and has to clear 44px, so the padding loses.
        padding: "10px 6px",
        display: "grid",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          paddingLeft: 2,
        }}
      >
        {label}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 0, alignItems: "center" }}>
        <button
          type="button"
          onClick={stepAndReset(onMinus)}
          className="cp-btn"
          aria-label={`Decrease ${label}`}
          style={{ padding: "8px 12px", minWidth: 44, minHeight: 44 }}
        >
          −
        </button>
        <NumberEntryInput
          key={resetToken}
          label={label}
          value={value}
          integer={integer}
          onSet={onSet}
          scrollIntoViewOnFocus
          className="mono"
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            textAlign: "center",
            fontWeight: 700,
            fontSize: 17,
            width: "100%",
            padding: 0,
            color: "var(--cp-text)",
          }}
        />
        <button
          type="button"
          onClick={stepAndReset(onPlus)}
          className="cp-btn"
          aria-label={`Increase ${label}`}
          style={{ padding: "8px 12px", minWidth: 44, minHeight: 44 }}
        >
          +
        </button>
      </div>
      {showStepHint && (
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", textAlign: "center" }}>
          ± {step}
        </div>
      )}
    </div>
  );
}

// Avoid unused type import warning.
export type _PrescriptionItem = PrescriptionItem;
