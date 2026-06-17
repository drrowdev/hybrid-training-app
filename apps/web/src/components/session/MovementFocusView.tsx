"use client";

/**
 * Focus view for one prescribed movement card. Owns the dot strip,
 * the steppers, the save submit, PR-flash UI, and the auto/manual
 * cursor model. Pure UI — the parent `<MovementCard>` supplies the
 * logged-set data, prior bests, and the server action to call.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PrescriptionItem } from "@hta/db";
import type { SkipReason } from "@/lib/sessions/skip-reasons";
import {
  autoCursorForGroup,
  bucketForKind,
  bucketPositionForSlot,
  effectiveCursor,
  bucketLabelForKind,
  roundToPlate,
  type MovementGroup,
} from "@/lib/sessions/movement-grouping";
import { detectTmAnchoredPr } from "@/lib/engine/tm-anchored-pr";
import { restSecondsForKind } from "@/lib/sessions/rest";
import { resolveBarKind } from "@/lib/sessions/bar-kind";
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
import { RpeZonePicker } from "./RpeZonePicker";
import { SkipSetMenu } from "./SkipSetMenu";
import { PlateView } from "./PlateView";
import type { PlateInventoryItem } from "./plate-math";

export type FocusLoggedSet = {
  id: string;
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
  addStrengthSet: (fd: FormData) => Promise<{ error?: string; ok?: true }>;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
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
   */
  barbellKg?: number;
  trapBarKg?: number;
  plateInventory?: PlateInventoryItem[];
  preferStandardLbPlates?: boolean;
  /**
   * Optional manual cursor pinned by the parent — e.g. clicking
   * "Edit sets" on a recap-row opens the focus view at the last
   * logged slot. Null means "let the auto cursor decide".
   */
  initialCursor?: number | null;
  /** Called after a successful save so the parent can run auto-collapse logic. */
  onSaved?: (info: { itemIndex: number; isLast: boolean }) => void;
  /**
   * True when the movement is bodyweight-capable (`body_weight_loaded`):
   * pull-ups, dips, inverted rows, push-ups, etc. For these the weight field
   * is OPTIONAL added load — logging at 0 kg (pure bodyweight) is valid — so
   * the default-kind validation no longer demands a weight.
   */
  bodyweightCapable?: boolean;
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
  oneRmKg,
  loggedItemIndices,
  skippedItemIndices,
  loggedSetIdByItemIndex,
  loggedSets,
  priorBest,
  addStrengthSet,
  hapticsEnabled,
  timerSoundEnabled,
  barbellKg = 20,
  trapBarKg = 25,
  plateInventory,
  preferStandardLbPlates = true,
  initialCursor = null,
  onSaved,
  bwGateStateByFamily,
  bodyweightCapable = false,
}: FocusViewProps) {
  const units = useUnits();
  const unitLabel = weightUnitLabel(units);
  // priorBest is no longer consumed for PR detection — the flash is now
  // anchored to the saved 1RM (see lib/engine/tm-anchored-pr.ts). The
  // prop is preserved on the public type to keep the parent prop chain
  // intact (the server still computes priorBests for other consumers).
  void priorBest;
  const totalSlots = group.itemIndices.length;
  const autoCursor = useMemo(
    () => autoCursorForGroup(group, loggedItemIndices),
    [group, loggedItemIndices],
  );
  const [manualCursor, setManualCursor] = useState<number | null>(initialCursor);
  // Adopt parent-pinned cursor changes (e.g. user taps "Edit sets" on
  // a different completed card). We do NOT clear back to null when
  // the parent passes null — `setManualCursor(null)` after a save is
  // already the path that hands control back to the auto cursor.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror parent-pinned cursor into local state
    if (initialCursor != null) setManualCursor(initialCursor);
  }, [initialCursor]);
  const cursor = effectiveCursor(autoCursor, manualCursor);

  const activeItem = group.items[cursor];
  const activeItemIndex = group.itemIndices[cursor]!;
  const isActiveLogged = loggedItemIndices.has(activeItemIndex);
  const loggedSetId = loggedSetIdByItemIndex[activeItemIndex];
  const isWarmup = activeItem?.kind === "warmup";
  // Position of the active slot within its own kind-bucket
  // (warmup / working / accessory). Drives the "Set X of Y" caption
  // so warm-ups don't inflate the working-set count.
  const bucketSlot = useMemo(
    () => bucketPositionForSlot(group, cursor),
    [group, cursor],
  );

  // AMRAP detection. Platform programs (5/3/1, Tactical Barbell, …) always mark
  // an AMRAP set explicitly via `isAmrap`, so we trust that flag alone. (The old
  // positional "last main set is an open AMRAP" fallback mis-fired for straight-
  // set programs like Tactical Barbell and fixed-5s, showing a bogus "5 reps+".)
  const isAmrap = activeItem?.isAmrap === true;

  // Target weight / reps derived from the prescription + TM.
  const targetWeight = useMemo(() => {
    if (!activeItem) return 0;
    if (activeItem.percentTm != null && tmKg) {
      return roundToPlate((tmKg * activeItem.percentTm) / 100);
    }
    // Warm-ups carry a concrete target weight (e.g. 5/3/1's 40/50/60% ramp
    // resolved to kg at deploy) but no % of TM — prefer it so the logger
    // prescribes the warm-up load instead of defaulting to bar-only.
    if (activeItem.targetWeightKg != null && activeItem.targetWeightKg > 0) {
      return roundToPlate(activeItem.targetWeightKg);
    }
    // Fall back to the most recent logged weight for this movement.
    return loggedSets[loggedSets.length - 1]?.weightKg ?? 0;
  }, [activeItem, tmKg, loggedSets]);
  const targetReps = activeItem?.reps ?? 5;
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
  const targetDistance = useMemo(() => {
    const d = activeItem?.distanceM;
    if (!d) return 0;
    // Default to the midpoint, rounded to the nearest 5 m step so the
    // stepper's stable interval matches the prescription range.
    return Math.round((d.min + d.max) / 2 / 5) * 5;
  }, [activeItem]);
  const targetDuration = useMemo(() => {
    const h = activeItem?.holdSec;
    if (!h) return 0;
    return Math.round((h.min + h.max) / 2 / 5) * 5;
  }, [activeItem]);

  // Stepper state. We snap defaults back to target whenever the cursor
  // moves so the user always starts at the prescription.
  const [weight, setWeight] = useState<number>(targetWeight);
  const [reps, setReps] = useState<number>(targetReps);
  const [distanceM, setDistanceM] = useState<number>(targetDistance);
  const [durationSec, setDurationSec] = useState<number>(targetDuration);
  // Phase 7 — actual external load applied (vest / belt / ankle / band
  // assist). Mirrors the planner's suggested `bw.externalLoadKg` by
  // default; user can override via the ±2.5 kg stepper. Negative for
  // band-assist.
  const targetExternalLoad = activeItem?.bw?.externalLoadKg ?? 0;
  const [externalLoadKg, setExternalLoadKg] = useState<number>(targetExternalLoad);
  const [rpe, setRpe] = useState<number | null>(null);
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
  const [prFlash, setPrFlash] = useState<PrFlash | null>(null);
  const [justLoggedAt, setJustLoggedAt] = useState<number | null>(null);
  const [restSeconds, setRestSeconds] = useState(0);
  const [restToken, setRestToken] = useState(0);
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

  // Snap weight/reps to the target whenever the active slot changes.
  // Also reset RPE + close the skip menu so each set starts clean.
  const cursorKey = `${group.movementId}:${cursor}:${isActiveLogged ? "done" : "open"}`;
  const lastCursorKey = useRef(cursorKey);
  useEffect(() => {
    if (lastCursorKey.current === cursorKey) return;
    lastCursorKey.current = cursorKey;
    setWeight(targetWeight);
    setReps(targetReps);
    setDistanceM(targetDistance);
    setDurationSec(targetDuration);
    setExternalLoadKg(targetExternalLoad);
    // Pre-select RPE from an already-logged set when re-opening it,
    // otherwise clear so the picker is the empty "no zone" state.
    const existing = isActiveLogged
      ? loggedSets.find((s) => s.id === loggedSetId)
      : null;
    setRpe(existing?.rpe ?? null);
    setError(null);
    setSkipMenuOpen(false);
    setSkipError(null);
  }, [cursorKey, targetWeight, targetReps, targetDistance, targetDuration, targetExternalLoad, isActiveLogged, loggedSetId, loggedSets]);

  // Auto-clear PR flash after 4.5s.
  useEffect(() => {
    if (!prFlash) return;
    const id = window.setTimeout(() => setPrFlash(null), 4500);
    return () => window.clearTimeout(id);
  }, [prFlash]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeItem) return;
    if (firedIndicesRef.current.has(activeItemIndex)) return;
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
    if (rpe != null && !isWarmup) {
      fd.set("rpe", String(rpe));
    }
    // Phase 7 — propagate the actual external load the user applied so
    // the per-set side effect can mirror it into clean_rep_history.
    if (itemKind === "bw_reps" && activeItem.bw?.loadSource != null) {
      fd.set("externalLoadKg", String(externalLoadKg));
      fd.set("loadSource", String(activeItem.bw.loadSource));
    }

    // TM-anchored PR detection. The flash fires only when the new set
    // beats the user's saved 1RM (Weight / e1RM) or, in an AMRAP context,
    // exceeds the prescribed rep count (Rep PR). If `oneRmKg` is unset,
    // no PR can fire — we don't celebrate against a missing claim.
    // Carries / isometric holds don't trigger TM-anchored PRs (no rep
    // count to anchor an e1RM estimate against).
    const setKindForPr = SET_KIND_TO_LOG[activeItem.kind] ?? "main";
    const flash =
      itemKind === "default"
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
    setManualCursor(null);
    setJustLoggedAt(Date.now());
    if (flash && (flash.isWeightPr || flash.isE1rmPr || flash.e1rmKg != null)) {
      setPrFlash(flash);
    }
    // Inline rest timer — skipped after the final slot of this movement (B2).
    // There is no "next set" to rest before, so a running countdown would
    // mislabel itself "next <movement>" and linger over the Finish CTA. We also
    // CLEAR any timer still running from the previous set.
    const isLastSlot = cursor >= totalSlots - 1;
    if (isLastSlot) {
      setRestSeconds(0);
    } else {
      const secs = restSecondsForKind(SET_KIND_TO_LOG[activeItem.kind] ?? "main");
      if (secs > 0) {
        setRestSeconds(secs);
        setRestToken((t) => t + 1);
      }
    }
    onSaved?.({
      itemIndex: activeItemIndex,
      isLast: isLastSlot,
    });
    void addStrengthSet(fd)
      .then((result) => {
        if (result?.error) {
          firedIndicesRef.current.delete(activeItemIndex);
          setError(result.error);
        }
      })
      .catch(() => {
        firedIndicesRef.current.delete(activeItemIndex);
        setError("Couldn't save that set — check your connection and retry.");
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
    if (note) fd.set("notes", note);
    try {
      const result = await addStrengthSet(fd);
      if (result?.error) {
        setSkipError(result.error);
        return;
      }
      hapticTick(hapticsEnabled);
      setSkipMenuOpen(false);
      setManualCursor(null);
      // Skipped sets must not trigger PR/e1RM toasts or the rest timer
      // — they are intentionally "no work".
      onSaved?.({
        itemIndex: activeItemIndex,
        isLast: cursor >= totalSlots - 1,
      });
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
    .map((idx, slot) => ({ idx, kind: group.items[slot]?.kind ?? "main" }))
    .filter(({ idx }) => !loggedItemIndices.has(idx));

  const handleSkipRest = async (reason: SkipReason, note: string | null) => {
    if (skipPending) return;
    setSkipPending(true);
    setSkipError(null);
    try {
      for (const { idx, kind } of remainingSlots) {
        const fd = new FormData();
        fd.set("sessionId", sessionId);
        fd.set("movementId", group.movementId);
        fd.set("setKind", SET_KIND_TO_LOG[kind] ?? "main");
        fd.set("weightKg", "0");
        fd.set("reps", "0");
        fd.set("prescriptionItemIndex", String(idx));
        fd.set("skipped", "true");
        fd.set("skipReason", reason);
        if (note) fd.set("notes", note);
        const result = await addStrengthSet(fd);
        if (result?.error) {
          setSkipError(result.error);
          return;
        }
      }
      hapticTick(hapticsEnabled);
      setSkipMenuOpen(false);
      setManualCursor(null);
      onSaved?.({ itemIndex: activeItemIndex, isLast: true });
    } finally {
      setSkipPending(false);
    }
  };

  const ctaLabel = isActiveLogged ? "Update set ↗" : submitting ? "Logging…" : "Log set";
  const nextSlot = cursor + 1 < totalSlots ? cursor + 1 : null;
  const nextItem = nextSlot != null ? group.items[nextSlot]! : null;
  const nextWeight =
    nextItem && nextItem.percentTm != null && tmKg
      ? roundToPlate((tmKg * nextItem.percentTm) / 100)
      : nextItem && nextItem.targetWeightKg != null && nextItem.targetWeightKg > 0
        ? roundToPlate(nextItem.targetWeightKg)
        : null;

  return (
    <div
      data-testid="movement-focus-view"
      style={{
        display: "grid",
        gap: 14,
        // On wide screens the focus card otherwise stretches to ~900px and
        // makes the weight/buttons look oversized. Cap at a comfortable
        // mobile-equivalent width and center.
        maxWidth: 520,
        marginLeft: "auto",
        marginRight: "auto",
        width: "100%",
      }}
    >
      {restSeconds > 0 && (
        <RestTimer
          key={restToken}
          seconds={restSeconds}
          defaultSeconds={restSeconds}
          onDone={() => setRestSeconds(0)}
          hapticsEnabled={hapticsEnabled}
          timerSoundEnabled={timerSoundEnabled}
          movementName={group.movementName}
        />
      )}

      <DotStrip
        group={group}
        loggedItemIndices={loggedItemIndices}
        skippedItemIndices={skippedItemIndices}
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
        Set {bucketSlot.position + 1} of {bucketSlot.total}
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
          <span>{bucketLabelForKind(activeItem.kind, bucketSlot.position, bucketSlot.total)}</span>
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
                className="mono"
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
        const barKind = resolveBarKind(group.movementSlug);
        if (barKind == null) return null;
        // Additional safety: if the movement has no training max set,
        // it isn't a tracked main lift and shouldn't claim a bar.
        if (tmKg == null) return null;
        const barWeightKg = barKind === "trap_bar" ? trapBarKg : barbellKg;
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
        return (
          <PlateView
            targetWeightKg={weight}
            barWeightKg={barWeightKg}
            inventory={inv}
            units={units}
            preferStandardLbPlates={preferStandardLbPlates}
          />
        );
      })()}

      <form
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
              label={bodyweightCapable ? `Added weight (${unitLabel})` : `Weight (${unitLabel})`}
              value={roundDisplayWeight(displayWeight(weight, units), units)}
              step={weightStepDisplay(units)}
              integer={false}
              onMinus={() => setWeight((v) => stepWeightKg(v, units, -1))}
              onPlus={() => setWeight((v) => stepWeightKg(v, units, 1))}
              onSet={(displayVal) => setWeight(toKg(displayVal, units))}
            />
          )}
          {itemKind === "carry" ? (
            <Stepper
              label="Distance (m)"
              value={distanceM}
              step={5}
              integer
              testId="stepper-distance"
              onMinus={() => setDistanceM((v) => Math.max(0, v - 5))}
              onPlus={() => setDistanceM((v) => v + 5)}
              onSet={(n) => setDistanceM(Math.max(0, Math.round(n)))}
            />
          ) : itemKind === "isometric" ? (
            <Stepper
              label="Time (s)"
              value={durationSec}
              step={5}
              integer
              testId="stepper-duration"
              onMinus={() => setDurationSec((v) => Math.max(0, v - 5))}
              onPlus={() => setDurationSec((v) => v + 5)}
              onSet={(n) => setDurationSec(Math.max(0, Math.round(n)))}
            />
          ) : (
            <Stepper
              label="Reps"
              value={reps}
              step={1}
              integer
              onMinus={() => setReps((v) => Math.max(0, v - 1))}
              onPlus={() => setReps((v) => v + 1)}
              onSet={(n) => setReps(Math.max(0, Math.round(n)))}
            />
          )}
        </div>

        {!isWarmup && !isBwItem && (
          <RpeZonePicker
            value={rpe}
            onChange={(next) => setRpe(next)}
            disabled={submitting}
          />
        )}

        {error && (
          <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
            {error}
          </div>
        )}

        {isActiveLogged && loggedSetId ? (
          <a
            href={`/app/sessions/${sessionId}/sets/${loggedSetId}/edit`}
            data-testid={`logged-set-edit-${loggedSetId}`}
            className="cp-btn primary"
            style={{ textDecoration: "none", textAlign: "center" }}
          >
            {ctaLabel}
          </a>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <button
              type="submit"
              className="cp-btn primary"
              disabled={submitting}
              data-testid="movement-focus-log-button"
            >
              {ctaLabel}
              {!submitting &&
                ((itemKind === "bw_reps" && reps > 0) ||
                  (itemKind === "isometric" && durationSec > 0 && (isBwHold || weight > 0)) ||
                  (weight > 0 &&
                    ((itemKind === "carry" && distanceM > 0) ||
                      (itemKind === "isometric" && durationSec > 0) ||
                      (itemKind === "default" && reps > 0)))) && (
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
              )}
            </button>
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
                    fontSize: 12,
                    color: "var(--cp-text-muted)",
                    textDecoration: "underline",
                    padding: "4px 0",
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
                      fontSize: 12,
                      color: "var(--cp-text-muted)",
                      textDecoration: "underline",
                      padding: "4px 0",
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
        )}

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
  width: 28,
  height: 28,
  borderRadius: 8,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
  fontSize: 14,
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
function renderTargetLine(
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
  const repsLabel = `${targetReps} ${isAmrap ? "reps+" : "reps"}`;
  // Plyometric — explicit intent cue alongside reps.
  if (item.targetRpe && item.targetRpe.min === 10 && item.targetRpe.max === 10) {
    return `× ${repsLabel} · max intent`;
  }
  // Tendon — surface the eccentric tempo next to the rep line.
  if (item.tempoEccentricSec != null) {
    return `× ${repsLabel} · ${item.tempoEccentricSec}s lower`;
  }
  return `× ${repsLabel}`;
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
      style={{ display: "flex", justifyContent: "center", gap: 6 }}
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
            style={style}
            aria-label={`Set ${slot + 1} of ${group.itemIndices.length}${isSkipped ? " — skipped" : isLogged ? " — logged" : ""}`}
          >
            {isSkipped && isActive ? "—" : isLogged && isActive ? "✓" : null}
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
}: {
  label: string;
  value: number;
  step: number;
  integer: boolean;
  onMinus: () => void;
  onPlus: () => void;
  onSet: (n: number) => void;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
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
            fontSize: 17,
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
