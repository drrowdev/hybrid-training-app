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
import type { Prescription } from "@hta/db";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { ARCHETYPES } from "@/lib/planner/archetypes";
import type { HybridInstance } from "@/lib/programs/hybrid/engine";
import { resolveHybridTmPercent } from "@/lib/programs/hybrid/engine";
import {
  buildPlatformContext,
  validateCustomMovementBindings,
} from "./context";
import type { CustomMovementBinding } from "./context";
import { getProgramEngine, getNativeProgramEngine, isNativeProgram } from "./registry";
import { buildProgramInstanceWrite, type ProgramInstanceWrite } from "./program-instance";
import { buildAssistancePlanner, type AssistancePlanner } from "./assistance-resolver";
import { loadPickerCatalog } from "@/lib/planner/picker-catalog";
import { readLimitationsContext } from "@/lib/planner/limitations-context";
import { resolveDeclaredExperience } from "@/lib/planner/build-block-assembly-context";
import { greenStrengthTemplateByRef, type GreenInstance } from "@hta/green";
import {
  activationCustomizationKey,
  activationPhaseForSession,
  getTbTemplate,
  TB_MOVEMENT_LABEL,
} from "@hta/tacticalbarbell";
import {
  findOrphanedLinkMembers,
  linksBySeries,
  normalizeSessionLinks,
  sessionLinksSchema,
  type SessionLinks,
} from "./session-links";
import {
  resolveAssistanceVolume,
  type AssistanceVolume,
} from "./assistance-volume";
import { resolveAccessoryVolumeLevel } from "@/lib/planner/accessory-volume";
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
import {
  planForwardOnlyRewrite,
  prescriptionsEquivalent,
} from "./forward-rewrite";
import { todayYmd, mondayOfYmd, daysBetweenYmd } from "@/lib/dates";
import { programSetupAuditInput } from "./setup-audit";
import { prescriptionCarriesUserState } from "@/lib/sessions/prescription-mutations";
import { inferProgramStartWeekIndex } from "@/lib/plan/program-overview";
import {
  customizationDays,
  activationRehabProtocols,
  LEGACY_REHAB_PROTOCOL_ID,
  effectiveActivationRehabProtocolIds,
  isTbActivationCustomization,
  activationSessionConfigs,
  isTbCustomizationV1,
  tbCustomizationSchema,
  type TbActivationCustomization,
  type TbCustomization,
} from "./tb-customization";
import { rehabSeriesKey } from "./rehab-links";
import {
  loadsBlockedMuscle,
  loadsBlockedRegion,
} from "@/lib/planner/accessory-picker";
import {
  embeddedRehabSnapshot,
  rehabItemsForComparison,
  replaceEmbeddedRehab,
  stripEmbeddedRehab,
} from "./rehab-composition";

const WEEKDAY = z.number().int().min(0).max(6);

/**
 * Strength-only foreign programs whose cardio isn't engine-owned, so the wizard
 * may add OPEN cardio days (a reserved cardio_external placeholder per day). The
 * concurrent programs (Hybrid native, Green Protocol / HYROX fixed-schedule)
 * derive their own cardio and never accept wizard cardio days.
 */
const STRENGTH_ONLY_PROGRAM_IDS = new Set<string>(["wendler-531", "tactical-barbell"]);

function customMovementBindings(
  customization: TbCustomization | undefined,
): CustomMovementBinding[] {
  if (!customization) return [];
  const movements = isTbCustomizationV1(customization)
    ? Object.values(customization.sessionMovements).flat()
    : Object.values(activationSessionConfigs(customization)).flatMap(
        (session) =>
          Object.values(session.movementOverrides).filter(
            (movement) => movement != null,
          ),
      );
  const byKey = new Map<string, CustomMovementBinding>();
  for (const movement of movements) {
    if (
      !movement.movement.startsWith("catalog:") ||
      !movement.movementId ||
      !movement.slug ||
      !movement.displayName
    ) {
      continue;
    }
    byKey.set(movement.movement, {
      key: movement.movement,
      movementId: movement.movementId,
      slug: movement.slug,
      displayName: movement.displayName,
    });
  }
  return [...byKey.values()];
}

function validateActivationCustomization(
  customization: TbActivationCustomization,
): string | null {
  const template = getTbTemplate("activation");
  if (!template) return "Activation template is unavailable.";

  for (const phase of [
    "base",
    "armor",
    "operator",
    "vertex",
  ] as const) {
    const expected = template.weeklySessions.filter(
      (session) => activationPhaseForSession(session) === phase,
    );
    const configured = customization.phases[phase];
    const expectedKeys = new Set(
      expected.map((session) => activationCustomizationKey(session)!),
    );
    const configuredKeys = Object.keys(configured.sessions);
    const orphan = configuredKeys.find((key) => !expectedKeys.has(key));
    if (orphan) {
      return `Customized Activation session '${orphan}' no longer exists. Review the ${phase} phase.`;
    }
    const missing = [...expectedKeys].find(
      (key) => configured.sessions[key] == null,
    );
    if (missing) {
      return `The ${phase} phase is missing session '${missing}'.`;
    }

    const occupiedDays = new Set<number>();
    for (const session of expected) {
      const key = activationCustomizationKey(session)!;
      const config = configured.sessions[key]!;
      const isConditioning = session.conditioning != null;
      if (!isConditioning && !config.enabled) {
        return `${session.label} is a required Activation strength session.`;
      }
      if (config.enabled) {
        if (occupiedDays.has(config.day)) {
          return `The ${phase} phase has more than one session on the same day.`;
        }
        occupiedDays.add(config.day);
      }

      const sourceMovements = new Set(
        (session.fixedMovements ?? []).map((movement) => movement.movement),
      );
      const orphanMovement = Object.keys(config.movementOverrides).find(
        (movement) => !sourceMovements.has(movement),
      );
      if (orphanMovement) {
        return `${session.label} no longer contains '${orphanMovement}'. Review its movements.`;
      }
      if (!isConditioning) {
        const remaining = [...sourceMovements].filter(
          (movement) => config.movementOverrides[movement] !== null,
        );
        if (remaining.length === 0) {
          return `${session.label} needs at least one movement.`;
        }
        const resolved = remaining.map(
          (source) =>
            config.movementOverrides[source]?.movement ?? source,
        );
        if (new Set(resolved).size !== resolved.length) {
          return `${session.label} contains the same movement more than once.`;
        }
      }
    }
  }
  return deriveActivationMilestoneOverrides(customization).error;
}

function deriveActivationMilestoneOverrides(
  customization: TbActivationCustomization,
): {
  overrides: Record<
    string,
    {
      movementOverrides: Record<
        string,
        { movement: string; kind?: "barbell" | "weighted-bw" | "bodyweight" | "unanchored" } | null
      >;
    }
  >;
  error: string | null;
} {
  const template = getTbTemplate("activation");
  if (!template) {
    return { overrides: {}, error: "Activation template is unavailable." };
  }
  const predecessor = (week: number) =>
    week === 5
      ? "base"
      : week === 14 || week === 20 || week === 21
        ? "operator"
        : week === 25
          ? "vertex"
          : null;
  const overrides: Record<
    string,
    {
      movementOverrides: Record<
        string,
        { movement: string; kind?: "barbell" | "weighted-bw" | "bodyweight" | "unanchored" } | null
      >;
    }
  > = {};

  for (const week of [5, 14, 20, 21, 25]) {
    const phase = predecessor(week);
    if (!phase) continue;
    const phaseSessions = template.weeklySessions.filter(
      (session) =>
        activationPhaseForSession(session) === phase &&
        session.conditioning == null,
    );
    const milestones = template.weeklySessions.filter(
      (session) => session.activeWeeks?.includes(week),
    );
    for (const milestone of milestones) {
      const movementOverrides: Record<
        string,
        { movement: string; kind?: "barbell" | "weighted-bw" | "bodyweight" | "unanchored" } | null
      > = {};
      for (const sourceSlot of milestone.fixedMovements ?? []) {
        const source = sourceSlot.movement;
        const resolutions: Array<
          { movement: string; kind?: "barbell" | "weighted-bw" | "bodyweight" | "unanchored" } | null
        > = [];
        for (const sourceSession of phaseSessions) {
          const canonical = sourceSession.fixedMovements?.find(
            (movement) => movement.movement === source,
          );
          if (!canonical) continue;
          const key = activationCustomizationKey(sourceSession)!;
          const config = customization.phases[phase].sessions[key];
          if (!config?.enabled) continue;
          const replacement = config.movementOverrides[source];
          resolutions.push(
            replacement === undefined
              ? {
                  movement: source,
                  ...(canonical.kind ? { kind: canonical.kind } : {}),
                }
              : replacement,
          );
        }
        if (resolutions.length === 0) continue;
        const remaining = resolutions.filter(
          (resolution): resolution is NonNullable<typeof resolution> =>
            resolution != null,
        );
        if (remaining.length === 0) {
          movementOverrides[source] = null;
          continue;
        }
        const signatures = new Set(
          remaining.map(
            (resolution) =>
              `${resolution.movement}:${resolution.kind ?? ""}`,
          ),
        );
        if (signatures.size > 1) {
          const label = TB_MOVEMENT_LABEL[source] ?? source;
          return {
            overrides: {},
            error: `You've swapped ${label} for more than one movement before week ${week}. Pick a single replacement so the test in that week knows which one to use.`,
          };
        }
        const [resolved] = remaining;
        if (
          resolved.movement !== source ||
          (resolved.kind ?? "") !== (sourceSlot.kind ?? "")
        ) {
          movementOverrides[source] = resolved;
        }
      }
      if (Object.keys(movementOverrides).length > 0) {
        overrides[
          `activation.milestone.w${week}.${milestone.id}`
        ] = { movementOverrides };
      }
    }
  }
  return { overrides, error: null };
}

function effectiveActivationMovements(
  customization: TbActivationCustomization,
  startWeekIndex = 0,
): Array<{
  movement: string;
  kind?: "barbell" | "weighted-bw" | "bodyweight" | "unanchored";
}> {
  const template = getTbTemplate("activation");
  if (!template) return [];
  const movements: Array<{
    movement: string;
    kind?: "barbell" | "weighted-bw" | "bodyweight" | "unanchored";
  }> = [];
  const phaseEnds = {
    base: 3,
    armor: 7,
    operator: 18,
    vertex: 23,
  } as const;
  for (const session of template.weeklySessions) {
    const phase = activationPhaseForSession(session);
    if (!phase) continue;
    if (phaseEnds[phase] < startWeekIndex) continue;
    const key = activationCustomizationKey(session)!;
    const config = customization.phases[phase].sessions[key];
    if (!config?.enabled) continue;
    for (const canonical of session.fixedMovements ?? []) {
      const replacement =
        config.movementOverrides[canonical.movement];
      if (replacement === null) continue;
      movements.push(
        replacement ?? {
          movement: canonical.movement,
          ...(canonical.kind ? { kind: canonical.kind } : {}),
        },
      );
    }
  }

  const milestones = deriveActivationMilestoneOverrides(customization).overrides;
  for (const week of [5, 14, 20, 21, 25]) {
    if (week - 1 < startWeekIndex) continue;
    for (const session of template.weeklySessions.filter((candidate) =>
      candidate.activeWeeks?.includes(week),
    )) {
      const config =
        milestones[`activation.milestone.w${week}.${session.id}`];
      for (const canonical of session.fixedMovements ?? []) {
        const replacement =
          config?.movementOverrides[canonical.movement];
        if (replacement === null) continue;
        movements.push(
          replacement ?? {
            movement: canonical.movement,
            ...(canonical.kind ? { kind: canonical.kind } : {}),
          },
        );
      }
    }
  }
  return movements;
}

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
    /** Versioned Tactical Barbell schedule/movement/rehab overlay. */
    customization: tbCustomizationSchema.optional(),
    /**
     * User-authored superset / tri-set links, keyed by session series key.
     * Independently versioned and deliberately NOT nested inside `customization`
     * so links work on canonical templates and Activation too — see
     * `./session-links`. Tactical Barbell only; rejected for other programs
     * below rather than silently ignored.
     */
    sessionLinks: sessionLinksSchema.optional(),
    /** When present, this deploy is a forward-only EDIT of an existing active
     *  block (5/3/1 / Tactical Barbell only): keep the same block + program
     *  instance, preserve everything through today plus touched rows, and
     *  regenerate only untouched upcoming workouts. */
    editBlockId: z.string().uuid().optional(),
    /** When present, the wizard was deep-linked from a Season roadmap (ADR 0051):
     *  activate this planned season_block + link it to the new block on deploy. */
    seasonBlockId: z.string().uuid().optional(),
    /**
     * Which Settings library protocol each local protocol slot refers to.
     * Recorded AFTER the deploy succeeds, so a failed deploy never leaves a
     * program claiming rehab it doesn't have.
     */
    rehabBindings: z
      .array(
        z
          .object({
            localProtocolId: z.string().min(1).max(64),
            rehabProtocolId: z.string().uuid(),
          })
          .strict(),
      )
      .max(8)
      .optional(),
  })
  .strict();

export type CreateProgramInstanceInput = z.input<typeof createProgramInstanceSchema>;

export type CreateProgramInstanceResult =
  | {
      ok: true;
      blockId: string;
      programInstanceId: string;
      skipped: number;
      /**
       * True when today's workout kept its existing plan because it is already
       * under way. Set only on the edit path; lets the UI explain a save that
       * otherwise looks like it did nothing.
       */
      todayLeftAsIs?: boolean;
    }
  | { ok: false; error: string };

export async function createProgramInstance(
  input: CreateProgramInstanceInput,
): Promise<CreateProgramInstanceResult> {
  const parsed = createProgramInstanceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { programId, setupValues, weekdays, cardioWeekdays, startedOn, raceDate, startWeekIndex, roundingKg, accessories, twoADay, customization, sessionLinks: rawSessionLinks, editBlockId, seasonBlockId, rehabBindings } = parsed.data;
  const sessionLinks = normalizeSessionLinks(rawSessionLinks);

  if (sessionLinks && programId !== "tactical-barbell") {
    return {
      ok: false,
      error: "Only Tactical Barbell templates can link lifts into supersets.",
    };
  }

  // A link may only reference lifts the session actually contains. The engine
  // already refuses to realise a link with a missing member, but it does so
  // SILENTLY — the lifter would deploy, and the superset would simply not be
  // there. When the wizard sends the movement list too, we can say so instead.
  //
  // Rehab series MUST be listed here as well. `findOrphanedLinkMembers` reads
  // an unknown key as "no movements available", so omitting them would reject
  // every rehab link as orphaned rather than validating it.
  if (sessionLinks && customization && isTbCustomizationV1(customization)) {
    const orphans = findOrphanedLinkMembers(
      sessionLinks,
      Object.fromEntries([
        ...Object.entries(customization.sessionMovements).map(([key, movements]) => [
          key,
          movements.map((movement) => movement.movement),
        ]),
        [
          rehabSeriesKey(LEGACY_REHAB_PROTOCOL_ID),
          (customization.rehab?.items ?? []).map((item) => item.movementId),
        ],
      ]),
    );
    if (orphans.length > 0) {
      const count = orphans.reduce((n, o) => n + o.missing.length, 0);
      return {
        ok: false,
        error: `A linked superset references ${count === 1 ? "a lift" : "lifts"} that aren't in that session anymore. Remove the link or add the ${count === 1 ? "lift" : "lifts"} back.`,
      };
    }
  }

  // Activation's strength series are not enumerable here, so the check above
  // does not run for it — but its rehab protocols ARE, and a link naming a
  // protocol that no longer exists (ids are reused as ordinals) would attach
  // to whatever protocol later takes that id. Reject it rather than let a
  // stale link silently adopt an unrelated protocol.
  if (
    sessionLinks &&
    customization &&
    isTbActivationCustomization(customization)
  ) {
    const protocols = activationRehabProtocols(customization);
    const known = new Map(
      protocols.map((protocol) => [
        rehabSeriesKey(protocol.id),
        protocol.items.map((item) => item.movementId),
      ]),
    );
    for (const seriesKey of Object.keys(sessionLinks.bySeries)) {
      if (!seriesKey.startsWith("rehab.")) continue;
      if (!known.has(seriesKey)) {
        return {
          ok: false,
          error:
            "A linked superset belongs to a rehab protocol that no longer exists. Remove the link and re-create it.",
        };
      }
    }
    const orphans = findOrphanedLinkMembers(
      sessionLinks,
      Object.fromEntries([
        ...known,
        // Strength series are unverifiable here; echo their own members back so
        // they pass rather than being condemned as orphans.
        ...Object.entries(sessionLinks.bySeries)
          .filter(([key]) => !key.startsWith("rehab."))
          .map(([key, links]) => [key, links.flatMap((link) => link.members)]),
      ]),
    );
    if (orphans.length > 0) {
      const count = orphans.reduce((n, o) => n + o.missing.length, 0);
      return {
        ok: false,
        error: `A linked superset references ${count === 1 ? "a movement" : "movements"} that aren't in that rehab protocol anymore. Remove the link or add the ${count === 1 ? "movement" : "movements"} back.`,
      };
    }
  }

  if (customization) {
    if (programId !== "tactical-barbell") {
      return { ok: false, error: "Only Tactical Barbell templates can use this customization." };
    }
    if (isTbCustomizationV1(customization)) {
      if (setupValues.templateId === "activation") {
        return {
          ok: false,
          error: "Activation customization requires the phase-aware editor.",
        };
      }
      const customStrengthDays = customizationDays(customization, "strength");
      if (
        customStrengthDays.length !== weekdays.length ||
        customStrengthDays.some((day, index) => day !== weekdays[index])
      ) {
        return { ok: false, error: "Customized strength days don't match the submitted schedule." };
      }
    } else {
      if (setupValues.templateId !== "activation") {
        return {
          ok: false,
          error: "Activation customization can only be used with Activation.",
        };
      }
      const activationError = validateActivationCustomization(customization);
      if (activationError) return { ok: false, error: activationError };
    }
  }

  // Reject duplicate weekdays — they'd collide on the (week, day, slot) unique key.
  // (Native programs own their own calendar and ignore `weekdays`, but the check
  // is harmless and keeps the input contract uniform.)
  if (new Set(weekdays).size !== weekdays.length) {
    return { ok: false, error: "Training weekdays must be distinct." };
  }

  // Open cardio days only apply to strength-only foreign programs (5/3/1, TB),
  // where cardio isn't engine-owned. They must not double up on a strength day.
  const requestedCardioDays = customization && isTbCustomizationV1(customization)
    ? customizationDays(customization, "conditioning")
    : cardioWeekdays ?? [];
  const cardioDays = requestedCardioDays.filter((d) => !weekdays.includes(d));
  const cardioForProgram = STRENGTH_ONLY_PROGRAM_IDS.has(programId) ? cardioDays : [];

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Same user-scoped client (RLS) for BOTH paths — never the service role.
  const supabase = await createClient();

  // Forward-only EDIT of an existing block (5/3/1 / TB). Keeps the block + its
  // active program instance, preserves past/today/touched rows, and regenerates
  // untouched upcoming workouts from the new wizard inputs.
  if (editBlockId) {
    if (!STRENGTH_ONLY_PROGRAM_IDS.has(programId)) {
      return { ok: false, error: "This program can't be edited in place yet." };
    }
    const edited = await updateForeignProgramInstance(supabase, user, editBlockId, {
      programId,
      setupValues,
      weekdays,
      startedOn,
      ...(cardioForProgram.length > 0 ? { cardioWeekdays: cardioForProgram } : {}),
      ...(roundingKg != null ? { roundingKg } : {}),
      ...(accessories ? { accessories } : {}),
      ...(customization ? { customization } : {}),
      ...(sessionLinks ? { sessionLinks } : {}),
    });
    // Editing is the path that ATTACHES rehab to a program the user already
    // has, so bindings have to be written here too. Skipping it left the
    // program with no binding, which silently stopped every later Settings
    // edit from syncing into it.
    if (edited.ok) {
      const bindingError = await persistRehabBindings(
        supabase,
        user.id,
        edited.programInstanceId,
        rehabBindings ?? [],
      );
      if (bindingError) return { ok: false, error: bindingError };
    }
    return edited;
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
      ...(customization ? { customization } : {}),
      ...(sessionLinks ? { sessionLinks } : {}),
      ...(seasonBlockId ? { seasonBlockId } : {}),
    });
  }
  const result = await createForeignProgramInstance(supabase, user, {
    programId,
    setupValues,
    weekdays,
    startedOn,
    ...(cardioForProgram.length > 0 ? { cardioWeekdays: cardioForProgram } : {}),
    ...(raceDate ? { raceDate } : {}),
    ...(startWeekIndex != null ? { startWeekIndex } : {}),
    ...(roundingKg != null ? { roundingKg } : {}),
    ...(accessories ? { accessories } : {}),
    ...(customization ? { customization } : {}),
    ...(sessionLinks ? { sessionLinks } : {}),
    ...(seasonBlockId ? { seasonBlockId } : {}),
  });
  // Recorded only AFTER the plan is written, so a failed deploy never leaves a
  // program claiming rehab it doesn't have.
  if (result.ok) {
    const bindingError = await persistRehabBindings(
      supabase,
      user.id,
      result.programInstanceId,
      rehabBindings ?? [],
    );
    if (bindingError) return { ok: false, error: bindingError };
  }
  return result;
}

/**
 * Replace a program instance's rehab bindings with exactly what was deployed.
 * Returns an error message on failure, or null on success.
 *
 * Deleting first is what makes unticking a protocol take effect — the row has
 * to go, or the resolver would keep substituting a protocol the program no
 * longer has.
 *
 * A missing table means migration 0134 has not run yet, which is EXPECTED
 * between deploy and migration; the program simply keeps using the items
 * already in its customization, exactly as before the library existed. Every
 * other failure is surfaced: a deploy whose bindings didn't persist looks fine
 * today and then silently stops receiving Settings edits forever, which is
 * worse than a visible error.
 */
async function persistRehabBindings(
  supabase: SupabaseClient,
  userId: string,
  programInstanceId: string,
  bindings: ReadonlyArray<{ localProtocolId: string; rehabProtocolId: string }>,
): Promise<string | null> {
  if (!programInstanceId) return null;
  const { error: deleteError } = await supabase
    .from("program_rehab_bindings")
    .delete()
    .eq("program_instance_id", programInstanceId)
    .eq("user_id", userId);
  if (deleteError) {
    if (isMissingRehabTable(deleteError)) return null;
    return `Couldn't update this program's rehab protocols: ${deleteError.message}`;
  }
  if (bindings.length === 0) return null;
  const { error: insertError } = await supabase.from("program_rehab_bindings").insert(
    bindings.map((binding) => ({
      program_instance_id: programInstanceId,
      local_protocol_id: binding.localProtocolId,
      rehab_protocol_id: binding.rehabProtocolId,
      user_id: userId,
    })),
  );
  if (insertError) {
    if (isMissingRehabTable(insertError)) return null;
    return `Couldn't attach the rehab protocols: ${insertError.message}`;
  }
  return null;
}

/** Postgres "undefined_table" / PostgREST unknown relation — 0134 hasn't run. */
function isMissingRehabTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .* does not exist/i.test(error.message ?? "")
  );
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
          // ADR 0060 — a race date set ⇒ peak to it; blank ⇒ no-race maintenance.
          ...(programId === "hyrox" ? { hasRace: raceDate != null } : {}),
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
  customization?: TbCustomization;
  /** User-authored superset / tri-set links, keyed by session series key.
   *  Tactical Barbell only; see `./session-links`. */
  sessionLinks?: SessionLinks;
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
  { programId, setupValues, weekdays, cardioWeekdays, startedOn, raceDate, startWeekIndex, roundingKg, accessories, twoADay, customization, sessionLinks }: DeployArgs,
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
  const customizationCatalog = customization
    ? await loadPickerCatalog(supabase)
    : [];
  const validatedCustomMovements = customization
    ? validateCustomMovementBindings(
        customMovementBindings(customization),
        customizationCatalog.map((movement) => ({
          id: movement.id,
          slug: movement.slug,
          displayName: movement.displayName,
        })),
      )
    : [];

  const { ctx, resolveMovement } = await buildPlatformContext(supabase, user.id, {
    ...(roundingKg != null ? { roundingKg } : {}),
    ...(hyroxGender ? { gender: hyroxGender } : {}),
    ...(validatedCustomMovements.length > 0
      ? { customMovements: validatedCustomMovements }
      : {}),
  });
  const customMovementByKey = new Map(
    validatedCustomMovements.map((movement) => [movement.key, movement]),
  );
  const normalizeCustomMovement = <
    T extends {
      movement: string;
      kind?: "barbell" | "weighted-bw" | "bodyweight" | "unanchored";
    },
  >(
    movement: T,
  ): T => {
    if (!movement.movement.startsWith("catalog:")) return movement;
    const catalog = customMovementByKey.get(movement.movement);
    return {
      ...movement,
      ...(catalog
        ? {
            movementId: catalog.movementId,
            slug: catalog.slug,
            displayName: catalog.displayName,
          }
        : {}),
      kind:
        ctx.oneRepMaxes[movement.movement] != null
          ? "barbell"
          : "unanchored",
    };
  };
  // Assistance volume (low = Easier / standard = Balanced / high = Harder).
  // 5/3/1 collects this per block in the wizard's Loadout step. Deploys that
  // carry no wizard value (clients predating the field, or edit-mode re-deploys
  // of older blocks) fall back to the legacy global `profiles.effort_preference`
  // so they stay byte-identical. See `./assistance-volume`.
  let assistanceVolumePref: AssistanceVolume = "standard";
  if (programId === "wendler-531") {
    const fromWizard = setupValues.assistanceVolume;
    let fromProfile: unknown = null;
    if (typeof fromWizard !== "string") {
      const { data: prof } = await supabase
        .from("profiles")
        .select("effort_preference")
        .eq("id", user.id)
        .maybeSingle();
      fromProfile = prof?.effort_preference ?? null;
    }
    assistanceVolumePref = resolveAssistanceVolume({ fromWizard, fromProfile });
  }
  const effectiveSetupValues = customization && isTbCustomizationV1(customization)
    ? {
        ...setupValues,
        customSessionMovements: Object.fromEntries(
          Object.entries(customization.sessionMovements).map(
            ([key, movements]) => [
              key,
              movements.map(normalizeCustomMovement),
            ],
          ),
        ),
      }
    : customization && isTbActivationCustomization(customization)
      ? {
          ...setupValues,
          activationSessionOverrides: Object.fromEntries(
            Object.entries(activationSessionConfigs(customization)).map(
              ([key, session]) => [
                key,
                {
                  movementOverrides: Object.fromEntries(
                    Object.entries(session.movementOverrides).map(
                      ([source, movement]) => [
                        source,
                        movement
                          ? normalizeCustomMovement(movement)
                          : null,
                      ],
                    ),
                  ),
                },
              ],
            ),
          ),
          activationMilestoneOverrides: Object.fromEntries(
            Object.entries(
              deriveActivationMilestoneOverrides(customization).overrides,
            ).map(([key, session]) => [
              key,
              {
                movementOverrides: Object.fromEntries(
                  Object.entries(session.movementOverrides).map(
                    ([source, movement]) => [
                      source,
                      movement
                        ? normalizeCustomMovement(movement)
                        : null,
                    ],
                  ),
                ),
              },
            ]),
          ),
        }
    : setupValues;
  const instance = engine.setup(
    {
      values: {
        ...effectiveSetupValues,
        // User-authored superset links (see `./session-links`). Independent of
        // `customization`, so this rides alongside all three branches above and
        // reaches canonical templates that have no customization at all.
        ...(sessionLinks
          ? { customSessionLinks: linksBySeries(sessionLinks) }
          : {}),
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
        // ADR 0060 — race date set ⇒ peak to race week; blank ⇒ no-taper concurrent
        // maintenance (short Base intro → held Build steady state).
        ...(programId === "hyrox" ? { hasRace: raceDate != null } : {}),
      },
    },
    ctx,
  );
  if (customization) {
    const validSeries = new Set(
      engine
        .timeline(instance)
        .flatMap((spec) => (spec.seriesKey ? [spec.seriesKey] : [])),
    );
    const customizationKeys = isTbCustomizationV1(customization)
      ? Object.keys(customization.sessionMovements)
      : Object.keys(activationSessionConfigs(customization));
    const orphan = customizationKeys.find(
      (key) => !validSeries.has(key),
    );
    if (orphan) {
      throw new Error(
        `Customized strength slot '${orphan}' no longer exists in this template. Review the program setup.`,
      );
    }
    const replacements = isTbCustomizationV1(customization)
      ? Object.values(customization.sessionMovements).flat()
      : Object.values(activationSessionConfigs(customization)).flatMap(
          (session) =>
            Object.values(session.movementOverrides).filter(
              (movement) => movement != null,
            ),
        );
    for (const movement of replacements) {
      if (!resolveMovement(movement.movement)) {
        throw new Error(
          `Customized movement '${movement.movement}' is not available. Choose another movement.`,
        );
      }
    }
  }
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
          typeof effectiveSetupValues.templateId === "string" ? effectiveSetupValues.templateId : "",
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
    ...(customization ? { customization } : {}),
    ...(sessionLinks ? { sessionLinks: linksBySeries(sessionLinks) } : {}),
  });
  if (customization) {
    const limitations = await readLimitationsContext(supabase, user.id);
    const catalog = customizationCatalog;
    const byId = new Map(catalog.map((movement) => [movement.id, movement]));
    const selectedIds = new Set<string>();
    if (isTbCustomizationV1(customization)) {
      for (const item of customization.rehab?.items ?? []) {
        selectedIds.add(item.movementId);
      }
    } else {
      const assignedProtocolIds = effectiveActivationRehabProtocolIds(
        customization,
        startWeekIndex ?? 0,
      );
      for (const protocol of activationRehabProtocols(customization)) {
        if (!assignedProtocolIds.has(protocol.id)) continue;
        for (const item of protocol.items) selectedIds.add(item.movementId);
      }
    }
    const replacementMovements = isTbCustomizationV1(customization)
      ? Object.values(customization.sessionMovements).flat()
      : effectiveActivationMovements(
          customization,
          startWeekIndex ?? 0,
        );
    for (const movement of replacementMovements) {
      const resolved = resolveMovement(movement.movement);
      if (resolved) selectedIds.add(resolved.movementId);
    }
    const blockedNames: string[] = [];
    for (const movementId of selectedIds) {
      const movement = byId.get(movementId);
      if (!movement) continue;
      if (
        limitations.blockedMovementIds.has(movementId) ||
        loadsBlockedRegion(movement, limitations.blockedRegions) ||
        loadsBlockedMuscle(
          movement,
          limitations.blockedMuscles,
          limitations.allowedMovementIds,
        )
      ) {
        blockedNames.push(movement.displayName);
      }
    }
    if (blockedNames.length > 0) {
      throw new Error(
        `Your active limitations block ${blockedNames.join(", ")}. Change the customized program or update the limitation first.`,
      );
    }
  }
  return { instance, write };
}

/**
 * Foreign per-session engine deploy (5/3/1, Tactical Barbell, Green Protocol).
 * Behaviour is byte-identical to the pre-refactor inline flow.
 */
async function createForeignProgramInstance(
  supabase: SupabaseClient,
  user: User,
  { programId, setupValues, weekdays, cardioWeekdays, startedOn, raceDate, startWeekIndex, roundingKg, accessories, seasonBlockId, twoADay, customization, sessionLinks }: DeployArgs,
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
      ...(customization ? { customization } : {}),
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
      // Open cardio days are logged by the user after the fact, so flag the block
      // external when any are present; otherwise keep the strength-only default.
      cardio_source: cardioWeekdays && cardioWeekdays.length > 0 ? "external" : "internal",
      // Per-block antagonist-superset choice (migration 0111, wizard Schedule
      // step). Applies to ALL programs; default OFF when the toggle is unset so
      // the per-block value wins over the profile pref at read time.
      // HYROX two-a-day choice (ADR 0054) — baked into the grid at deploy. Set the
      // block flag for read-side consistency with the live AM/PM rows.
      allows_two_a_days: programId === "hyrox" ? !!twoADay : false,
      notes: customization?.displayName ?? engine.meta.name,
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
      setup_input: programSetupAuditInput({
        values: setupValues,
        weekdays,
        startedOn,
        startWeekIndex,
        ...(customization ? { customization } : {}),
        ...(sessionLinks ? { sessionLinks } : {}),
      }),
      display_name: customization?.displayName ?? null,
      customization_version: customization?.version ?? null,
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
 * `program_instances` row, freezes every slot through today plus any later
 * started/skipped row, and regenerates only untouched upcoming slots.
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
  const { programId, customization, sessionLinks } = args;
  const engine = getProgramEngine(programId);
  if (!engine) return { ok: false, error: `Unknown program '${programId}'.` };

  // 1) Load + validate the target block (ownership, active, program match).
  const [
    { data: block, error: blockErr },
    { data: existingProgramInstance, error: instanceErr },
    { data: firstWeekRows, error: firstWeekErr },
  ] = await Promise.all([
    supabase
      .from("training_blocks")
      .select("id, started_on, weeks, program_id, status, deleted_at")
      .eq("id", blockId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("program_instances")
      .select("setup_input, instance")
      .eq("block_id", blockId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("planned_sessions")
      .select("prescription")
      .eq("block_id", blockId)
      .eq("user_id", user.id)
      .eq("week_index", 0),
  ]);
  if (blockErr) return { ok: false, error: blockErr.message };
  if (instanceErr) return { ok: false, error: instanceErr.message };
  if (firstWeekErr) return { ok: false, error: firstWeekErr.message };
  if (!block) return { ok: false, error: "Plan not found." };
  if (block.status !== "active" || block.deleted_at != null) {
    return { ok: false, error: "This plan is no longer active." };
  }
  if ((block.program_id as string | null) !== programId) {
    return { ok: false, error: "Program mismatch — start a new plan to change methodology." };
  }
  const blockStartedOn = block.started_on as string;
  const priorSetupInput =
    (existingProgramInstance?.setup_input as Record<string, unknown> | null) ??
    {};
  const storedStartWeekIndex =
    typeof priorSetupInput.startWeekIndex === "number"
      ? priorSetupInput.startWeekIndex
      : null;
  const firstWeekRefs = (firstWeekRows ?? [])
    .map(
      (row) =>
        (
          row.prescription as {
            programRef?: unknown;
          } | null
        )?.programRef,
    )
    .filter((ref): ref is string => typeof ref === "string");
  const priorStartWeekIndex =
    storedStartWeekIndex ??
    inferProgramStartWeekIndex(
      engine,
      existingProgramInstance?.instance,
      firstWeekRefs,
    );
  const effectiveStartWeekIndex =
    args.startWeekIndex ?? priorStartWeekIndex;

  // 2) Forward-only boundary: freeze calendar slots through today.
  const { data: prof } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const tz = (prof?.timezone as string | null) ?? "UTC";
  const blockMonday = mondayOfYmd(blockStartedOn);
  const elapsedDays = daysBetweenYmd(blockMonday, todayYmd(tz));
  const currentWeekIndex = Math.max(0, Math.floor(elapsedDays / 7));
  const currentDayIndex =
    elapsedDays < 0 ? -1 : ((elapsedDays % 7) + 7) % 7;

  // Re-materialise the stored setup before applying the edit. This gives us a
  // canonical baseline for today's rehab prescription, including legacy rows
  // created before per-session edits gained a durable `userEdited` marker.
  let priorWrite: ProgramInstanceWrite | null = null;
  if (programId === "tactical-barbell") {
    const priorValues =
      priorSetupInput.values &&
      typeof priorSetupInput.values === "object" &&
      !Array.isArray(priorSetupInput.values)
        ? (priorSetupInput.values as Record<string, unknown>)
        : null;
    const priorWeekdays = Array.isArray(priorSetupInput.weekdays)
      ? priorSetupInput.weekdays.filter(
          (day): day is number =>
            typeof day === "number" &&
            Number.isInteger(day) &&
            day >= 0 &&
            day <= 6,
        )
      : null;
    const parsedPriorCustomization =
      priorSetupInput.customization == null
        ? null
        : tbCustomizationSchema.safeParse(priorSetupInput.customization);
    if (
      priorValues &&
      priorWeekdays &&
      (parsedPriorCustomization == null || parsedPriorCustomization.success)
    ) {
      try {
        ({ write: priorWrite } = await computeForeignWrite(
          supabase,
          user,
          engine,
          {
            programId,
            setupValues: priorValues,
            weekdays: priorWeekdays,
            startedOn: blockStartedOn,
            ...(priorStartWeekIndex > 0
              ? { startWeekIndex: priorStartWeekIndex }
              : {}),
            ...(parsedPriorCustomization?.success
              ? { customization: parsedPriorCustomization.data }
              : {}),
          },
        ));
      } catch (error) {
        console.warn(
          "Couldn't reconstruct the prior Tactical Barbell plan; preserving today's rehab:",
          error,
        );
      }
    }
  }

  // 3) Fresh materialise from the new inputs — same engine, ORIGINAL start date.
  let write: ProgramInstanceWrite;
  let instance: unknown;
  try {
    ({ instance, write } = await computeForeignWrite(supabase, user, engine, {
      ...args,
      startedOn: blockStartedOn,
      ...(effectiveStartWeekIndex > 0
        ? { startWeekIndex: effectiveStartWeekIndex }
        : {}),
    }));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Setup failed" };
  }
  if (write.sessions.length === 0) {
    return { ok: false, error: "This program produced no sessions — check your training maxes." };
  }
  const newWeeks = Math.max(write.weeks, currentWeekIndex + 1);

  // 4) Rewrite open slots after today plus an untouched rehab slot scheduled
  //    today. Past rows, today's non-rehab work, and started/skipped rows stay.
  const { data: futureRows, error: frErr } = await supabase
    .from("planned_sessions")
    .select(
      "id, week_index, day_index, slot, role, planned_at, notes, prescription, completed_session_id, skipped_at",
    )
    .eq("block_id", blockId)
    .eq("user_id", user.id)
    .gte("week_index", currentWeekIndex);
  if (frErr) return { ok: false, error: frErr.message };
  const priorRehabByDay = new Map(
    (priorWrite?.sessions ?? []).flatMap((session) => {
      const rehabItems = rehabItemsForComparison(session.prescription);
      return rehabItems.length > 0
        ? [[`${session.weekIndex}-${session.dayIndex}`, rehabItems] as const]
        : [];
    }),
  );
  const dayKey = (
    weekIndex: number,
    dayIndex: number,
  ): `${number}-${number}` =>
    `${weekIndex}-${dayIndex}`;
  // A limitation swap/drop rewrites a session's items without leaving any
  // marker on the prescription, so the audit table is the only way to know the
  // user accepted an adjustment on that row. Best-effort: losing this lookup
  // must not fail the edit, it only makes preservation less generous.
  const { data: limitationRows } = await supabase
    .from("limitation_adjustments")
    .select("session_id")
    .eq("user_id", user.id)
    .eq("block_id", blockId);
  const limitationAdjustedIds = new Set(
    (limitationRows ?? []).map((row) => row.session_id as string),
  );
  const unavailableStrengthDays = new Set(
    (futureRows ?? []).flatMap((row) =>
      row.role === "strength" &&
      (row.completed_session_id != null || row.skipped_at != null)
        ? [dayKey(row.week_index as number, row.day_index as number)]
        : [],
    ),
  );
  const existingFuture = (futureRows ?? []).map((row) => {
    const key = dayKey(
      row.week_index as number,
      row.day_index as number,
    );
    let touched =
      row.completed_session_id != null ||
      row.skipped_at != null ||
      row.planned_at != null ||
      (typeof row.notes === "string" && row.notes.trim() !== "") ||
      limitationAdjustedIds.has(row.id as string) ||
      prescriptionCarriesUserState(row.prescription as Prescription | null);
    if (row.role === "rehab" && !touched) {
      const priorRehab = priorRehabByDay.get(key);
      touched =
        unavailableStrengthDays.has(key) ||
        priorRehab == null ||
        !prescriptionsEquivalent(
          rehabItemsForComparison(row.prescription as Prescription),
          priorRehab,
        );
    }
    return {
      id: row.id as string,
      weekIndex: row.week_index as number,
      dayIndex: row.day_index as number,
      slot: (row.slot as string) ?? "single",
      role: (row.role as string | null) ?? undefined,
      touched,
    };
  });
  const touchedSeparateRehabDays = new Set(
    existingFuture.flatMap((row) =>
      row.role === "rehab" && row.touched
        ? [dayKey(row.weekIndex, row.dayIndex)]
        : [],
    ),
  );
  const sessionsForRewrite = write.sessions.map((session) =>
    session.role === "strength" &&
    touchedSeparateRehabDays.has(
      dayKey(session.weekIndex, session.dayIndex),
    )
      ? {
          ...session,
          prescription: stripEmbeddedRehab(session.prescription),
        }
      : session,
  );
  const plan = planForwardOnlyRewrite({
    currentWeekIndex,
    currentDayIndex,
    writeWeeks: write.weeks,
    existingFuture,
    newSessions: sessionsForRewrite.map((s) => ({
      weekIndex: s.weekIndex,
      dayIndex: s.dayIndex,
      slot: s.slot,
      role: s.role,
    })),
  });

  // A row the plan keeps (touched, or earlier than today) holds on to its core
  // work. Refresh only an unedited rehab section on it; a touched standalone
  // rehab row suppresses embedding on that day so the obligation is not doubled.
  // Preservation is read off the plan rather than re-derived — a row that is
  // being deleted must not also receive an in-place update.
  const deleteIdSet = new Set(plan.deleteIds);
  const strengthPrescriptionUpdates = (futureRows ?? []).flatMap((row, index) => {
    const rewriteRow = existingFuture[index]!;
    const isPast =
      rewriteRow.weekIndex === currentWeekIndex &&
      rewriteRow.dayIndex < currentDayIndex;
    const isPreservedStrength =
      !isPast &&
      rewriteRow.role === "strength" &&
      !deleteIdSet.has(rewriteRow.id);
    if (
      !isPreservedStrength ||
      row.completed_session_id != null ||
      row.skipped_at != null
    ) {
      return [];
    }
    const generated = sessionsForRewrite.find(
      (session) =>
        session.role === "strength" &&
        session.weekIndex === rewriteRow.weekIndex &&
        session.dayIndex === rewriteRow.dayIndex &&
        session.slot === rewriteRow.slot,
    );
    if (!generated) return [];

    const currentPrescription = row.prescription as Prescription;
    const currentSnapshot = embeddedRehabSnapshot(currentPrescription);
    const currentCarriesRehab =
      currentSnapshot.items.length > 0 || currentSnapshot.sections.length > 0;
    const priorRehab = priorRehabByDay.get(
      dayKey(rewriteRow.weekIndex, rewriteRow.dayIndex),
    );
    const currentRehabWasEdited =
      (currentPrescription.meta?.removedEmbeddedRehabSourceRefs?.length ?? 0) >
        0 ||
      (currentCarriesRehab &&
        (priorRehab == null ||
          !prescriptionsEquivalent(
            rehabItemsForComparison(currentPrescription),
            priorRehab,
          )));
    if (currentRehabWasEdited) return [];

    const prescription = replaceEmbeddedRehab(
      currentPrescription,
      generated.prescription,
    );
    return prescriptionsEquivalent(currentPrescription, prescription)
      ? []
      : [
          {
            id: rewriteRow.id,
            weekIndex: rewriteRow.weekIndex,
            dayIndex: rewriteRow.dayIndex,
            slot: rewriteRow.slot,
            currentPrescription,
            prescription,
          },
        ];
  });

  // Today's workout is regenerated like any other day UNLESS the user has
  // invested in it — started it, rescheduled it, annotated it, or accepted an
  // adjustment on it. Then it keeps its own plan, which makes the save look
  // like it did nothing. Report whether that actually held something back so
  // the UI can say so instead of staying silent.
  const todayLeftAsIs = (futureRows ?? []).some((row, index) => {
    const rewriteRow = existingFuture[index]!;
    if (
      rewriteRow.weekIndex !== currentWeekIndex ||
      rewriteRow.dayIndex !== currentDayIndex ||
      rewriteRow.role !== "strength" ||
      // Being replaced outright — nothing was withheld.
      deleteIdSet.has(rewriteRow.id)
    ) {
      return false;
    }
    const generated = sessionsForRewrite.find(
      (session) =>
        session.role === "strength" &&
        session.weekIndex === rewriteRow.weekIndex &&
        session.dayIndex === rewriteRow.dayIndex &&
        session.slot === rewriteRow.slot,
    );
    if (!generated) return false;
    // Compare against what this row will ACTUALLY hold after the refresh, so a
    // rehab-only change that did land isn't reported as withheld.
    const effective =
      strengthPrescriptionUpdates.find((u) => u.id === rewriteRow.id)
        ?.prescription ?? (row.prescription as Prescription);
    return !prescriptionsEquivalent(effective, generated.prescription);
  });


  // 5) Build replacement rows and execute the prescription refresh, deletes,
  // and inserts in one transaction. Every mutation carries its read snapshot,
  // so a concurrent start/edit aborts the entire rewrite.
  const futureRowsById = new Map(
    (futureRows ?? []).map((row) => [row.id as string, row]),
  );
  const deletedProvenance = plan.deleteIds.flatMap((id) => {
    const row = futureRowsById.get(id);
    const prescription = row?.prescription as Prescription | undefined;
    const sources =
      prescription?.meta?.embeddedRehabMigrationSources ?? [];
    return row && sources.length > 0
      ? [
          {
            programRef: prescription?.programRef ?? null,
            weekIndex: row.week_index as number,
            dayIndex: row.day_index as number,
            slot: (row.slot as string) ?? "single",
            role: (row.role as string | null) ?? "",
            sources,
          },
        ]
      : [];
  });
  const claimedProvenance = new Set<number>();
  const attachMigrationSources = (
    prescription: Prescription,
    sources: NonNullable<
      NonNullable<Prescription["meta"]>["embeddedRehabMigrationSources"]
    >,
  ): Prescription => {
    const byPlannedSessionId = new Map(
      [
        ...(prescription.meta?.embeddedRehabMigrationSources ?? []),
        ...sources,
      ].map((source) => [
        source.migrationSource.plannedSessionId,
        source,
      ]),
    );
    return {
      ...prescription,
      meta: {
        ...prescription.meta,
        embeddedRehabMigrationSources: Array.from(
          byPlannedSessionId.values(),
        ),
      },
    };
  };
  const replacementSessions = plan.insertIndices.map(
    (index) => sessionsForRewrite[index]!,
  );
  const provenanceByReplacement = new Map<
    number,
    (typeof deletedProvenance)[number]["sources"]
  >();
  replacementSessions.forEach((session, replacementIndex) => {
    const provenanceIndex = deletedProvenance.findIndex(
      (entry, index) =>
        !claimedProvenance.has(index) &&
        entry.programRef != null &&
        session.prescription.programRef != null &&
        entry.programRef === session.prescription.programRef,
    );
    if (provenanceIndex < 0) return;
    claimedProvenance.add(provenanceIndex);
    provenanceByReplacement.set(
      replacementIndex,
      deletedProvenance[provenanceIndex]!.sources,
    );
  });
  replacementSessions.forEach((session, replacementIndex) => {
    if (provenanceByReplacement.has(replacementIndex)) return;
    const provenanceIndex = deletedProvenance.findIndex(
      (entry, index) =>
        !claimedProvenance.has(index) &&
        entry.weekIndex === session.weekIndex &&
        entry.dayIndex === session.dayIndex &&
        entry.slot === session.slot &&
        entry.role === session.role,
    );
    if (provenanceIndex < 0) return;
    claimedProvenance.add(provenanceIndex);
    provenanceByReplacement.set(
      replacementIndex,
      deletedProvenance[provenanceIndex]!.sources,
    );
  });
  const newRows = replacementSessions.map((s, replacementIndex) => {
    const matchingSources =
      provenanceByReplacement.get(replacementIndex) ?? [];
    return {
      block_id: blockId,
      user_id: user.id,
      week_index: s.weekIndex,
      day_index: s.dayIndex,
      slot: s.slot,
      title: s.title,
      role: s.role,
      prescription:
        matchingSources.length > 0
          ? attachMigrationSources(s.prescription, matchingSources)
          : s.prescription,
      session_modality: s.sessionModality,
      effective_stress_load: s.effectiveStressLoad,
    };
  });
  const unmatchedSources = deletedProvenance.flatMap((entry, index) =>
    claimedProvenance.has(index) ? [] : entry.sources,
  );
  if (unmatchedSources.length > 0) {
    const insertionIndex = newRows.findIndex((row) => row.role === "strength");
    if (insertionIndex >= 0) {
      const target = newRows[insertionIndex]!;
      newRows[insertionIndex] = {
        ...target,
        prescription: attachMigrationSources(
          target.prescription,
          unmatchedSources,
        ),
      };
    } else if (strengthPrescriptionUpdates[0]) {
      const target = strengthPrescriptionUpdates[0];
      strengthPrescriptionUpdates[0] = {
        ...target,
        prescription: attachMigrationSources(
          target.prescription,
          unmatchedSources,
        ),
      };
    } else {
      return {
        ok: false,
        error: "Couldn't preserve rehab migration history during this update.",
      };
    }
  }
  const deletionSnapshots = plan.deleteIds.flatMap((id) => {
    const row = futureRowsById.get(id);
    return row
      ? [
          {
            id,
            weekIndex: row.week_index as number,
            dayIndex: row.day_index as number,
            slot: (row.slot as string) ?? "single",
            role: (row.role as string | null) ?? "",
            currentPrescription: row.prescription as Prescription,
          },
        ]
      : [];
  });
  if (deletionSnapshots.length !== plan.deleteIds.length) {
    return {
      ok: false,
      error: "Couldn't build a safe snapshot of upcoming workouts.",
    };
  }
  const { error: rewriteErr } = await supabase.rpc(
    "rewrite_planned_sessions_atomically",
    {
      p_block_id: blockId,
      p_strength_updates: strengthPrescriptionUpdates,
      p_deletions: deletionSnapshots,
      p_insertions: newRows,
    },
  );
  if (rewriteErr) {
    return {
      ok: false,
      error: `Couldn't update upcoming workouts: ${rewriteErr.message}`,
    };
  }

  // 6) Update block metadata (id + started_on unchanged). Re-seed tm_percent so
  //    regenerated workouts render correct weights — a no-op when the user only
  //    changed cardio (the common case), since the seeds are identical.
  const cardioPresent = !!(args.cardioWeekdays && args.cardioWeekdays.length > 0);
  await supabase
    .from("training_blocks")
    .update({
      weeks: newWeeks,
      days_per_week: write.daysPerWeek,
      day_index_overrides: write.dayIndexOverrides,
      cardio_source: cardioPresent ? "external" : "internal",
      notes: customization?.displayName ?? engine.meta.name,
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

  // 7) Keep the active program instance in sync (serialised state + wizard input).
  const { data: pi } = await supabase
    .from("program_instances")
    .update({
      instance,
      setup_input: programSetupAuditInput({
        values: args.setupValues,
        weekdays: args.weekdays,
        startedOn: blockStartedOn,
        startWeekIndex: effectiveStartWeekIndex,
        ...(customization ? { customization } : {}),
        ...(sessionLinks ? { sessionLinks } : {}),
      }),
      display_name: customization?.displayName ?? null,
      customization_version: customization?.version ?? null,
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
    todayLeftAsIs,
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
  { programId, setupValues, weekdays, startedOn, startWeekIndex, roundingKg, twoADay, seasonBlockId }: DeployArgs,
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
      // ADR 0024 — per-block accessory volume (wizard Loadout step). The
      // instance is what materialisation reads, but the column is the one the
      // off-plan quick-generate fallback and any block-level query look at, so
      // keep the row honest rather than leaving it on the 'medium' default.
      accessory_volume: resolveAccessoryVolumeLevel(instance.accessoryVolume),
      // Per-block antagonist-superset choice (migration 0111, wizard Schedule
      // step). Applies to ALL programs; default OFF when the toggle is unset so
      // the per-block value wins over the profile pref at read time.
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
      setup_input: programSetupAuditInput({
        values: setupValues,
        weekdays,
        startedOn,
        startWeekIndex,
      }),
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
