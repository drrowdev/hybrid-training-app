/**
 * Program-instance write builder — the pure orchestration behind the
 * `createProgramInstance` server action.
 *
 * Given a set-up engine instance + the platform context, it produces everything
 * the action needs to persist a deployable program, WITHOUT touching the DB:
 *   - the materialised planned sessions (via `materializeProgram`)
 *   - the block shape (weeks + days/week)
 *   - the per-movement `tm_percent` alignment to seed on `training_maxes` so the
 *     existing "% of TM" renderer shows the engine's exact working weights
 *     (`computeTmAlignment`, mapped from engine keys back to movement ids)
 *
 * Keeping this pure means the whole deploy computation is unit-tested against the
 * real engines with no Supabase. The action is then a thin guarded DB wrapper.
 */
import type { ProgramEngine, PlatformContext } from "@hta/program-core";
import { materializeProgram, type MaterializedSession } from "./materialize";
import type { MovementResolver, SkippedItem } from "./adapter";
import type { AssistancePlanner } from "./assistance-resolver";
import type { TbAccessoryInjector } from "./tb-accessories";
import { computeTmAlignment } from "./tm-alignment";
import type { TbCustomization } from "./tb-customization";
import type { SessionLink } from "./session-links";
import type { RehabSchedule } from "./rehab-schedule";

export interface BuildProgramInstanceArgs<I> {
  engine: ProgramEngine<I>;
  instance: I;
  ctx: PlatformContext;
  resolveMovement: MovementResolver;
  /** Strength weekdays (0 = Mon … 6 = Sun) the program-week's sessions sit on. */
  weekdays: number[];
  /** Block start date (YYYY-MM-DD). */
  startedOn: string;
  /** Optional 5/3/1 assistance planner (ADR 0047) threaded to materialisation. */
  assistance?: AssistancePlanner;
  /** Optional TB accessory injector (ADR 0048) threaded to materialisation. */
  accessories?: TbAccessoryInjector;
  /** Optional 0-based program-week to begin from (start-point feature). */
  startWeekIndex?: number;
  /** Optional open-cardio weekdays (0 = Mon … 6 = Sun) for strength-only programs. */
  cardioWeekdays?: number[];
  customization?: TbCustomization;
  /**
   * User-authored links by series key. Threaded through to materialisation so
   * the `rehab.<protocolId>` entries can be realised on the rehab prescription
   * — strength links travel inside the engine instance instead.
   */
  sessionLinks?: Readonly<Record<string, readonly SessionLink[]>>;
  /** Where a weekly Tactical Barbell block runs its rehab protocol. */
  rehabSchedule?: RehabSchedule;
}

/** A `training_maxes.tm_percent` seed for one anchored movement. */
export interface TmPercentSeed {
  movementId: string;
  tmPercent: number;
}

export interface ProgramInstanceWrite {
  /** Total program-week count → `training_blocks.weeks`. */
  weeks: number;
  /** Strength days per week → `training_blocks.days_per_week`. */
  daysPerWeek: number;
  /** Day layout for `training_blocks.day_index_overrides`. */
  dayIndexOverrides: { days: number[]; twoADay: boolean };
  /** Materialised planned sessions (one row each). */
  sessions: MaterializedSession[];
  /** Per-movement TM% to seed on `training_maxes`. */
  tmPercents: TmPercentSeed[];
  /** Items the adapter could not map (diagnostics). */
  skipped: SkippedItem[];
}

/**
 * Build the full set of rows/updates for deploying a program instance. Pure: no
 * DB, no React. Throws (via `materializeProgram`) if the schedule can't seat a
 * program-week.
 */
export function buildProgramInstanceWrite<I>(
  args: BuildProgramInstanceArgs<I>,
): ProgramInstanceWrite {
  const { engine, instance, ctx, resolveMovement, weekdays, assistance, accessories, startWeekIndex, cardioWeekdays, customization, sessionLinks, rehabSchedule } = args;

  // The working-max basis the program loads off (Option A seeds it onto
  // training_maxes.tm_percent). A program loads straight off the true 1RM when
  // every anchored main lift's basis is 100 (Tactical Barbell, Green Protocol,
  // HYROX); 5/3/1 loads off a real Training Max (< 100). Derive the label noun
  // so plan/preview surfaces read "% 1RM" vs "% TM" correctly.
  const alignment = computeTmAlignment(engine.meta.family, instance, ctx.oneRepMaxes);
  const alignmentValues = Object.values(alignment).filter((v): v is number => v != null);
  const loadsOffOneRm =
    alignmentValues.length === 0 || alignmentValues.every((v) => v === 100);
  const mainLiftBasisLabel: "TM" | "1RM" = loadsOffOneRm ? "1RM" : "TM";

  const { sessions, weeks, skipped } = materializeProgram(
    engine,
    instance,
    ctx,
    resolveMovement,
    {
      weekdays,
      mainLiftBasisLabel,
      ...(assistance ? { assistance } : {}),
      ...(accessories ? { accessories } : {}),
      ...(startWeekIndex != null ? { startWeekIndex } : {}),
      ...(cardioWeekdays && cardioWeekdays.length > 0 ? { cardioWeekdays } : {}),
      ...(customization ? { customization } : {}),
      ...(sessionLinks ? { sessionLinks } : {}),
      ...(rehabSchedule ? { rehabSchedule } : {}),
    },
  );

  // Seed tm_percent so the engine's percentOfTm renders the right load (Option A).
  const tmPercents: TmPercentSeed[] = [];
  for (const [engineKey, tmPercent] of Object.entries(alignment)) {
    if (tmPercent == null) continue;
    const resolved = resolveMovement(engineKey);
    if (!resolved) continue; // user hasn't anchored this lift — nothing to seed
    tmPercents.push({ movementId: resolved.movementId, tmPercent });
  }

  return {
    weeks,
    daysPerWeek: weekdays.length,
    dayIndexOverrides: { days: [...weekdays], twoADay: false },
    sessions,
    tmPercents,
    skipped,
  };
}
