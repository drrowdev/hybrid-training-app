"use server";

/**
 * createProgramInstance — deploy a platform program for the signed-in user.
 *
 * This is the write path that replaces the archetype `createBlock` for platform
 * programs. It is intentionally NOT wired to any UI yet (the program picker
 * lands in a later PR); shipping it standalone keeps the change reviewable and
 * means no platform block can be created in prod until the picker is wired.
 *
 * Flow (all under the signed-in user's RLS — never the service role):
 *   buildPlatformContext  → engine.setup → buildProgramInstanceWrite
 *   → insert training_blocks → insert planned_sessions
 *   → seed training_maxes.tm_percent → insert program_instances
 *   → archive any prior active block + program instance.
 *
 * Guardrails: explicit auth check, Zod `.strict()` on input, user-scoped client,
 * and best-effort cleanup so a partial failure never leaves an orphan block.
 *
 * A platform block stores its identity in `training_blocks.program_id` /
 * `program_family` (archetype is left NULL); `program_instances` links to it via
 * `block_id` and holds the serialised engine instance.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { programSegments, type PlatformContext, type ProgramEngine } from "@hta/program-core";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { ARCHETYPES } from "@/lib/planner/archetypes";
import type { HybridInstance } from "@/lib/programs/hybrid/engine";
import { resolveHybridTmPercent } from "@/lib/programs/hybrid/engine";
import { buildPlatformContext } from "./context";
import { getProgramEngine, getNativeProgramEngine, isNativeProgram } from "./registry";
import { buildProgramInstanceWrite, type ProgramInstanceWrite } from "./program-instance";
import { buildAssistancePlanner, type AssistancePlanner } from "./assistance-resolver";
import { loadPickerCatalog } from "@/lib/planner/picker-catalog";
import { readLimitationsContext } from "@/lib/planner/limitations-context";
import { resolveDeclaredExperience } from "@/lib/planner/build-block-assembly-context";
import { greenStrengthTemplateByRef, type GreenInstance } from "@hta/green";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import type { MovementResolver } from "./adapter";
import {
  buildTbAccessoryInjector,
  tbAccessoryPlanForTemplate,
  resolveTbAccessoryMuscles,
  type TbAccessoryInjector,
} from "./tb-accessories";
import { discardAbandonedInProgressSessions } from "@/lib/planner/archive-prior-blocks";
import { activateSeasonBlock } from "@/lib/seasons/activation";
import { planForwardOnlyRewrite } from "./forward-rewrite";
import { todayYmd, mondayOfYmd, daysBetweenYmd } from "@/lib/dates";

const WEEKDAY = z.number().int().min(0).max(6);

/**
 * Strength-only foreign programs whose cardio isn't engine-owned, so the wizard
 * may add OPEN cardio days (a reserved cardio_external placeholder per day). The
 * concurrent programs (Hybrid native, Green Protocol / HYROX fixed-schedule)
 * derive their own cardio and never accept wizard cardio days.
 */
const STRENGTH_ONLY_PROGRAM_IDS = new Set<string>(["wendler-531", "tactical-barbell"]);

/** Whole weeks from `startIso` to `endIso` (YYYY-MM-DD), min 1. Drives HYROX weeks-to-race. */
function wholeWeeksBetween(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  const days = Math.round((end - start) / 86_400_000);
  return Math.max(1, Math.ceil(days / 7));
}

const createProgramInstanceSchema = z
  .object({
    programId: z.string().min(1),
    /** Engine setup values (template, cycle structure, …) — engine-specific. */
    setupValues: z.record(z.unknown()).default({}),
    /** Strength weekdays (0 = Mon … 6 = Sun), one per session in a program-week. */
    weekdays: z.array(WEEKDAY).min(1).max(7),
    /** Optional open-cardio weekdays (0 = Mon … 6 = Sun) for strength-only programs. */
    cardioWeekdays: z.array(WEEKDAY).max(7).optional(),
    /** Block start date, YYYY-MM-DD. */
    startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startedOn must be YYYY-MM-DD"),
    /** Optional target race date (YYYY-MM-DD) — HYROX derives weeks-to-race + an A-event. */
    raceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "raceDate must be YYYY-MM-DD").optional(),
    /** Optional 0-based program-week to begin from (start-point feature). */
    startWeekIndex: z.number().int().nonnegative().optional(),
    /** Plate rounding override (kg); defaults to 2.5. */
    roundingKg: z.number().positive().optional(),
    /** Optional TB accessory work (ADR 0048) — opt-in, ignored by other programs. */
    accessories: z
      .object({
        enabled: z.boolean(),
        muscles: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    /** Per-block two-a-day preference (migration 0110) — Hybrid only; foreign programs ignore it. */
    twoADay: z.boolean().optional(),
    /** Per-block antagonist-superset accessories (migration 0111) — applies to ALL programs. */
    supersetAccessories: z.boolean().optional(),
    /** When present, this deploy is a forward-only EDIT of an existing active
     *  block (5/3/1 / Tactical Barbell only): keep the same block + program
     *  instance, freeze past + current week, regenerate only future weeks. */
    editBlockId: z.string().uuid().optional(),
    /** When present, the wizard was deep-linked from a Season roadmap (ADR 0051):
     *  activate this planned season_block + link it to the new block on deploy. */
    seasonBlockId: z.string().uuid().optional(),
  })
  .strict();

export type CreateProgramInstanceInput = z.input<typeof createProgramInstanceSchema>;

export type CreateProgramInstanceResult =
  | { ok: true; blockId: string; programInstanceId: string; skipped: number }
  | { ok: false; error: string };

export async function createProgramInstance(
  input: CreateProgramInstanceInput,
): Promise<CreateProgramInstanceResult> {
  const parsed = createProgramInstanceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { programId, setupValues, weekdays, cardioWeekdays, startedOn, raceDate, startWeekIndex, roundingKg, accessories, twoADay, supersetAccessories, editBlockId, seasonBlockId } = parsed.data;

  // Reject duplicate weekdays — they'd collide on the (week, day, slot) unique key.
  // (Native programs own their own calendar and ignore `weekdays`, but the check
  // is harmless and keeps the input contract uniform.)
  if (new Set(weekdays).size !== weekdays.length) {
    return { ok: false, error: "Training weekdays must be distinct." };
  }

  // Open cardio days only apply to strength-only foreign programs (5/3/1, TB),
  // where cardio isn't engine-owned. They must not double up on a strength day.
  const cardioDays = (cardioWeekdays ?? []).filter((d) => !weekdays.includes(d));
  const cardioForProgram = STRENGTH_ONLY_PROGRAM_IDS.has(programId) ? cardioDays : [];

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Same user-scoped client (RLS) for BOTH paths — never the service role.
  const supabase = await createClient();

  // Forward-only EDIT of an existing block (5/3/1 / TB). Keeps the block + its
  // active program instance, freezes past + current week, regenerates future
  // weeks from the new wizard inputs.
  if (editBlockId) {
    if (!STRENGTH_ONLY_PROGRAM_IDS.has(programId)) {
      return { ok: false, error: "This program can't be edited in place yet." };
    }
    return updateForeignProgramInstance(supabase, user, editBlockId, {
      programId,
      setupValues,
      weekdays,
      startedOn,
      ...(cardioForProgram.length > 0 ? { cardioWeekdays: cardioForProgram } : {}),
      ...(roundingKg != null ? { roundingKg } : {}),
      ...(accessories ? { accessories } : {}),
      ...(supersetAccessories != null ? { supersetAccessories } : {}),
    });
  }

  if (isNativeProgram(programId)) {
    // ADR 0052 — when this Hybrid block is being deployed from a Season block,
    // derive the generator bias from that block's emphasis and pass it through
    // the wizard values so `setupHybrid` picks it up. Non-Season Hybrid deploys
    // (no seasonBlockId) inject nothing ⇒ byte-identical.
    let nativeSetupValues = setupValues;
    if (seasonBlockId) {
      const { data: sb } = await supabase
        .from("season_blocks")
        .select("emphasis")
        .eq("id", seasonBlockId)
        .eq("user_id", user.id)
        .maybeSingle();
      const emphasis = sb?.emphasis as string | undefined;
      const seasonBias =
        emphasis === "endurance_bias"
          ? "endurance"
          : emphasis === "strength_bias"
            ? "strength"
            : null;
      if (seasonBias) nativeSetupValues = { ...setupValues, seasonBias };
    }
    return createNativeProgramInstance(supabase, user, {
      programId,
      setupValues: nativeSetupValues,
      weekdays,
      startedOn,
      ...(roundingKg != null ? { roundingKg } : {}),
      ...(twoADay != null ? { twoADay } : {}),
      ...(supersetAccessories != null ? { supersetAccessories } : {}),
      ...(seasonBlockId ? { seasonBlockId } : {}),
    });
  }
  return createForeignProgramInstance(supabase, user, {
    programId,
    setupValues,
    weekdays,
    startedOn,
    ...(cardioForProgram.length > 0 ? { cardioWeekdays: cardioForProgram } : {}),
    ...(raceDate ? { raceDate } : {}),
    ...(startWeekIndex != null ? { startWeekIndex } : {}),
    ...(roundingKg != null ? { roundingKg } : {}),
    ...(accessories ? { accessories } : {}),
    ...(supersetAccessories != null ? { supersetAccessories } : {}),
    ...(seasonBlockId ? { seasonBlockId } : {}),
  });
}

/** A selectable program start point for the picker (a phase/block boundary). */
export type ProgramSegmentOption = {
  startWeekIndex: number;
  label: string;
  kind?: string;
};

const programSegmentsSchema = z
  .object({
    programId: z.string().min(1),
    setupValues: z.record(z.unknown()).default({}),
    startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    raceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

export type GetProgramSegmentsInput = z.input<typeof programSegmentsSchema>;

export type GetProgramSegmentsResult =
  | { ok: true; segments: ProgramSegmentOption[] }
  | { ok: false; error: string };

/**
 * Read the structural start points (phases / blocks) for a program, given the
 * loadout the user has picked so far. Powers the Schedule-step "Start point"
 * dropdown. Read-only: builds the engine instance from the setup values (segments
 * are config-driven and don't depend on the user's strength state, so a stub
 * context is sufficient) and returns the engine's typed segments. Native programs
 * (Hybrid) don't expose start points yet, so they return just the beginning.
 */
export async function getProgramSegments(
  input: GetProgramSegmentsInput,
): Promise<GetProgramSegmentsResult> {
  const parsed = programSegmentsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { programId, setupValues, startedOn, raceDate } = parsed.data;

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const beginning: ProgramSegmentOption = { startWeekIndex: 0, label: "From the beginning", kind: "phase" };
  if (isNativeProgram(programId)) {
    return { ok: true, segments: [beginning] };
  }
  const engine = getProgramEngine(programId);
  if (!engine) return { ok: false, error: `Unknown program '${programId}'.` };

  // HYROX shifts its phase boundaries when a race date overrides the week count,
  // so mirror the deploy-time weeks-to-race override before reading segments.
  const hyroxWeeksToRace =
    programId === "hyrox" && raceDate && startedOn ? wholeWeeksBetween(startedOn, raceDate) : null;

  try {
    const ctx: PlatformContext = { oneRepMaxes: {}, roundingKg: 2.5 };
    const instance = engine.setup(
      {
        values: {
          ...setupValues,
          ...(hyroxWeeksToRace != null ? { weeks: hyroxWeeksToRace } : {}),
        },
      },
      ctx,
    );
    const segments = programSegments(engine, instance).map((s) => ({
      startWeekIndex: s.startWeekIndex,
      label: s.label,
      ...(s.kind ? { kind: s.kind } : {}),
    }));
    return { ok: true, segments };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to compute start points" };
  }
}

/** Parsed, validated deploy input shared by both write paths. */
interface DeployArgs {
  programId: string;
  setupValues: Record<string, unknown>;
  weekdays: number[];
  cardioWeekdays?: number[];
  startedOn: string;
  raceDate?: string;
  startWeekIndex?: number;
  roundingKg?: number;
  accessories?: { enabled: boolean; muscles?: string[] };
  /** Per-block two-a-day preference (migration 0110) — Hybrid/native only. */
  twoADay?: boolean;
  /** Per-block antagonist-superset accessories (migration 0111) — all programs. */
  supersetAccessories?: boolean;
  /** When the wizard was deep-linked from a Season roadmap (ADR 0051) — the
   *  planned season_block to activate + link to the new training block on deploy. */
  seasonBlockId?: string;
}

/**
 * Build the 5/3/1 assistance planner (ADR 0047) for the foreign deploy path:
 * load the global movement catalog, the user's equipment + active limitations,
 * and exclude the user's anchored main lifts (you don't program bench as bench
 * assistance). Returns `undefined` when the catalog can't be loaded so the deploy
 * still succeeds (assistance intent simply stays unresolved / skipped).
 */
async function buildForeignAssistancePlanner(
  supabase: SupabaseClient,
  userId: string,
  resolveMovement: MovementResolver,
  applyExperienceGate: boolean,
): Promise<AssistancePlanner | undefined> {
  const catalog = await loadPickerCatalog(supabase);
  if (catalog.length === 0) return undefined;

  const limitations = await readLimitationsContext(supabase, userId);
  const { data: profile } = await supabase
    .from("profiles")
    .select("equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, training_experience")
    .eq("id", userId)
    .maybeSingle();
  const equipment = resolveEquipment(profile);
  // Experience unlock floor — gated only for programs that should honour the
  // user's declared tier (5/3/1). HYROX passes `applyExperienceGate = false`
  // because it collects its own per-block experience in the wizard (design N1).
  const experience = applyExperienceGate
    ? resolveDeclaredExperience(profile?.training_experience)
    : null;

  // Never resolve assistance to one of the program's own main lifts.
  const excludeMovementIds = new Set<string>();
  for (const key of ["squat", "bench", "deadlift", "press"]) {
    const resolved = resolveMovement(key);
    if (resolved) excludeMovementIds.add(resolved.movementId);
  }

  return buildAssistancePlanner({
    catalog,
    equipment,
    filters: {
      blockedRegions: limitations.blockedRegions,
      blockedMuscles: limitations.blockedMuscles,
      blockedMovementIds: limitations.blockedMovementIds,
      allowedMovementIds: limitations.allowedMovementIds,
    },
    excludeMovementIds,
    experience,
  });
}

/**
 * Build the optional TB accessory injector (ADR 0048) for the foreign deploy path.
 * Returns `undefined` when accessories aren't enabled, the template isn't eligible
 * (Zulu/Operator/Fighter only), or the catalog can't be loaded — so the TB default
 * (no accessories) is preserved.
 */
async function buildForeignTbAccessoryInjector(
  supabase: SupabaseClient,
  userId: string,
  resolveMovement: MovementResolver,
  templateId: string,
  accessories: { enabled: boolean; muscles?: string[] } | undefined,
): Promise<TbAccessoryInjector | undefined> {
  if (!accessories?.enabled) return undefined;
  const plan = tbAccessoryPlanForTemplate(templateId);
  if (!plan) return undefined;

  const catalog = await loadPickerCatalog(supabase);
  if (catalog.length === 0) return undefined;

  const limitations = await readLimitationsContext(supabase, userId);
  const { data: profile } = await supabase
    .from("profiles")
    .select("equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, training_experience")
    .eq("id", userId)
    .maybeSingle();
  const equipment = resolveEquipment(profile);
  const experience = resolveDeclaredExperience(profile?.training_experience);

  // Don't resolve an accessory to one of the cluster's main lifts.
  const excludeMovementIds = new Set<string>();
  for (const key of ["squat", "bench", "deadlift", "press", "row", "chinup", "pullup"]) {
    const resolved = resolveMovement(key);
    if (resolved) excludeMovementIds.add(resolved.movementId);
  }

  return buildTbAccessoryInjector({
    catalog,
    equipment,
    filters: {
      blockedRegions: limitations.blockedRegions,
      blockedMuscles: limitations.blockedMuscles,
      blockedMovementIds: limitations.blockedMovementIds,
      allowedMovementIds: limitations.allowedMovementIds,
    },
    muscles: resolveTbAccessoryMuscles(accessories.muscles),
    maxItems: plan.maxItems,
    setsPerItem: plan.setsPerItem,
    excludeMovementIds,
    experience,
  });
}

/**
 * Build the optional Green Protocol accessory injector. GP is periodised across
 * multiple TB templates, so — unlike TB's single fixed-template injector — the
 * cap is resolved PER SESSION from the green plan's `ref → TB-template` map:
 *   - strength session → its template's cap (Zulu-HT 3, Operator/Fighter 2)
 *   - conditioning / deload / test / rest session → `null` ⇒ no accessories
 * Inherits the same experience unlock floor + equipment/limitation filters as TB.
 * Returns `undefined` when accessories aren't enabled or the catalog can't load.
 */
async function buildForeignGpAccessoryInjector(
  supabase: SupabaseClient,
  userId: string,
  resolveMovement: MovementResolver,
  instance: GreenInstance,
  accessories: { enabled: boolean; muscles?: string[] } | undefined,
): Promise<TbAccessoryInjector | undefined> {
  if (!accessories?.enabled) return undefined;
  const templateByRef = greenStrengthTemplateByRef(instance);
  if (templateByRef.size === 0) return undefined;

  const catalog = await loadPickerCatalog(supabase);
  if (catalog.length === 0) return undefined;

  const limitations = await readLimitationsContext(supabase, userId);
  const { data: profile } = await supabase
    .from("profiles")
    .select("equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, training_experience")
    .eq("id", userId)
    .maybeSingle();
  const equipment = resolveEquipment(profile);
  const experience = resolveDeclaredExperience(profile?.training_experience);

  // Don't resolve an accessory to one of the cluster's main lifts.
  const excludeMovementIds = new Set<string>();
  for (const key of ["squat", "bench", "deadlift", "press", "row", "chinup", "pullup"]) {
    const resolved = resolveMovement(key);
    if (resolved) excludeMovementIds.add(resolved.movementId);
  }

  return buildTbAccessoryInjector({
    catalog,
    equipment,
    filters: {
      blockedRegions: limitations.blockedRegions,
      blockedMuscles: limitations.blockedMuscles,
      blockedMovementIds: limitations.blockedMovementIds,
      allowedMovementIds: limitations.allowedMovementIds,
    },
    muscles: resolveTbAccessoryMuscles(accessories.muscles),
    // Overridden per-session by planForRef; placeholders for the fixed path.
    maxItems: 0,
    setsPerItem: 0,
    planForRef: (ref) => {
      const templateId = templateByRef.get(ref);
      return templateId ? tbAccessoryPlanForTemplate(templateId) : null;
    },
    excludeMovementIds,
    experience,
  });
}

/**
 * Pure(ish) foreign build: engine setup → assistance/accessory resolution →
 * materialised `ProgramInstanceWrite`. Extracted so the create AND the
 * forward-only edit path share ONE build (no drift in engine behaviour).
 * Throws on engine/setup errors; the caller wraps it in a try.
 */
async function computeForeignWrite(
  supabase: SupabaseClient,
  user: User,
  engine: ProgramEngine,
  { programId, setupValues, weekdays, cardioWeekdays, startedOn, raceDate, startWeekIndex, roundingKg, accessories, twoADay }: DeployArgs,
): Promise<{ instance: unknown; write: ProgramInstanceWrite }> {
  // HYROX: a supplied race date overrides the experience block length with the
  // whole weeks from start to race, so the program's end-taper lands on race week
  // (ADR 0050 step 10). Clamping happens in the engine setup.
  const hyroxWeeksToRace =
    programId === "hyrox" && raceDate ? wholeWeeksBetween(startedOn, raceDate) : null;

  // HYROX surfaces gender-correct station loads (men's / women's standards), so
  // read the athlete's competition weight category for the context. Best-effort;
  // NULL falls back to showing both standards to confirm at log time.
  let hyroxGender: "male" | "female" | undefined;
  if (programId === "hyrox") {
    const { data: prof } = await supabase
      .from("profiles")
      .select("gender")
      .eq("id", user.id)
      .maybeSingle();
    if (prof?.gender === "male" || prof?.gender === "female") hyroxGender = prof.gender;
  }

  const { ctx, resolveMovement } = await buildPlatformContext(supabase, user.id, {
    ...(roundingKg != null ? { roundingKg } : {}),
    ...(hyroxGender ? { gender: hyroxGender } : {}),
  });
  // Global accessory-volume preference (profiles.effort_preference:
  // low=Easier / standard=Balanced / high=Harder). 5/3/1 scales its assistance
  // volume by this single global control. Read best-effort; default standard.
  let assistanceVolumePref: "low" | "standard" | "high" = "standard";
  if (programId === "wendler-531") {
    const { data: prof } = await supabase
      .from("profiles")
      .select("effort_preference")
      .eq("id", user.id)
      .maybeSingle();
    const raw = prof?.effort_preference;
    if (raw === "low" || raw === "high") assistanceVolumePref = raw;
  }
  const instance = engine.setup(
    {
      values: {
        ...setupValues,
        // 5/3/1 packs its 4 main lifts across the chosen strength days
        // (4 = one lift/day, 2 = two/day). The frequency is the weekday count
        // picked in the Schedule step, mirrored into setup like Hybrid does.
        ...(programId === "wendler-531" ? { daysPerWeek: weekdays.length } : {}),
        // HYROX is frequency-flexible (3–7): the number of training weekdays
        // picked in the Schedule step IS its sessions/week, mirrored into setup
        // the same way (no separate HYROX frequency field anymore).
        ...(programId === "hyrox" ? { sessionsPerWeek: weekdays.length } : {}),
        // HYROX two-a-day (ADR 0054): the per-block toggle adds easy off-feet PM
        // companions. Mirrored into setup so the engine bakes them into the grid.
        ...(programId === "hyrox" && twoADay ? { twoADay: true } : {}),
        ...(programId === "wendler-531" ? { assistanceVolume: assistanceVolumePref } : {}),
        ...(hyroxWeeksToRace != null ? { weeks: hyroxWeeksToRace } : {}),
      },
    },
    ctx,
  );
  // ADR 0047 — 5/3/1 and HYROX both emit category-tagged assistance intent, so
  // both need the (catalog + equipment + limitation) resolver. TB / Green Protocol
  // emit none and stay byte-identical.
  const assistance =
    programId === "wendler-531" || programId === "hyrox"
      ? await buildForeignAssistancePlanner(
          supabase,
          user.id,
          resolveMovement,
          // 5/3/1 honours the declared experience tier; HYROX is decoupled
          // (it collects its own per-block experience in the wizard).
          programId === "wendler-531",
        )
      : undefined;
  // ADR 0048 — optional, opt-in TB accessory work (Zulu/Operator/Fighter only).
  const tbAccessories =
    programId === "tactical-barbell"
      ? await buildForeignTbAccessoryInjector(
          supabase,
          user.id,
          resolveMovement,
          typeof setupValues.templateId === "string" ? setupValues.templateId : "",
          accessories,
        )
      : undefined;
  // Optional, opt-in Green Protocol accessory work — periodised, capped
  // per-session by each strength session's TB template (conditioning gets none).
  const gpAccessories =
    programId === "green-protocol"
      ? await buildForeignGpAccessoryInjector(
          supabase,
          user.id,
          resolveMovement,
          instance as GreenInstance,
          accessories,
        )
      : undefined;
  const foreignAccessories = tbAccessories ?? gpAccessories;
  const write = buildProgramInstanceWrite({
    engine,
    instance,
    ctx,
    resolveMovement,
    weekdays,
    startedOn,
    ...(assistance ? { assistance } : {}),
    ...(foreignAccessories ? { accessories: foreignAccessories } : {}),
    ...(startWeekIndex != null ? { startWeekIndex } : {}),
    ...(cardioWeekdays && cardioWeekdays.length > 0 ? { cardioWeekdays } : {}),
  });
  return { instance, write };
}

/**
 * Foreign per-session engine deploy (5/3/1, Tactical Barbell, Green Protocol).
 * Behaviour is byte-identical to the pre-refactor inline flow.
 */
async function createForeignProgramInstance(
  supabase: SupabaseClient,
  user: User,
  { programId, setupValues, weekdays, cardioWeekdays, startedOn, raceDate, startWeekIndex, roundingKg, accessories, supersetAccessories, seasonBlockId, twoADay }: DeployArgs,
): Promise<CreateProgramInstanceResult> {
  const engine = getProgramEngine(programId);
  if (!engine) return { ok: false, error: `Unknown program '${programId}'.` };

  // Shared strength state → engine setup → materialised plan + TM alignment.
  let write: ProgramInstanceWrite;
  let instance: unknown;
  try {
    ({ instance, write } = await computeForeignWrite(supabase, user, engine, {
      programId,
      setupValues,
      weekdays,
      startedOn,
      ...(cardioWeekdays && cardioWeekdays.length > 0 ? { cardioWeekdays } : {}),
      ...(raceDate ? { raceDate } : {}),
      ...(startWeekIndex != null ? { startWeekIndex } : {}),
      ...(roundingKg != null ? { roundingKg } : {}),
      ...(accessories ? { accessories } : {}),
      ...(twoADay ? { twoADay } : {}),
    }));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Setup failed" };
  }

  if (write.sessions.length === 0) {
    return { ok: false, error: "This program produced no sessions — check your training maxes." };
  }

  // 1) training_blocks — platform block: archetype NULL, identity in program_* columns.
  const { data: block, error: blockErr } = await supabase
    .from("training_blocks")
    .insert({
      user_id: user.id,
      archetype: null,
      program_id: programId,
      program_family: engine.meta.family,
      started_on: startedOn,
      weeks: write.weeks,
      status: "active",
      days_per_week: write.daysPerWeek,
      day_index_overrides: write.dayIndexOverrides,
      // Open cardio days are external-logged (Strava auto-link), so flag the block
      // external when any are present; otherwise keep the strength-only default.
      cardio_source: cardioWeekdays && cardioWeekdays.length > 0 ? "external" : "internal",
      // Per-block antagonist-superset choice (migration 0111, wizard Schedule
      // step). Applies to ALL programs; default OFF when the toggle is unset so
      // the per-block value wins over the profile pref at read time.
      superset_accessories: supersetAccessories ?? false,
      // HYROX two-a-day choice (ADR 0054) — baked into the grid at deploy. Set the
      // block flag for read-side consistency with the live AM/PM rows.
      allows_two_a_days: programId === "hyrox" ? !!twoADay : false,
      notes: engine.meta.name,
    })
    .select("id")
    .single();
  if (blockErr || !block) {
    return { ok: false, error: blockErr?.message ?? "Failed to create block" };
  }
  const blockId = block.id as string;

  // 2) planned_sessions
  const rows = write.sessions.map((s) => ({
    block_id: blockId,
    user_id: user.id,
    week_index: s.weekIndex,
    day_index: s.dayIndex,
    slot: s.slot,
    title: s.title,
    role: s.role,
    prescription: s.prescription,
    session_modality: s.sessionModality,
    effective_stress_load: s.effectiveStressLoad,
  }));
  const { error: psErr } = await supabase.from("planned_sessions").insert(rows);
  if (psErr) {
    await supabase.from("training_blocks").delete().eq("id", blockId);
    return { ok: false, error: `Couldn't create planned sessions: ${psErr.message}` };
  }

  // 3) seed training_maxes.tm_percent so the engine's % render correct weights.
  //    tm_percent lives on the SHARED training_maxes (per user+movement, not
  //    block-scoped), so capture the prior values first and restore them on any
  //    later failure — a half-applied seed would corrupt the user's strength
  //    state for future programs.
  const movementIds = write.tmPercents.map((s) => s.movementId);
  const priorTmPercent = new Map<string, number | string | null>();
  if (movementIds.length > 0) {
    const { data: priorRows, error: priorErr } = await supabase
      .from("training_maxes")
      .select("movement_id, tm_percent")
      .eq("user_id", user.id)
      .in("movement_id", movementIds);
    if (priorErr) {
      await supabase.from("planned_sessions").delete().eq("block_id", blockId);
      await supabase.from("training_blocks").delete().eq("id", blockId);
      return { ok: false, error: `Couldn't read training maxes: ${priorErr.message}` };
    }
    for (const r of priorRows ?? []) {
      priorTmPercent.set(r.movement_id as string, (r.tm_percent as number | string | null) ?? null);
    }
  }
  const restoreTmPercents = async () => {
    for (const seed of write.tmPercents) {
      await supabase
        .from("training_maxes")
        .update({ tm_percent: priorTmPercent.get(seed.movementId) ?? null })
        .eq("user_id", user.id)
        .eq("movement_id", seed.movementId);
    }
  };
  const rollbackBlock = async () => {
    await restoreTmPercents();
    await supabase.from("planned_sessions").delete().eq("block_id", blockId);
    await supabase.from("training_blocks").delete().eq("id", blockId);
  };

  for (const seed of write.tmPercents) {
    const { error: tmErr } = await supabase
      .from("training_maxes")
      .update({ tm_percent: seed.tmPercent })
      .eq("user_id", user.id)
      .eq("movement_id", seed.movementId);
    if (tmErr) {
      await rollbackBlock();
      return { ok: false, error: `Couldn't align training maxes: ${tmErr.message}` };
    }
  }

  // 4) program_instances (the source of truth for program identity).
  const { data: pi, error: piErr } = await supabase
    .from("program_instances")
    .insert({
      user_id: user.id,
      program_id: programId,
      program_family: engine.meta.family,
      instance,
      setup_input: { values: setupValues, weekdays, startedOn },
      block_id: blockId,
      status: "active",
    })
    .select("id")
    .single();
  if (piErr || !pi) {
    await rollbackBlock();
    return { ok: false, error: piErr?.message ?? "Failed to create program instance" };
  }

  // 5) archive any prior active block + program instance (one active at a time).
  await supabase
    .from("training_blocks")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("id", blockId);
  await supabase
    .from("program_instances")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("id", pi.id);

  // Clear any half-opened, zero-logged session from the program we just
  // replaced so Today doesn't surface a stale "Resume today's workout".
  await discardAbandonedInProgressSessions(supabase, user.id).catch(() => {});

  // ADR 0051 — when deep-linked from a Season roadmap, advance the roadmap:
  // flip the prior active season block to done + this planned one to active,
  // linked to the new block. Best-effort: never undo a valid deploy.
  if (seasonBlockId) {
    try {
      await activateSeasonBlock(supabase, user.id, seasonBlockId, blockId);
    } catch (e) {
      console.error("season-block activation failed:", e);
    }
  }

  // ADR 0050 step 10 — a HYROX race date becomes an A-priority event so the
  // existing event-taper (ADR 0008) + next-block nudge align to race day. The
  // block's end-taper already lands on race week via the weeks-to-race override.
  // Best-effort: a failure here must not undo a valid deploy.
  if (programId === "hyrox" && raceDate) {
    try {
      await supabase.from("priority_events").insert({
        user_id: user.id,
        name: "HYROX race",
        event_date: raceDate,
        priority: "A",
        modality: "hybrid",
      });
    } catch (e) {
      console.error("hyrox race-event create failed:", e);
    }
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/stats");

  return { ok: true, blockId, programInstanceId: pi.id as string, skipped: write.skipped.length };
}

/**
 * Forward-only EDIT of an existing foreign block (5/3/1 / Tactical Barbell).
 *
 * Re-enters the wizard for an ACTIVE plan and applies the new inputs WITHOUT
 * losing logged history: it keeps the same `training_blocks` row + active
 * `program_instances` row, FREEZES every week up to and including the current
 * week, and regenerates only the future weeks from a fresh materialise.
 *
 * Guardrails mirror the create path — user-scoped client, explicit `user_id`
 * ownership on every query (never the service role). The original `started_on`
 * is preserved so past weeks keep their dates; touched future rows (a session
 * started or skipped ahead of today) are never deleted or collided on.
 */
async function updateForeignProgramInstance(
  supabase: SupabaseClient,
  user: User,
  blockId: string,
  args: DeployArgs,
): Promise<CreateProgramInstanceResult> {
  const { programId, supersetAccessories } = args;
  const engine = getProgramEngine(programId);
  if (!engine) return { ok: false, error: `Unknown program '${programId}'.` };

  // 1) Load + validate the target block (ownership, active, program match).
  const { data: block, error: blockErr } = await supabase
    .from("training_blocks")
    .select("id, started_on, weeks, program_id, status, deleted_at")
    .eq("id", blockId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (blockErr) return { ok: false, error: blockErr.message };
  if (!block) return { ok: false, error: "Plan not found." };
  if (block.status !== "active" || block.deleted_at != null) {
    return { ok: false, error: "This plan is no longer active." };
  }
  if ((block.program_id as string | null) !== programId) {
    return { ok: false, error: "Program mismatch — start a new plan to change methodology." };
  }
  const blockStartedOn = block.started_on as string;

  // 2) Forward-only boundary: freeze weeks <= the week that contains today.
  const { data: prof } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const tz = (prof?.timezone as string | null) ?? "UTC";
  const blockMonday = mondayOfYmd(blockStartedOn);
  const elapsedDays = daysBetweenYmd(blockMonday, todayYmd(tz));
  const currentWeekIndex = Math.max(0, Math.floor(elapsedDays / 7));

  // 3) Fresh materialise from the new inputs — same engine, ORIGINAL start date.
  let write: ProgramInstanceWrite;
  let instance: unknown;
  try {
    ({ instance, write } = await computeForeignWrite(supabase, user, engine, {
      ...args,
      startedOn: blockStartedOn,
    }));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Setup failed" };
  }
  if (write.sessions.length === 0) {
    return { ok: false, error: "This program produced no sessions — check your training maxes." };
  }
  const newWeeks = Math.max(write.weeks, currentWeekIndex + 1);

  // 4) Decide what to delete vs insert in the future weeks. Any future row that
  //    was started or skipped ahead of today (rare) is preserved so we neither
  //    delete it nor collide on its (week, day, slot) key.
  const { data: futureRows, error: frErr } = await supabase
    .from("planned_sessions")
    .select("id, week_index, day_index, slot, completed_session_id, skipped_at")
    .eq("block_id", blockId)
    .eq("user_id", user.id)
    .gt("week_index", currentWeekIndex);
  if (frErr) return { ok: false, error: frErr.message };
  const plan = planForwardOnlyRewrite({
    currentWeekIndex,
    writeWeeks: write.weeks,
    existingFuture: (futureRows ?? []).map((r) => ({
      id: r.id as string,
      weekIndex: r.week_index as number,
      dayIndex: r.day_index as number,
      slot: (r.slot as string) ?? "single",
      touched: r.completed_session_id != null || r.skipped_at != null,
    })),
    newSessions: write.sessions.map((s) => ({
      weekIndex: s.weekIndex,
      dayIndex: s.dayIndex,
      slot: s.slot,
    })),
  });

  // 5) Clear the regenerable future rows (untouched only).
  if (plan.deleteIds.length > 0) {
    const { error: delErr } = await supabase
      .from("planned_sessions")
      .delete()
      .eq("user_id", user.id)
      .in("id", plan.deleteIds);
    if (delErr) return { ok: false, error: `Couldn't clear future weeks: ${delErr.message}` };
  }

  // 6) Insert the new future rows.
  const newRows = plan.insertIndices.map((i) => {
    const s = write.sessions[i]!;
    return {
      block_id: blockId,
      user_id: user.id,
      week_index: s.weekIndex,
      day_index: s.dayIndex,
      slot: s.slot,
      title: s.title,
      role: s.role,
      prescription: s.prescription,
      session_modality: s.sessionModality,
      effective_stress_load: s.effectiveStressLoad,
    };
  });
  if (newRows.length > 0) {
    const { error: insErr } = await supabase.from("planned_sessions").insert(newRows);
    if (insErr) return { ok: false, error: `Couldn't write updated weeks: ${insErr.message}` };
  }

  // 7) Update block metadata (id + started_on unchanged). Re-seed tm_percent so
  //    the new future weeks render correct weights — a no-op when the user only
  //    changed cardio (the common case), since the seeds are identical.
  const cardioPresent = !!(args.cardioWeekdays && args.cardioWeekdays.length > 0);
  await supabase
    .from("training_blocks")
    .update({
      weeks: newWeeks,
      days_per_week: write.daysPerWeek,
      day_index_overrides: write.dayIndexOverrides,
      cardio_source: cardioPresent ? "external" : "internal",
      superset_accessories: supersetAccessories ?? false,
    })
    .eq("id", blockId)
    .eq("user_id", user.id);

  for (const seed of write.tmPercents) {
    await supabase
      .from("training_maxes")
      .update({ tm_percent: seed.tmPercent })
      .eq("user_id", user.id)
      .eq("movement_id", seed.movementId);
  }

  // 8) Keep the active program instance in sync (serialised state + wizard input).
  const { data: pi } = await supabase
    .from("program_instances")
    .update({
      instance,
      setup_input: { values: args.setupValues, weekdays: args.weekdays, startedOn: blockStartedOn },
      updated_at: new Date().toISOString(),
    })
    .eq("block_id", blockId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/stats");

  return {
    ok: true,
    blockId,
    programInstanceId: (pi?.id as string) ?? "",
    skipped: write.skipped.length,
  };
}

/**
 * Native (block-level) engine deploy — Hybrid (ADR 0046 Phase 2).
 *
 * Mirrors the foreign path's guardrails EXACTLY: same user-scoped client, the
 * same explicit `user_id` ownership match on every query, and complete rollback
 * on every failure path. The differences are structural, not security:
 *   - the engine materialises the WHOLE block at once (`materializeNative`),
 *     reusing the shared `assembleBlockSessions` rows directly, and
 *   - it does NOT seed `training_maxes.tm_percent`: Hybrid renders %TM off the
 *     user's real training maxes (exactly like the legacy archetype path), so
 *     there is no engine-derived TM basis to seed.
 *
 * `weekdays` is ignored here — Hybrid owns its weekly calendar (archetype +
 * daysPerWeek), like Green Protocol. The block's `weeks`, `days_per_week` and
 * `day_index_overrides` come from the engine instance.
 */
async function createNativeProgramInstance(
  supabase: SupabaseClient,
  user: User,
  { programId, setupValues, weekdays, startedOn, roundingKg, twoADay, supersetAccessories, seasonBlockId }: DeployArgs,
): Promise<CreateProgramInstanceResult> {
  const engine = getNativeProgramEngine(programId)!;

  // Setup → instance. `setupHybrid` reads `values.startedOn` + `values.daysPerWeek`,
  // so inject both: Hybrid's training days/week come from the shared Schedule step's
  // chosen weekdays (NOT a Hybrid setup field), matching every other program.
  // ctx is built uniformly with the foreign path (Hybrid's setup ignores it).
  // The native registry is generic (`unknown` instance); this branch owns the
  // Hybrid contract, so we read the instance as a `HybridInstance`.
  //
  // `focusMuscles` arrives from the picker's multi-select as a string[]; the
  // legacy single-string coercion is kept as a harmless guard.
  const values: Record<string, unknown> = {
    ...setupValues,
    startedOn,
    daysPerWeek: weekdays.length,
  };
  if (typeof values.focusMuscles === "string") {
    const fm = values.focusMuscles.trim();
    values.focusMuscles = fm ? [fm] : [];
  }
  let instance: HybridInstance;
  try {
    const { ctx } = await buildPlatformContext(supabase, user.id, {
      ...(roundingKg != null ? { roundingKg } : {}),
    });
    instance = engine.setup({ values }, ctx) as HybridInstance;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Setup failed" };
  }

  // Derive the block shape from the instance.
  const archetypeId = instance.archetypeId as keyof typeof ARCHETYPES;
  const archetype = ARCHETYPES[archetypeId];
  if (!archetype) return { ok: false, error: `Unknown program configuration.` };
  const weeks = archetype.weeks;
  const daysPerWeek = instance.daysPerWeek;
  const dayIndexOverrides = instance.dayIndexOverrides;

  // 1) training_blocks — platform block: archetype NULL, identity in program_* columns.
  const { data: block, error: blockErr } = await supabase
    .from("training_blocks")
    .insert({
      user_id: user.id,
      archetype: null,
      program_id: programId,
      program_family: engine.meta.family,
      started_on: startedOn,
      weeks,
      status: "active",
      days_per_week: daysPerWeek,
      day_index_overrides: dayIndexOverrides,
      // Per-block two-a-day choice (migration 0110, wizard Schedule step).
      // Hybrid stores an explicit boolean so the per-block value wins over the
      // profile default at materialisation; default OFF when the toggle is unset.
      allows_two_a_days: twoADay ?? false,
      // Per-block antagonist-superset choice (migration 0111, wizard Schedule
      // step). Applies to ALL programs; default OFF when the toggle is unset so
      // the per-block value wins over the profile pref at read time.
      superset_accessories: supersetAccessories ?? false,
      notes: engine.meta.name,
    })
    .select("id")
    .single();
  if (blockErr || !block) {
    return { ok: false, error: blockErr?.message ?? "Failed to create block" };
  }
  const blockId = block.id as string;

  // Hybrid's chosen training-max % (wizard Loadout step). Seeded onto
  // training_maxes.tm_percent for the block's main lifts (3b) so every "% of TM"
  // render uses the program's loading basis — exactly like the foreign path does
  // for 5/3/1 / TB. Captured priors are restored on any later failure.
  const hybridTmPercent = resolveHybridTmPercent(setupValues.tmPercent);
  const priorTmPercent = new Map<string, number | string | null>();
  const restoreTmPercents = async () => {
    for (const [movementId, prior] of priorTmPercent) {
      await supabase
        .from("training_maxes")
        .update({ tm_percent: prior ?? null })
        .eq("user_id", user.id)
        .eq("movement_id", movementId);
    }
  };

  const deleteBlock = async () => {
    await supabase.from("training_blocks").delete().eq("id", blockId).eq("user_id", user.id);
  };
  const rollbackBlock = async () => {
    await restoreTmPercents();
    await supabase.from("planned_sessions").delete().eq("block_id", blockId).eq("user_id", user.id);
    await deleteBlock();
  };

  // 2) materialise the WHOLE block via the shared assembly path.
  const mat = await engine.materializeNative(instance, supabase, user.id, blockId);
  if (!mat.ok) {
    await deleteBlock();
    return { ok: false, error: mat.error };
  }
  if (mat.rows.length === 0) {
    await deleteBlock();
    return { ok: false, error: "This program produced no sessions — check your training maxes." };
  }

  // 3) planned_sessions — rows already carry block_id/user_id/snake_case columns.
  const { error: psErr } = await supabase.from("planned_sessions").insert(mat.rows);
  if (psErr) {
    await deleteBlock();
    return { ok: false, error: `Couldn't create planned sessions: ${psErr.message}` };
  }

  // 3b) seed training_maxes.tm_percent for the block's resolved main lifts so
  //     Hybrid's chosen intensity drives every %-of-TM render. Capture priors
  //     first so a later failure restores the user's strength state.
  const seedMovementIds = mat.mainMovementIds;
  if (seedMovementIds.length > 0) {
    const { data: priorRows, error: priorErr } = await supabase
      .from("training_maxes")
      .select("movement_id, tm_percent")
      .eq("user_id", user.id)
      .in("movement_id", seedMovementIds);
    if (priorErr) {
      await rollbackBlock();
      return { ok: false, error: `Couldn't read training maxes: ${priorErr.message}` };
    }
    for (const r of priorRows ?? []) {
      priorTmPercent.set(r.movement_id as string, (r.tm_percent as number | string | null) ?? null);
    }
    const { error: seedErr } = await supabase
      .from("training_maxes")
      .update({ tm_percent: hybridTmPercent })
      .eq("user_id", user.id)
      .in("movement_id", seedMovementIds);
    if (seedErr) {
      await rollbackBlock();
      return { ok: false, error: `Couldn't align training maxes: ${seedErr.message}` };
    }
  }

  // 4) program_instances (the source of truth for program identity).
  const { data: pi, error: piErr } = await supabase
    .from("program_instances")
    .insert({
      user_id: user.id,
      program_id: programId,
      program_family: engine.meta.family,
      instance,
      setup_input: { values: setupValues, weekdays, startedOn },
      block_id: blockId,
      status: "active",
    })
    .select("id")
    .single();
  if (piErr || !pi) {
    await rollbackBlock();
    return { ok: false, error: piErr?.message ?? "Failed to create program instance" };
  }

  // 5) archive any prior active block + program instance (one active at a time).
  await supabase
    .from("training_blocks")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("id", blockId);
  await supabase
    .from("program_instances")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("id", pi.id);

  // Clear any half-opened, zero-logged session from the program we just
  // replaced so Today doesn't surface a stale "Resume today's workout".
  await discardAbandonedInProgressSessions(supabase, user.id).catch(() => {});

  // ADR 0051 — Season roadmap deep-link: advance the roadmap to this block.
  // Best-effort; a failure must not undo a valid deploy.
  if (seasonBlockId) {
    try {
      await activateSeasonBlock(supabase, user.id, seasonBlockId, blockId);
    } catch (e) {
      console.error("season-block activation failed:", e);
    }
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/stats");

  return { ok: true, blockId, programInstanceId: pi.id as string, skipped: 0 };
}

/**
 * Dismiss a pending program recommendation (the Today banner's "Got it"). RLS
 * scopes the update to the signed-in user; the explicit user_id match is
 * belt-and-suspenders.
 */
export async function dismissProgramRecommendation(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid id" };

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("program_recommendations")
    .update({ status: "dismissed", resolved_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("user_id", user.id)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  return { ok: true };
}
