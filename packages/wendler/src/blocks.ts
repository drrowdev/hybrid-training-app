/**
 * Periodization model — Leader / Anchor blocks and the program sequence.
 *
 * Ported from the wendler-app domain engine. This is the FOCUSED periodization
 * core: the block/program data model, the methodology-calibrated assistance
 * VOLUME presets, the day-order + grouping math, and the cursor / TM helpers.
 *
 * The app-coupled day-PLAN model (BlockPlan, ScheduleDay, derivePlan, per-day
 * skips, weekday/cardio helpers) and the assistance-PRESCRIPTION model
 * (AssistanceEntry/Plan) are intentionally NOT ported here — they bind to a
 * specific app's session/scheduling shape and are layered in at integration
 * time. Source: 5/3/1 Forever (Wendler, 2017).
 */
import type { EquipmentType, MainLift, SeventhWeekKind, WendlerWeek } from "./types";
import type { SupplementalTemplateId } from "./supplemental";
import type { MainScheme } from "./waves";

export type BlockKind = "leader" | "anchor" | "standalone" | "seventh-week";

// ─────────────────────────────────────────────────────────────────────────────
// Assistance volume (block-level preset)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-block assistance-volume preset — how much accessory work a block carries.
 * - 'minimal'  — recovery floor (deload / taper / injury).
 * - 'standard' — Forever-canonical; safe Anchor default.
 * - 'high'     — generous accessory work; typical Leader setting.
 */
export type AssistanceVolumePreset = "minimal" | "standard" | "high";

/** Explicit numeric override (weekly totals) when no preset fits. */
export interface AssistanceVolumeCustom {
  preset: "custom";
  /** Working reps per main-lift day across all assistance entries. */
  mainDayReps: number;
  /** Working reps on the dedicated accessory day (0 if none). */
  accessoryReps: number;
  /** Number of distinct movements on the accessory day. */
  accessoryMovements: number;
}

export type AssistanceVolume = AssistanceVolumePreset | AssistanceVolumeCustom;

/**
 * Numeric resolution per preset, calibrated to Wendler 5/3/1 Forever's actual
 * prescriptions (weekly totals; main:accessory ≈ 1:3):
 *  - minimal  = 7th-Week floor (P25 + Pl25 + SL/Core25 = 75 reps/workout).
 *  - standard = base 5/3/1 / Leader / BBB range (≈120 main / ≈300 accessory / 10 mv).
 *  - high     = Anchor / FSL upper end (≈150 main / ≈450 accessory / 14 mv).
 */
export const ASSISTANCE_VOLUME_PRESETS: Record<AssistanceVolumePreset, AssistanceVolumeCustom> = {
  minimal: { preset: "custom", mainDayReps: 75, accessoryReps: 225, accessoryMovements: 7 },
  standard: { preset: "custom", mainDayReps: 120, accessoryReps: 300, accessoryMovements: 10 },
  high: { preset: "custom", mainDayReps: 150, accessoryReps: 450, accessoryMovements: 14 },
};

/** Resolve any AssistanceVolume (preset string or custom object) to numbers. */
export function resolveAssistanceVolume(volume: AssistanceVolume): AssistanceVolumeCustom {
  if (typeof volume === "string") return { ...ASSISTANCE_VOLUME_PRESETS[volume] };
  return { ...volume };
}

/**
 * Phase-aware assistance-volume shift. Deload/taper → 'minimal' (recovery);
 * peak demotes only 'high'→'standard' (sharpening, not full taper); 'normal'
 * unchanged. Custom volumes are left untouched (the user gave explicit numbers).
 */
export function effectiveAssistanceVolumeForPhase(
  stored: AssistanceVolume,
  phase: "normal" | "deload" | "taper" | "peak",
): AssistanceVolume {
  if (typeof stored !== "string") return stored;
  if (phase === "normal") return stored;
  if (phase === "deload" || phase === "taper") return "minimal";
  if (stored === "high") return "standard";
  return stored;
}

/**
 * Default preset by block kind (mirrors Forever's volume/intensity shape):
 * leader → 'standard' (supplemental already loads volume), anchor → 'high'
 * (lighter supplemental → room for accessory variety), standalone → 'standard',
 * seventh-week → 'minimal' (recovery/test).
 */
export function defaultAssistanceVolumeForKind(
  kind: BlockKind,
  _seventhWeekKind?: SeventhWeekKind,
): AssistanceVolumePreset {
  if (kind === "seventh-week") return "minimal";
  if (kind === "leader") return "standard";
  if (kind === "anchor") return "high";
  return "standard";
}

// ─────────────────────────────────────────────────────────────────────────────
// Block + Program model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single training block. NOTE: the app-coupled day-PLAN fields from the
 * source (`plan`, `assistance`, `deloadScalingChoice`) are intentionally
 * omitted here — those bind to a specific session/scheduling model and are
 * reintroduced at integration time.
 */
export interface ProgramBlock {
  id: string;
  name: string;
  kind: BlockKind;
  /** For seventh-week blocks, which variant. Required for that kind. */
  seventhWeekKind?: SeventhWeekKind;
  /**
   * Training weeks before deload. Wendler standard: 3. Deloads are scheduled as
   * standalone seventh-week blocks, so this equals a non-7w block's week count.
   */
  weeksBeforeDeload: number;
  supplementalTemplate: SupplementalTemplateId;
  /** Main-work scheme. Default 'classic-531'; common Leader choice '5s-pro'. */
  mainScheme?: MainScheme;
  /** Per-lift TM% override; falls back to the user's default. Leader 85% / Anchor 85–90%. */
  tmPercentByLift?: Partial<Record<MainLift, number>>;
  /** Per-block supplemental set-count override (multi-set templates only). */
  supplementalSetsOverride?: number;
  /** Block-level assistance-volume picker; falls back to defaultAssistanceVolumeForKind. */
  assistanceVolume?: AssistanceVolume;
  /** Per-block available-equipment override for the assistance picker. */
  availableEquipment?: EquipmentType[];
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt?: string;
  /** Parent program id (multi-block programs). */
  programId?: string;
  /** 0-based position within the program. */
  sequenceIndex?: number;
}

/** A user-defined program: a planned sequence of blocks (Leader, Leader, Anchor …). */
export interface Program {
  id: string;
  name: string;
  createdAt: string;
  completedAt?: string;
  updatedAt?: string;
  availableEquipment?: EquipmentType[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Day order + cursor + TM helpers (pure scheduling math)
// ─────────────────────────────────────────────────────────────────────────────

/** The 4-day rotation. Wendler Forever default: Press, Deadlift, Bench, Squat. */
export const DEFAULT_DAY_ORDER: MainLift[] = ["press", "deadlift", "bench", "squat"];

/** Chunk the day order into per-day groups of `liftsPerDay` lifts. */
export function groupDays(dayOrder: MainLift[], liftsPerDay = 1): MainLift[][] {
  const n = Math.max(1, Math.floor(liftsPerDay));
  const out: MainLift[][] = [];
  for (let i = 0; i < dayOrder.length; i += n) {
    out.push(dayOrder.slice(i, i + n));
  }
  return out;
}

/** Day-group index (0-based) containing the per-lift dayIndex. */
export function dayGroupIndex(dayIndex: number, liftsPerDay = 1): number {
  return Math.floor(dayIndex / Math.max(1, Math.floor(liftsPerDay)));
}

/** Starting cursor week for a block: normal blocks start at 1; 7th-week at '7w'. */
export function initialCursorWeek(block: Pick<ProgramBlock, "kind">): WendlerWeek {
  return block.kind === "seventh-week" ? "7w" : 1;
}

/** Total sessions in a block: weeksBeforeDeload × dayOrder length. */
export function totalSessionsInBlock(block: ProgramBlock, dayOrder: MainLift[]): number {
  return block.weeksBeforeDeload * dayOrder.length;
}

/**
 * Advance the cursor by one day group. Returns null when the block is complete.
 * `numGroups` = training days per week. Leader/Anchor weeks go 1 → 2 → 3.
 */
export function advanceCursor(
  cursor: { week: WendlerWeek; groupIndex: number },
  block: Pick<ProgramBlock, "kind">,
  numGroups: number,
): { week: WendlerWeek; groupIndex: number } | null {
  const nextGroup = cursor.groupIndex + 1;
  if (nextGroup < numGroups) {
    return { week: cursor.week, groupIndex: nextGroup };
  }
  void block;
  const weekOrder: WendlerWeek[] = [1, 2, 3];
  const idx = weekOrder.indexOf(cursor.week);
  if (idx === -1 || idx === weekOrder.length - 1) return null;
  const nextWeek = weekOrder[idx + 1]!;
  return { week: nextWeek, groupIndex: 0 };
}

/**
 * Calendar start date of `weekScope` within a block, anchored to `anchor` (the
 * date training actually begins). week 1 → +0d, 2 → +7d, 3 → +14d, 'deload' →
 * +(weeksBeforeDeload×7)d, '7w' → undefined.
 */
export function weekStartDate(
  anchor: Date | string | null | undefined,
  weeksBeforeDeload: number,
  weekScope: WendlerWeek,
): Date | undefined {
  if (weekScope === "7w") return undefined;
  if (!anchor) return undefined;
  const start = anchor instanceof Date ? new Date(anchor.getTime()) : new Date(anchor);
  if (Number.isNaN(start.getTime())) return undefined;
  const offsetDays = weekScope === "deload" ? weeksBeforeDeload * 7 : (weekScope - 1) * 7;
  return new Date(start.getTime() + offsetDays * 86400000);
}

/** Resolve the TM% for a lift in a block, falling back to a default. */
export function tmPercentForLift(
  block: ProgramBlock,
  lift: MainLift,
  defaultTmPercent: number,
): number {
  return block.tmPercentByLift?.[lift] ?? defaultTmPercent;
}
