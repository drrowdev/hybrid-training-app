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
  SessionPrescription,
  PrescribedItemKind,
} from "@hta/program-core";
import type { Prescription, PrescriptionItem } from "@hta/db";
import { adaptSessionPrescription, type MovementResolver, type SkippedItem } from "./adapter";
import type { AssistancePlanner } from "./assistance-resolver";
import type { TbAccessoryInjector } from "./tb-accessories";
import {
  activationSessionConfigs,
  activationRehabAssignments,
  activationRehabProtocols,
  isTbActivationCustomization,
  isTbActivationCustomizationV2,
  isTbCustomizationV1,
  type TbCustomization,
} from "./tb-customization";
import { activationPhaseForWeek } from "@hta/tacticalbarbell";
import {
  classifySessionModality,
  effectiveStressLoad,
  type ClassifierMovement,
  type SessionModality,
} from "../planner/session-modality";
import { expandPrescriptionSets } from "@/lib/planner/expand-prescription-sets";
import { embedRehabPrescription } from "./rehab-composition";

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
  /**
   * Optional 0-based program-week to begin materialising from (the "start point"
   * feature). Program-weeks with an index < `startWeekIndex` are skipped, and the
   * emitted `weekIndex` is rebased so the chosen week lands on `startedOn`
   * (weekIndex 0). Omitted / 0 ⇒ the whole program from the beginning
   * (byte-identical to the prior behaviour). Engine refs are NOT rebased — they
   * stay absolute to the engine timeline, so position-independent progression
   * (e.g. 5/3/1 TM-test / Anchor recs) is preserved when starting mid-program.
   */
  startWeekIndex?: number;
  /**
   * Optional weekdays (0 = Monday … 6 = Sunday) on which to add an OPEN cardio
   * day — a reserved `cardio_external` placeholder the user fills by logging any
   * cardio (or which links an already-logged activity when the block is
   * `cardio_source='external'`). One placeholder is emitted per listed weekday in
   * every materialised program-week. Used by strength-only programs (5/3/1, TB)
   * where cardio isn't engine-owned; the concurrent programs (Hybrid, Green
   * Protocol) derive their own cardio and never pass this. A cardio weekday that
   * collides with a strength session in the same week is skipped.
   */
  cardioWeekdays?: number[];
  /**
   * The noun for main-lift "% of working-max" labels — "1RM" for programs that
   * load off the true 1RM (Tactical Barbell, Green Protocol, HYROX) or "TM" for
   * 5/3/1. Threaded to the adapter so plan/preview surfaces label the basis
   * correctly. Defaults to "TM".
   */
  mainLiftBasisLabel?: "TM" | "1RM";
  /** Versioned Tactical Barbell overlay. Omitted preserves canonical output. */
  customization?: TbCustomization;
}

export interface MaterializedSession {
  /** Engine ref (stable within the instance) — handy for linking/debugging. */
  ref: string;
  /** 0-based program-week index (drives `dayDate`). */
  weekIndex: number;
  /** Weekday offset within the week, 0 = Monday (drives `dayDate`). */
  dayIndex: number;
  /** Two-a-day slot. "single" for a one-session day; "am"/"pm" for a paired day. */
  slot: "single" | "am" | "pm";
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

function roleForPrescription(
  kind: PlannedSessionSpec["kind"],
  prescription: Prescription,
): string {
  if (
    kind === "training" &&
    prescription.items.length > 0 &&
    prescription.items.every((item) => item.kind.startsWith("cardio_"))
  ) {
    return "cardio";
  }
  return roleForKind(kind);
}

/**
 * Derive a clean, content-first session title from the engine's prescription.
 * Strength days name the working lifts ("Squat · Bench · Deadlift"); conditioning
 * days name the activity ("Easy Run"); a note-only session uses the note name
 * ("Deload"). The engine's `SessionPrescription` already carries GENERIC movement
 * names (e.g. "Squat", not the user's "Front Squat" variant), so the title stays
 * short. Returns undefined when nothing nameable is present (caller falls back).
 */
const TITLE_MAIN_KINDS: ReadonlySet<PrescribedItemKind> = new Set([
  "main",
  "amrap",
]);
const TITLE_CARDIO_KINDS: ReadonlySet<PrescribedItemKind> = new Set([
  "cardio",
  "conditioning",
]);

function distinctNames(rx: SessionPrescription, kinds: ReadonlySet<PrescribedItemKind>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of rx.items) {
    if (!kinds.has(it.kind)) continue;
    const name = it.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function deriveSessionTitle(rx: SessionPrescription): string | undefined {
  const lifts = distinctNames(rx, TITLE_MAIN_KINDS);
  if (lifts.length > 0) return lifts.join(" · ");
  const cardio = distinctNames(rx, TITLE_CARDIO_KINDS);
  if (cardio.length > 0) return cardio.join(" · ");
  const note = rx.items.find((it) => it.kind === "note" && it.name?.trim());
  return note?.name?.trim() || undefined;
}

/**
 * Append a glanceable load cue to a session title:
 *   - strength days → the top working-set intensity ("Squat · Deadlift · OHP · 75%").
 *     This is the program's own basis — % of Training Max for 5/3/1, % of 1RM for
 *     Tactical Barbell / Green Protocol / HYROX — so it reads as "how heavy today".
 *     Percentage (not absolute kg) keeps it short and unit-preference-safe.
 *   - cardio days with a duration target → the minutes ("Easy Run · 40 min").
 * Interval/circuit/compromised cardio (prescribed in rounds, no single duration)
 * and effort-based lifts (no 1RM on file, no %) get nothing.
 */
function topWorkingPercent(rx: SessionPrescription): number | undefined {
  let max: number | undefined;
  for (const it of rx.items) {
    if ((it.kind === "main" || it.kind === "amrap") && typeof it.percentOfTm === "number") {
      max = max == null ? it.percentOfTm : Math.max(max, it.percentOfTm);
    }
  }
  return max;
}

function primaryDurationMin(rx: SessionPrescription): number | undefined {
  let best: number | undefined;
  for (const it of rx.items) {
    if (
      (it.kind === "cardio" || it.kind === "conditioning") &&
      typeof it.durationSec === "number" &&
      it.durationSec > 0
    ) {
      best = best == null ? it.durationSec : Math.max(best, it.durationSec);
    }
  }
  return best == null ? undefined : Math.round(best / 60);
}

function enrichTitle(base: string, rx: SessionPrescription): string {
  const hasMain = rx.items.some((it) => it.kind === "main" || it.kind === "amrap");
  if (hasMain) {
    const pct = topWorkingPercent(rx);
    return pct != null ? `${base} · ${Math.round(pct * 100)}%` : base;
  }
  const min = primaryDurationMin(rx);
  return min != null ? `${base} · ${min} min` : base;
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

  const startWeek = Math.max(0, Math.trunc(opts.startWeekIndex ?? 0));
  let programWeekIndex = -1;
  let positionInWeek = 0;
  let prevWeekLabel: string | undefined;
  let started = false;
  let maxEmittedWeek = -1;
  const activationConfigs =
    opts.customization &&
    isTbActivationCustomization(opts.customization)
      ? activationSessionConfigs(opts.customization)
      : null;

  for (const spec of timeline) {
    if (spec.kind === "rest") continue;

    const weekKey = spec.weekLabel ?? `__idx${spec.index}`;
    if (!started || weekKey !== prevWeekLabel) {
      programWeekIndex += 1;
      positionInWeek = 0;
      prevWeekLabel = weekKey;
      started = true;
    } else {
      positionInWeek += 1;
    }

    // Start-point: skip whole program-weeks before the chosen start, and rebase
    // the emitted week so the chosen week is weekIndex 0 (lands on startedOn).
    if (programWeekIndex < startWeek) continue;
    const weekIndex = programWeekIndex - startWeek;
    if (weekIndex > maxEmittedWeek) maxEmittedWeek = weekIndex;
    const activationConfig =
      activationConfigs && spec.seriesKey
        ? activationConfigs[spec.seriesKey]
        : undefined;
    if (activationConfig && !activationConfig.enabled) continue;

    let dayIndex: number;
    if (activationConfig) {
      dayIndex = activationConfig.day;
    } else if (spec.weekday != null) {
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
      opts.mainLiftBasisLabel,
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

    // A two-a-day day (ADR 0054): the engine attaches a PM companion to the spec.
    // The primary takes slot "am" and the companion a second "pm" row on the same
    // weekday — reusing the (week, day, slot) machinery Hybrid already uses.
    const hasSecond = spec.secondSession != null;

    sessions.push({
      ref: spec.ref,
      weekIndex,
      dayIndex,
      slot: hasSecond ? "am" : "single",
      // Clean, content-first title (the program / week / day context lives in the
      // page chrome) plus a glanceable load cue — the working % for strength, the
      // duration for timed cardio.
      title: enrichTitle(spec.title ?? deriveSessionTitle(engineRx) ?? spec.label, engineRx),
      role: roleForPrescription(spec.kind, prescriptionWithRef),
      prescription: prescriptionWithRef,
      sessionModality: modality,
      effectiveStressLoad: load,
      skipped,
    });

    if (spec.secondSession) {
      const pmRef = spec.secondSession.ref;
      const pmRx = engine.prescribe(instance, pmRef, ctx);
      const { prescription: pmPrescription, skipped: pmSkipped } = adaptSessionPrescription(
        pmRx,
        resolveMovement,
        opts.assistance?.(pmRef),
        opts.mainLiftBasisLabel,
      );
      const pmWithRef: Prescription = { ...pmPrescription, programRef: pmRef };
      const { modality: pmModality, load: pmLoad } = stampModality(pmWithRef);
      if (pmSkipped.length > 0) allSkipped.push(...pmSkipped);
      sessions.push({
        ref: pmRef,
        weekIndex,
        dayIndex,
        slot: "pm",
        title: enrichTitle(
          spec.secondSession.title ?? deriveSessionTitle(pmRx) ?? pmRef,
          pmRx,
        ),
        role: roleForPrescription("training", pmWithRef),
        prescription: pmWithRef,
        sessionModality: pmModality,
        effectiveStressLoad: pmLoad,
        skipped: pmSkipped,
      });
    }
  }

  // Open cardio days (strength-only programs): one reserved cardio_external
  // placeholder per requested weekday, in every materialised program-week. Skips
  // any weekday already occupied by a strength session that week so the
  // (week, day, slot) grid stays collision-free.
  const cardioDays = [
    ...new Set(
      (opts.customization && !isTbCustomizationV1(opts.customization)
        ? []
        : opts.cardioWeekdays ?? []
      ).map((d) => Math.trunc(d)),
    ),
  ]
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => a - b);
  if (cardioDays.length > 0 && maxEmittedWeek >= 0) {
    const taken = new Set(sessions.map((s) => `${s.weekIndex}-${s.dayIndex}`));
    for (let wk = 0; wk <= maxEmittedWeek; wk++) {
      for (const day of cardioDays) {
        if (taken.has(`${wk}-${day}`)) continue;
        const ref = `cardio-w${wk}-d${day}`;
        const isCustomizedConditioning = opts.customization != null;
        const prescription: Prescription = {
          items: [openCardioItem(isCustomizedConditioning ? "Conditioning" : "Cardio")],
          programRef: ref,
        };
        const { modality, load } = stampModality(prescription);
        sessions.push({
          ref,
          weekIndex: wk,
          dayIndex: day,
          slot: "single",
          title: isCustomizedConditioning ? "Conditioning" : "Cardio",
          role: "cardio",
          prescription,
          sessionModality: modality,
          effectiveStressLoad: load,
          skipped: [],
        });
      }
    }
  }

  const legacyRehabItems =
    opts.customization && isTbCustomizationV1(opts.customization)
      ? opts.customization.rehab?.items ?? []
      : [];
  const activationProtocols =
    opts.customization && isTbActivationCustomization(opts.customization)
      ? activationRehabProtocols(opts.customization)
      : [];
  const usesLegacyActivationRehab =
    opts.customization != null &&
    isTbActivationCustomizationV2(opts.customization);
  const activationProtocolById = new Map(
    activationProtocols.map((protocol) => [protocol.id, protocol]),
  );
  if (
    (legacyRehabItems.length > 0 || activationProtocols.length > 0) &&
    maxEmittedWeek >= 0
  ) {
    const takenSlots = new Set(
      sessions.map(
        (session) =>
          `${session.weekIndex}-${session.dayIndex}-${session.slot}`,
      ),
    );
    for (let weekIndex = 0; weekIndex <= maxEmittedWeek; weekIndex++) {
      const rehabAssignments =
        opts.customization && isTbCustomizationV1(opts.customization)
          ? opts.customization.dayTypes.flatMap((type, day) =>
              type === "rehab"
                ? [
                    {
                      day,
                      protocolId: null,
                      protocolName: "Rehab",
                      items: legacyRehabItems,
                    },
                  ]
                : [],
            )
          : opts.customization &&
              isTbActivationCustomization(opts.customization)
            ? (() => {
                const absoluteWeek =
                  ((startWeek + weekIndex) % 25) + 1;
                const phase = activationPhaseForWeek(absoluteWeek);
                if (!phase) return [];
                return activationRehabAssignments(
                  opts.customization,
                  phase,
                ).map((assignment) => {
                  const protocol = activationProtocolById.get(
                    assignment.protocolId,
                  );
                  if (!protocol) {
                    throw new Error(
                      `materializeProgram: rehab protocol '${assignment.protocolId}' is missing`,
                    );
                  }
                  return {
                    day: assignment.day,
                    protocolId: usesLegacyActivationRehab
                      ? null
                      : protocol.id,
                    protocolName: usesLegacyActivationRehab
                      ? "Rehab"
                      : protocol.name,
                    items: protocol.items,
                  };
                });
              })()
            : [];
      for (const assignment of rehabAssignments) {
        const dayIndex = assignment.day;
        const ref = assignment.protocolId
          ? `rehab-${assignment.protocolId}-w${weekIndex}-d${dayIndex}`
          : `rehab-w${weekIndex}-d${dayIndex}`;
        const prescription: Prescription = {
          programRef: ref,
          items: assignment.items.map((item): PrescriptionItem => {
            const sideCue =
              item.side === "left"
                ? "Left side"
                : item.side === "right"
                  ? "Right side"
                  : "";
            const instructions = [sideCue, item.instructions]
              .filter(Boolean)
              .join(" · ");
            return {
              movementId: item.movementId,
              movementName: item.movementName,
              kind: "tendon",
              sets: item.sets,
              ...(item.reps != null ? { reps: item.reps } : {}),
              ...(item.holdSeconds != null
                ? { holdSec: { min: item.holdSeconds, max: item.holdSeconds } }
                : {}),
              ...(item.targetWeightKg != null
                ? { targetWeightKg: item.targetWeightKg }
                : {}),
              ...(instructions
                ? {
                    notes: instructions,
                    intensityCue: instructions.slice(0, 80),
                  }
                : {}),
              meta: {
                rehab: true,
                rehabProtocolId: assignment.protocolId,
                rehabProtocolName: assignment.protocolName,
                rehabSourceRef: ref,
                rehabPlacement: "during_warmup",
                ...(item.side ? { side: item.side } : {}),
              },
            };
          }),
        };
        const expandedPrescription = expandPrescriptionSets(prescription);
        const strengthSession = sessions.find(
          (session) =>
            session.weekIndex === weekIndex &&
            session.dayIndex === dayIndex &&
            session.role === "strength",
        );
        if (strengthSession) {
          strengthSession.prescription = embedRehabPrescription(
            strengthSession.prescription,
            expandedPrescription.items,
            {
              protocolId: assignment.protocolId,
              protocolName: assignment.protocolName,
              sourceRef: ref,
            },
          );
          continue;
        }

        const dayHasSession = sessions.some(
          (session) =>
            session.weekIndex === weekIndex &&
            session.dayIndex === dayIndex,
        );
        // Cardio + rehab and rehab-only days remain independent sessions.
        // `pm` is only a collision key here, not an inferred training time.
        const slot = dayHasSession ? "pm" : "single";
        if (takenSlots.has(`${weekIndex}-${dayIndex}-${slot}`)) {
          throw new Error(
            `materializeProgram: rehab slot '${slot}' on day ${dayIndex} collides in week ${weekIndex + 1}`,
          );
        }
        sessions.push({
          ref,
          weekIndex,
          dayIndex,
          slot,
          title:
            assignment.protocolName === "Rehab"
              ? "Rehab"
              : `Rehab · ${assignment.protocolName}`,
          role: "rehab",
          prescription: expandedPrescription,
          sessionModality: "restorative",
          effectiveStressLoad: 0,
          skipped: [],
        });
        takenSlots.add(`${weekIndex}-${dayIndex}-${slot}`);
      }
    }
  }

  return { sessions, weeks: maxEmittedWeek + 1, skipped: allSkipped };
}

/**
 * The single placeholder item for an OPEN cardio day. `movementId: ""` is the
 * app's `cardio_external` sentinel; the read side classifies a session as cardio
 * when every item is `cardio_*`, and the user links a same-day logged activity
 * to a `cardio_external` placeholder (block `cardio_source='external'`).
 */
function openCardioItem(label = "Cardio"): PrescriptionItem {
  return {
    movementId: "",
    kind: "cardio_external",
    intensityLabel: label,
    protocolNote: `Open ${label.toLowerCase()} — log any run, row, ride or other cardio. Log it here, or link an activity you already recorded externally.`,
  };
}
