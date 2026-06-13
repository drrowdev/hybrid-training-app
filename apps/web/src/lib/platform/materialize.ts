/**
 * Program materialisation — turn a program engine's timeline into the rows the
 * app persists (`training_blocks` + `planned_sessions`).
 *
 * PURE: no DB, no React. The caller injects the engine, the concrete instance,
 * the platform context, a movement resolver, and the user's chosen training
 * weekdays. This module walks the engine's `timeline()`, materialises each
 * session's prescription via `prescribe()` + `adaptSessionPrescription()`, and
 * maps the program-native timeline onto the app's `(week_index, day_index, slot)`
 * grid so the existing read side (`dayDate`, Today, the logger, stats) consumes
 * it unchanged.
 *
 * Index mapping (this is the load-bearing part):
 *   - The app derives a session's calendar date from
 *     `dayDate(startedOn, week_index, day_index)` =
 *     `blockMonday + week_index*7 + day_index`. So `day_index` is the WEEKDAY
 *     OFFSET within the week (0 = Monday), NOT a session ordinal.
 *   - The engine timeline is a flat ordered list grouped into program-weeks by
 *     consecutive `weekLabel` runs. Each program-week's sessions are placed onto
 *     the caller's `weekdays` (the strength days picked in the wizard), in order.
 *   - An engine that assigns an explicit `weekday` on a spec wins over the
 *     `weekdays` schedule for that session (e.g. a program that fixes its own
 *     calendar). 5/3/1 does not, so it uses the schedule.
 */
import type {
  ProgramEngine,
  PlatformContext,
  PlannedSessionSpec,
} from "@hta/program-core";
import type { Prescription, PrescriptionItem } from "@hta/db";
import { adaptSessionPrescription, type MovementResolver, type SkippedItem } from "./adapter";
import type { AssistancePlanner } from "./assistance-resolver";
import type { TbAccessoryInjector } from "./tb-accessories";
import {
  classifySessionModality,
  effectiveStressLoad,
  type ClassifierMovement,
  type SessionModality,
} from "../planner/session-modality";

export interface MaterializeOptions {
  /**
   * Weekdays (0 = Monday … 6 = Sunday) the sessions of a single program-week are
   * placed on, in timeline order. Must hold at least as many entries as the
   * largest number of sessions any one program-week contains (e.g. 5/3/1 trains
   * four lifts a week, so four weekdays). Ignored for a session whose spec
   * carries an explicit `weekday`.
   */
  weekdays: number[];
  /**
   * Optional 5/3/1 assistance planner (ADR 0047). When supplied, each session's
   * category-tagged assistance intent is resolved to concrete catalog movements;
   * when omitted, assistance intent items are reported in `skipped`.
   */
  assistance?: AssistancePlanner;
  /**
   * Optional Tactical Barbell accessory injector (ADR 0048). When supplied, each
   * TRAINING session gets a small opt-in set of aesthetic accessory items appended
   * after the main work. Omitted ⇒ no accessories (the TB default).
   */
  accessories?: TbAccessoryInjector;
}

export interface MaterializedSession {
  /** Engine ref (stable within the instance) — handy for linking/debugging. */
  ref: string;
  /** 0-based program-week index (drives `dayDate`). */
  weekIndex: number;
  /** Weekday offset within the week, 0 = Monday (drives `dayDate`). */
  dayIndex: number;
  /** Two-a-day slot. Always "single" here — doubles are a later concern. */
  slot: "single";
  title: string;
  role: string;
  prescription: Prescription;
  sessionModality: SessionModality;
  effectiveStressLoad: number;
  /** Items the adapter could not map (unresolved movement / unsupported kind). */
  skipped: SkippedItem[];
}

export interface MaterializeResult {
  sessions: MaterializedSession[];
  /** Total program-week count — what `training_blocks.weeks` should record. */
  weeks: number;
  /** Aggregate of every session's skip report. */
  skipped: SkippedItem[];
}

/** Map an engine planned-session kind to the app's `planned_sessions.role`. */
function roleForKind(kind: PlannedSessionSpec["kind"]): string {
  switch (kind) {
    case "deload":
      return "deload";
    case "test":
      return "test";
    case "rest":
      return "rest";
    case "training":
    default:
      return "strength";
  }
}

/** Build the minimal classifier shape from an adapted prescription. */
function toClassifierMovements(items: PrescriptionItem[]): ClassifierMovement[] {
  return items.map((it): ClassifierMovement => {
    if (it.kind === "warmup") {
      return { kind: "warmup", estimatedHardSets: 0 };
    }
    // Cardio items carry no strength hard-sets — classify as conditioning so a
    // Green Protocol cardio day isn't miscounted as strength volume.
    if (it.kind.startsWith("cardio_")) {
      return {
        kind: "conditioning",
        estimatedHardSets: 0,
        ...(it.durationMin != null && it.durationMin > 0
          ? { cardioBlock: { mode: "mixed" as const, durationMinutes: it.durationMin } }
          : {}),
      };
    }
    // app kinds after adaptation are warmup | main | back_off | accessory
    const bucket = it.kind === "main" || it.kind === "back_off" ? it.kind : "accessory";
    const kind = it.kind === "main" || it.kind === "back_off" || it.kind === "accessory"
      ? it.kind
      : "accessory";
    return { kind, bucket, estimatedHardSets: it.sets ?? 1 };
  });
}

function stampModality(prescription: Prescription): {
  modality: SessionModality;
  load: number;
} {
  const movs = toClassifierMovements(prescription.items);
  const modality = classifySessionModality({ movements: movs });
  const hardSets = movs.reduce(
    (acc, m) => acc + (m.kind === "warmup" ? 0 : Math.max(0, m.estimatedHardSets)),
    0,
  );
  return { modality, load: effectiveStressLoad({ modality, hardSets }) };
}

/**
 * Materialise a concrete program instance into block + planned-session rows.
 * Sessions whose engine kind is "rest" are skipped (no planned row). Throws if
 * the schedule can't seat a program-week (more sessions in a week than the
 * `weekdays` schedule provides) — the caller is responsible for a valid
 * schedule.
 */
export function materializeProgram<I>(
  engine: ProgramEngine<I>,
  instance: I,
  ctx: PlatformContext,
  resolveMovement: MovementResolver,
  opts: MaterializeOptions,
): MaterializeResult {
  const timeline = engine.timeline(instance);
  const sessions: MaterializedSession[] = [];
  const allSkipped: SkippedItem[] = [];

  let weekIndex = -1;
  let positionInWeek = 0;
  let prevWeekLabel: string | undefined;
  let started = false;

  for (const spec of timeline) {
    if (spec.kind === "rest") continue;

    const weekKey = spec.weekLabel ?? `__idx${spec.index}`;
    if (!started || weekKey !== prevWeekLabel) {
      weekIndex += 1;
      positionInWeek = 0;
      prevWeekLabel = weekKey;
      started = true;
    } else {
      positionInWeek += 1;
    }

    let dayIndex: number;
    if (spec.weekday != null) {
      dayIndex = spec.weekday;
    } else {
      if (positionInWeek >= opts.weekdays.length) {
        throw new Error(
          `materializeProgram: program-week '${weekKey}' has more sessions than the ${opts.weekdays.length}-day schedule can seat`,
        );
      }
      dayIndex = opts.weekdays[positionInWeek]!;
    }

    const engineRx = engine.prescribe(instance, spec.ref, ctx);
    const sessionAssistance = opts.assistance?.(spec.ref);
    const { prescription, skipped } = adaptSessionPrescription(
      engineRx,
      resolveMovement,
      sessionAssistance,
    );
    const prescriptionWithRef: Prescription = { ...prescription, programRef: spec.ref };
    // ADR 0048 — optional TB accessories: appended after the main work on training
    // sessions only, and counted toward modality/load below.
    if (opts.accessories && spec.kind === "training") {
      const extra = opts.accessories(spec.ref);
      if (extra.length > 0) {
        prescriptionWithRef.items = [...prescriptionWithRef.items, ...extra];
      }
    }
    const { modality, load } = stampModality(prescriptionWithRef);
    if (skipped.length > 0) allSkipped.push(...skipped);

    sessions.push({
      ref: spec.ref,
      weekIndex,
      dayIndex,
      slot: "single",
      title: spec.label,
      role: roleForKind(spec.kind),
      prescription: prescriptionWithRef,
      sessionModality: modality,
      effectiveStressLoad: load,
      skipped,
    });
  }

  return { sessions, weeks: weekIndex + 1, skipped: allSkipped };
}
