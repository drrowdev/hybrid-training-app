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
 *   → materialise the program graph → one database transaction that archives
 *     any prior active graph and writes the replacement block, sessions,
 *     training-max alignment, and program instance.
 *
 * Guardrails: explicit auth check, Zod `.strict()` on input, user-scoped client,
 * and a database-owned transaction so a partial failure leaves no split plan.
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
import { isMissingRpc } from "@/lib/supabase/rpc-errors";
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
  tbTemplateSeries,
  TB_MOVEMENT_LABEL,
} from "@hta/tacticalbarbell";
import {
  findOrphanedLinkMembers,
  linksBySeries,
  normalizeSessionLinks,
  parseStoredSessionLinks,
  sessionLinksSchema,
  type SessionLinks,
} from "./session-links";
import {
  rehabScheduleSchema,
  parseStoredRehabSchedule,
  weeklyRehabPlan,
  type RehabSchedule,
} from "./rehab-schedule";
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
import { getDeloadWeekPreview } from "@/lib/planner/deload-week-preview";
import {
  planForwardOnlyRewrite,
  prescriptionsEquivalent,
} from "./forward-rewrite";
import { todayYmd, mondayOfYmd, daysBetweenYmd } from "@/lib/dates";
import { programSetupAuditInput } from "./setup-audit";
import { catalogMovementLoadKind } from "./custom-movement-kind";
import { prescriptionCarriesUserState } from "@/lib/sessions/prescription-mutations";
import {
  inferProgramStartWeekIndex,
  shiftWeekIndexForInsertedWeeks,
} from "@/lib/plan/program-overview";
import {
  customizationDays,
  activationRehabProtocols,
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

/**
 * Every strength-series key the current template can populate, mapped to the
 * lifts that currently occupy it. This is the one canonical membership source
 * used to validate a superset link — the engine's own series projection
 * (`tbTemplateSeries` for weekly templates, `weeklySessions` for Activation)
 * overlaid with whichever customization is present, so it runs the same way
 * whether or not a customization blob was sent, and for Activation too, not
 * only weekly V1 templates.
 *
 * This is the server-side twin of `seriesMovementSetsForTemplate` in
 * `apps/web/src/components/program/ProgramPicker.tsx`, which the wizard uses
 * to re-key `sessionLinks` at a template switch. They compute the same
 * membership from two different template representations, so a future change
 * to one's slot/series logic should be checked against the other to avoid the
 * two silently drifting apart.
 */
function strengthSeriesMembership(
  programId: string,
  setupValues: Record<string, unknown>,
  customization: TbCustomization | undefined,
): Record<string, string[]> {
  if (programId !== "tactical-barbell") return {};
  const templateId =
    typeof setupValues.templateId === "string" ? setupValues.templateId : undefined;
  const tbTemplate = templateId ? getTbTemplate(templateId) : undefined;
  if (!tbTemplate) return {};

  if (tbTemplate.id === "activation") {
    const membership: Record<string, string[]> = {};
    for (const session of tbTemplate.weeklySessions) {
      const phase = activationPhaseForSession(session);
      const key = activationCustomizationKey(session);
      if (!phase || !key) continue;
      const canonical = (session.fixedMovements ?? []).map((m) => m.movement);
      const config =
        customization && isTbActivationCustomization(customization)
          ? customization.phases[phase]?.sessions[key]
          : undefined;
      if (config == null) {
        // Uncustomized (or no config for this session yet) — the template's
        // own default is what the engine deploys.
        membership[key] = canonical;
      } else if (!config.enabled) {
        membership[key] = [];
      } else {
        // A source movement is only gone when explicitly overridden to null;
        // absent from the map means unchanged, matching how the wizard's own
        // link editor decides what is still linkable (`activationLinkableMovements`).
        membership[key] = canonical.filter(
          (movement) => config.movementOverrides[movement] !== null,
        );
      }
    }
    return membership;
  }

  const membership: Record<string, string[]> = {};
  const customizedSeries =
    customization && isTbCustomizationV1(customization)
      ? customization.sessionMovements
      : undefined;
  for (const series of tbTemplateSeries(tbTemplate)) {
    const customized = customizedSeries?.[series.key];
    // Links are keyed by SLOT, the same identity the engine realises them
    // against — so a link survives swapping the exercise in that slot.
    membership[series.key] = customized
      ? customized.map((movement) => movement.sourceMovement ?? movement.movement)
      : series.slots.map((slot) => slot.sourceMovement);
  }
  return membership;
}
// `tbTemplateSeries` (packages/tacticalbarbell) falls back to the template's
// static `defaultCluster` for a session with no per-session `fixedMovements`
// (Gladiator/Mass/Grey Man, and Zulu I/A too — its sessions have no
// `fixedMovements` either), rather than the setup's actual resolved cluster.
// For a template like Zulu I/A, whose `clusterMin`/`clusterMax` differ, the
// wizard's own `clusterEditable` gate is true, so a lifter genuinely CAN pick
// a cluster that diverges from `defaultCluster` — this fallback does not
// track that pick.
//
// It stays safe here because the client-side counterpart, `sessionSeriesFor`
// in ProgramPicker.tsx (which `seriesMovementSetsForTemplate` builds on), has
// the exact same fallback: it also returns `template.defaultCluster` rather
// than the live `cluster` state whenever a template has no `sessionSeries`.
// Both sides are blind to the lifter's real cluster in the same way, so they
// stay consistent with EACH OTHER — a link naming a movement outside
// `defaultCluster` is pruned client-side at the same switch it would be
// rejected server-side, not silently accepted by one and refused by the
// other. This is a pre-existing property of both `tbTemplateSeries` and
// `sessionSeriesFor` (neither introduced or changed by this fix; the slot-
// claim check elsewhere in this file already relied on the same
// `tbTemplateSeries` fallback), not something newly introduced here.
// Making either side track the lifter's actually-resolved cluster is a
// separate, larger change — it would mean threading the live cluster through
// both `strengthSeriesMembership` and `seriesMovementSetsForTemplate` — and is
// out of scope for this fix.

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
    /**
     * Where a weekly Tactical Barbell block runs its rehab protocol — on the
     * warm-up of named sessions, on standalone weekdays, or both. A sibling of
     * `customization` rather than a field inside it, for the reason ADR 0071
     * gives for the links: that blob is a strict union parsed as one unit.
     */
    rehabSchedule: rehabScheduleSchema.optional(),
    /** When present, this deploy is a forward-only EDIT of an existing active
     *  block (5/3/1 / Tactical Barbell only): keep the same block + program
     *  instance, preserve everything through today plus touched rows, and
     *  regenerate only untouched upcoming workouts. */
    editBlockId: z.string().uuid().optional(),
    /** When present, the wizard was deep-linked from a Season roadmap (ADR 0051):
     *  activate this planned season_block + link it to the new block on deploy. */
    seasonBlockId: z.string().uuid().optional(),
    /**
     * Lead the new block with a recovery week. Offered after a peak week, where
     * the program advises deloading between blocks and there is no room left in
     * the block that just ended.
     */
    startWithRecoveryWeek: z.boolean().optional(),
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
  const { programId, setupValues, weekdays, cardioWeekdays, startedOn, raceDate, startWeekIndex, roundingKg, accessories, twoADay, customization, sessionLinks: rawSessionLinks, rehabSchedule, editBlockId, seasonBlockId, rehabBindings, startWithRecoveryWeek } = parsed.data;
  const sessionLinks = normalizeSessionLinks(rawSessionLinks);

  if (rehabSchedule && programId !== "tactical-barbell") {
    return {
      ok: false,
      error: "Only Tactical Barbell templates can schedule rehab protocols.",
    };
  }

  if (sessionLinks && programId !== "tactical-barbell") {
    return {
      ok: false,
      error: "Only Tactical Barbell templates can link lifts into supersets.",
    };
  }

  // A link may only reference lifts the session actually contains. The engine
  // already refuses to realise a link with a missing member, but it does so
  // SILENTLY — the lifter would deploy, and the superset would simply not be
  // there. `strengthSeriesMembership` is the engine's own canonical series
  // membership (customization overlaid when present, the template's default
  // otherwise), so this check runs regardless of whether a customization blob
  // was sent — including canonical weekly templates and canonical Activation,
  // which previously slipped through unchecked.
  //
  // Rehab series are validated separately below: they exist with or without a
  // customization, so they cannot live inside this branch. Echo them back here
  // so they pass — `findOrphanedLinkMembers` reads an unknown key as "no
  // movements available" and would condemn every rehab link as orphaned.
  if (sessionLinks && programId === "tactical-barbell") {
    const orphans = findOrphanedLinkMembers(
      sessionLinks,
      Object.fromEntries([
        ...Object.entries(
          strengthSeriesMembership(programId, setupValues, customization),
        ),
        ...Object.entries(sessionLinks.bySeries)
          .filter(([key]) => key.startsWith("rehab."))
          .map(([key, links]) => [key, links.flatMap((link) => link.members)]),
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

  // A weekly block can carry rehab with no customization at all — the envelope
  // is independent of it — so its rehab series are validated on their own. A
  // `rehab.*` key naming a protocol the block no longer runs would silently
  // attach to whatever later takes that id.
  if (
    sessionLinks &&
    programId === "tactical-barbell" &&
    (customization == null || isTbCustomizationV1(customization))
  ) {
    const weeklyRehab = weeklyRehabPlan(customization, rehabSchedule);
    const known = new Map(
      weeklyRehab.protocols.map((protocol) => [
        rehabSeriesKey(protocol.localProtocolId),
        protocol.items.map((item) => item.movementId),
      ]),
    );
    for (const seriesKey of Object.keys(sessionLinks.bySeries)) {
      if (!seriesKey.startsWith("rehab.")) continue;
      if (known.has(seriesKey)) continue;
      return {
        ok: false,
        error:
          "A linked superset belongs to a rehab protocol that no longer exists. Remove the link and re-create it.",
      };
    }
    const rehabOrphans = findOrphanedLinkMembers(
      sessionLinks,
      Object.fromEntries(known),
    ).filter((entry) => entry.seriesKey.startsWith("rehab."));
    if (rehabOrphans.length > 0) {
      const count = rehabOrphans.reduce((n, o) => n + o.missing.length, 0);
      return {
        ok: false,
        error: `A linked superset references ${count === 1 ? "a movement" : "movements"} that aren't in that rehab protocol anymore. Remove the link or add the ${count === 1 ? "movement" : "movements"} back.`,
      };
    }
  }

  // Activation's rehab protocols must also be checked on their own: a weekly
  // block's rehab validation above only runs for weekly customizations, and
  // Activation's strength-series check (in the unconditional block above) does
  // not cover rehab. A `rehab.*` key naming a protocol that no longer exists
  // (ids are reused as ordinals) would attach to whatever protocol later takes
  // that id. Reject it rather than let a stale link silently adopt an
  // unrelated protocol.
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
        // Strength series were already checked against `strengthSeriesMembership`
        // in the unconditional block above (it enumerates Activation's phase
        // sessions too, via `activationPhaseForSession`/`activationCustomizationKey`),
        // so a strength key reaching this rehab-focused filter is already known
        // sound. Echo it back rather than re-deriving it here, so this block
        // stays about rehab only and doesn't condemn an already-valid link.
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
      ...(rehabSchedule ? { rehabSchedule } : {}),
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
    const nativeResult = await createNativeProgramInstance(supabase, user, {
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
    if (nativeResult.ok && startWithRecoveryWeek) {
      await leadBlockWithRecoveryWeek(supabase, user.id);
    }
    return nativeResult;
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
    ...(rehabSchedule ? { rehabSchedule } : {}),
    ...(seasonBlockId ? { seasonBlockId } : {}),
    ...(startWithRecoveryWeek ? { startWithRecoveryWeek: true } : {}),
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
  /** Where a weekly Tactical Barbell block runs its rehab protocol. */
  rehabSchedule?: RehabSchedule;
  /** When the wizard was deep-linked from a Season roadmap (ADR 0051) — the
   *  planned season_block to activate + link to the new training block on deploy. */
  seasonBlockId?: string;
  /** Lead the new block with a recovery week (post-peak, TB3). */
  startWithRecoveryWeek?: boolean;
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
  { programId, setupValues, weekdays, cardioWeekdays, startedOn, raceDate, startWeekIndex, roundingKg, accessories, twoADay, customization, sessionLinks, rehabSchedule }: DeployArgs,
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
      // Re-derive at the trusted server boundary. Stored customizations created
      // before this rule may carry the template slot's stale kind, and trusting
      // it can put the whole bodyweight-inclusive max on a dip belt.
      kind: catalogMovementLoadKind({
        hasOneRm: ctx.oneRepMaxes[movement.movement] != null,
        slug: catalog?.slug,
      }),
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
    // A slot claim decides which prescription (main vs supplemental, and its
    // sets/reps/%) the entry inherits, so it has to name a slot this template
    // actually has in that session. Unchecked, a hand-crafted payload could
    // claim an arbitrary slot and pull its loading onto any movement.
    if (isTbCustomizationV1(customization)) {
      const tbTemplate =
        typeof setupValues.templateId === "string"
          ? getTbTemplate(setupValues.templateId)
          : undefined;
      if (tbTemplate) {
        const slotsBySeries = new Map(
          tbTemplateSeries(tbTemplate).map((series) => [
            series.key,
            new Set(series.slots.map((slot) => slot.sourceMovement)),
          ]),
        );
        for (const [seriesKey, movements] of Object.entries(
          customization.sessionMovements,
        )) {
          const known = slotsBySeries.get(seriesKey);
          for (const movement of movements) {
            if (!movement.sourceMovement) continue;
            if (!known?.has(movement.sourceMovement)) {
              throw new Error(
                `Customized movement '${movement.movement}' refers to a slot this template no longer has. Review the program setup.`,
              );
            }
          }
        }
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
    ...(rehabSchedule ? { rehabSchedule } : {}),
  });
  // Active limitations are checked against everything the block will actually
  // prescribe. Rehab now reaches a block through the envelope as well as the
  // customization, so it is read here even when there is no customization.
  const weeklyRehabItems = weeklyRehabPlan(
    customization && isTbCustomizationV1(customization) ? customization : undefined,
    rehabSchedule,
  ).protocols.flatMap((protocol) => protocol.items);
  if (customization || weeklyRehabItems.length > 0) {
    const limitations = await readLimitationsContext(supabase, user.id);
    const catalog = customizationCatalog;
    const byId = new Map(catalog.map((movement) => [movement.id, movement]));
    const selectedIds = new Set<string>();
    if (customization == null || isTbCustomizationV1(customization)) {
      for (const item of weeklyRehabItems) {
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
    const replacementMovements =
      customization == null
        ? []
        : isTbCustomizationV1(customization)
          ? Object.values(customization.sessionMovements).flat()
          : effectiveActivationMovements(customization, startWeekIndex ?? 0);
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

type LegacyProgramDeployment = {
  block: {
    programId: string;
    programFamily: string;
    startedOn: string;
    weeks: number;
    daysPerWeek: number;
    dayIndexOverrides: {
      days: number[];
      twoADay: boolean;
      placements?: unknown;
    } | null;
    cardioSource: string;
    allowsTwoADays: boolean;
    accessoryVolume: string;
    notes: string;
  };
  plannedSessions: Array<{
    weekIndex: number;
    dayIndex: number;
    slot: string;
    title: string;
    role: string;
    prescription: Prescription;
    sessionModality: string | null | undefined;
    effectiveStressLoad: number | null | undefined;
  }>;
  tmPercents: ProgramInstanceWrite["tmPercents"];
  programInstance: {
    programId: string;
    programFamily: string;
    instance: unknown;
    setupInput: Record<string, unknown>;
    displayName: string | null;
    customizationVersion: number | null;
  };
};

type LegacyDeploymentResult = {
  data: Array<{ block_id: string; program_instance_id: string }> | null;
  error: { message: string } | null;
};

/**
 * Keeps the immediately preceding app version functional during the short
 * app-first rollout before migration 0144 has installed its RPC.
 */
async function deployProgramInstanceLegacy(
  supabase: SupabaseClient,
  user: User,
  input: LegacyProgramDeployment,
): Promise<LegacyDeploymentResult> {
  const { data: block, error: blockError } = await supabase
    .from("training_blocks")
    .insert({
      user_id: user.id,
      archetype: null,
      program_id: input.block.programId,
      program_family: input.block.programFamily,
      started_on: input.block.startedOn,
      weeks: input.block.weeks,
      status: "active",
      days_per_week: input.block.daysPerWeek,
      day_index_overrides: input.block.dayIndexOverrides,
      cardio_source: input.block.cardioSource,
      allows_two_a_days: input.block.allowsTwoADays,
      accessory_volume: input.block.accessoryVolume,
      notes: input.block.notes,
    })
    .select("id")
    .single();
  if (blockError || !block) {
    // The active-row index is the final guard during a fully stale PostgREST
    // cache, when neither new RPC is visible. It rejects the old
    // insert-before-archive flow before it mutates the prior plan.
    if (blockError?.code === "23505") {
      return {
        data: null,
        error: {
          message:
            "Program deployment is temporarily unavailable. Reload and try again.",
        },
      };
    }
    return {
      data: null,
      error: { message: blockError?.message ?? "Failed to create block" },
    };
  }
  const blockId = block.id as string;
  const priorTmPercent = new Map<string, number | string | null>();
  const movementIds = input.tmPercents.map((seed) => seed.movementId);
  if (movementIds.length > 0) {
    const { data: priorRows, error: priorTmError } = await supabase
      .from("training_maxes")
      .select("movement_id, tm_percent")
      .eq("user_id", user.id)
      .in("movement_id", movementIds);
    if (priorTmError) {
      const { error: deleteError } = await supabase
        .from("training_blocks")
        .delete()
        .eq("id", blockId)
        .eq("user_id", user.id);
      return {
        data: null,
        error: {
          message: deleteError
            ? `Couldn't read training maxes: ${priorTmError.message} (${deleteError.message})`
            : `Couldn't read training maxes: ${priorTmError.message}`,
        },
      };
    }
    for (const row of priorRows ?? []) {
      priorTmPercent.set(
        row.movement_id as string,
        (row.tm_percent as number | string | null) ?? null,
      );
    }
  }
  const cleanUpBlock = async () => {
    const errors: string[] = [];
    for (const [movementId, tmPercent] of priorTmPercent) {
      const { error } = await supabase
        .from("training_maxes")
        .update({ tm_percent: tmPercent })
        .eq("user_id", user.id)
        .eq("movement_id", movementId);
      if (error) errors.push(error.message);
    }
    const { error } = await supabase
      .from("planned_sessions")
      .delete()
      .eq("block_id", blockId)
      .eq("user_id", user.id);
    if (error) errors.push(error.message);
    const { error: deleteError } = await supabase
      .from("training_blocks")
      .delete()
      .eq("id", blockId)
      .eq("user_id", user.id);
    if (deleteError) errors.push(deleteError.message);
    return errors.length > 0 ? errors.join("; ") : null;
  };

  const { error: sessionsError } = await supabase.from("planned_sessions").insert(
    input.plannedSessions.map((session) => ({
      block_id: blockId,
      user_id: user.id,
      week_index: session.weekIndex,
      day_index: session.dayIndex,
      slot: session.slot,
      title: session.title,
      role: session.role,
      prescription: session.prescription,
      session_modality: session.sessionModality,
      effective_stress_load: session.effectiveStressLoad,
    })),
  );
  if (sessionsError) {
    const cleanupError = await cleanUpBlock();
    return {
      data: null,
      error: {
        message: cleanupError
          ? `Couldn't create planned sessions: ${sessionsError.message} (${cleanupError})`
          : `Couldn't create planned sessions: ${sessionsError.message}`,
      },
    };
  }

  for (const seed of input.tmPercents) {
    const { error } = await supabase
      .from("training_maxes")
      .update({ tm_percent: seed.tmPercent })
      .eq("user_id", user.id)
      .eq("movement_id", seed.movementId);
    if (error) {
      const cleanupError = await cleanUpBlock();
      return {
        data: null,
        error: {
          message: cleanupError
            ? `Couldn't align training maxes: ${error.message} (${cleanupError})`
            : `Couldn't align training maxes: ${error.message}`,
        },
      };
    }
  }

  const { data: programInstance, error: programInstanceError } = await supabase
    .from("program_instances")
    .insert({
      user_id: user.id,
      program_id: input.programInstance.programId,
      program_family: input.programInstance.programFamily,
      instance: input.programInstance.instance,
      setup_input: input.programInstance.setupInput,
      display_name: input.programInstance.displayName,
      customization_version: input.programInstance.customizationVersion,
      block_id: blockId,
      status: "active",
    })
    .select("id")
    .single();
  if (programInstanceError || !programInstance) {
    const cleanupError = await cleanUpBlock();
    return {
      data: null,
      error: {
        message: cleanupError
          ? `${programInstanceError?.message ?? "Failed to create program instance"} (${cleanupError})`
          : (programInstanceError?.message ?? "Failed to create program instance"),
      },
    };
  }

  const { error: archiveBlockError } = await supabase
    .from("training_blocks")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("id", blockId);
  if (archiveBlockError) {
    return { data: null, error: { message: archiveBlockError.message } };
  }
  const { error: archiveInstanceError } = await supabase
    .from("program_instances")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("id", programInstance.id);
  if (archiveInstanceError) {
    return { data: null, error: { message: archiveInstanceError.message } };
  }

  return {
    data: [
      {
        block_id: blockId,
        program_instance_id: programInstance.id as string,
      },
    ],
    error: null,
  };
}

async function deployProgramInstanceDuringMigration(
  supabase: SupabaseClient,
  user: User,
  input: LegacyProgramDeployment,
): Promise<LegacyDeploymentResult> {
  // A stale PostgREST schema cache can temporarily hide the new deployment
  // RPC after its active-row indexes already exist. Never run the old
  // insert-before-archive sequence when the migration function is visible.
  const { data: workflowsReady, error: readinessError } = await supabase.rpc(
    "atomic_user_workflows_ready",
  );
  if (readinessError && !isMissingRpc(readinessError)) {
    return { data: null, error: { message: readinessError.message } };
  }
  if (workflowsReady === true) {
    return {
      data: null,
      error: {
        message:
          "Program deployment is temporarily unavailable. Reload and try again.",
      },
    };
  }
  // When a fully stale cache cannot see either function, the active-row index
  // makes the legacy insert fail before it changes an existing program.
  return deployProgramInstanceLegacy(supabase, user, input);
}

/**
 * Foreign per-session engine deploy (5/3/1, Tactical Barbell, Green Protocol).
 * Behaviour is byte-identical to the pre-refactor inline flow.
 */
async function createForeignProgramInstance(
  supabase: SupabaseClient,
  user: User,
  { programId, setupValues, weekdays, cardioWeekdays, startedOn, raceDate, startWeekIndex, roundingKg, accessories, seasonBlockId, twoADay, customization, sessionLinks, rehabSchedule, startWithRecoveryWeek }: DeployArgs,
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
      ...(sessionLinks ? { sessionLinks } : {}),
      ...(rehabSchedule ? { rehabSchedule } : {}),
    }));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Setup failed" };
  }

  if (write.sessions.length === 0) {
    return { ok: false, error: "This program produced no sessions — check your training maxes." };
  }

  const deploymentInput = {
    block: {
      programId,
      programFamily: engine.meta.family,
      startedOn,
      weeks: write.weeks,
      daysPerWeek: write.daysPerWeek,
      dayIndexOverrides: write.dayIndexOverrides,
      cardioSource:
        cardioWeekdays && cardioWeekdays.length > 0 ? "external" : "internal",
      allowsTwoADays: programId === "hyrox" ? !!twoADay : false,
      accessoryVolume: "medium",
      notes: customization?.displayName ?? engine.meta.name,
    },
    plannedSessions: write.sessions.map((session) => ({
      weekIndex: session.weekIndex,
      dayIndex: session.dayIndex,
      slot: session.slot,
      title: session.title,
      role: session.role,
      prescription: session.prescription,
      sessionModality: session.sessionModality,
      effectiveStressLoad: session.effectiveStressLoad,
    })),
    tmPercents: write.tmPercents,
    programInstance: {
      programId,
      programFamily: engine.meta.family,
      instance,
      setupInput: programSetupAuditInput({
        values: setupValues,
        weekdays,
        startedOn,
        startWeekIndex,
        ...(customization ? { customization } : {}),
        ...(sessionLinks ? { sessionLinks } : {}),
        ...(rehabSchedule ? { rehabSchedule } : {}),
      }),
      displayName: customization?.displayName ?? null,
      customizationVersion: customization?.version ?? null,
    },
  };
  const atomicDeployment = await supabase.rpc(
    "deploy_program_instance_atomically",
    {
      p_block: {
        program_id: deploymentInput.block.programId,
        program_family: deploymentInput.block.programFamily,
        started_on: deploymentInput.block.startedOn,
        weeks: deploymentInput.block.weeks,
        days_per_week: deploymentInput.block.daysPerWeek,
        day_index_overrides: deploymentInput.block.dayIndexOverrides,
        cardio_source: deploymentInput.block.cardioSource,
        allows_two_a_days: deploymentInput.block.allowsTwoADays,
        accessory_volume: deploymentInput.block.accessoryVolume,
        notes: deploymentInput.block.notes,
      },
      p_planned_sessions: deploymentInput.plannedSessions.map((session) => ({
        week_index: session.weekIndex,
        day_index: session.dayIndex,
        slot: session.slot,
        title: session.title,
        role: session.role,
        prescription: session.prescription,
        session_modality: session.sessionModality,
        effective_stress_load: session.effectiveStressLoad,
      })),
      p_tm_percents: deploymentInput.tmPercents,
      p_program_instance: {
        program_id: deploymentInput.programInstance.programId,
        program_family: deploymentInput.programInstance.programFamily,
        instance: deploymentInput.programInstance.instance,
        setup_input: deploymentInput.programInstance.setupInput,
        display_name: deploymentInput.programInstance.displayName,
        customization_version: deploymentInput.programInstance.customizationVersion,
      },
    },
  );
  const legacyDeployment = isMissingRpc(atomicDeployment.error)
    ? await deployProgramInstanceDuringMigration(supabase, user, deploymentInput)
    : null;
  const deployment = legacyDeployment?.data ?? atomicDeployment.data;
  const deploymentError = legacyDeployment?.error ?? atomicDeployment.error;
  const deployed = (
    deployment as
      | Array<{ block_id: string; program_instance_id: string }>
      | null
  )?.[0];
  if (deploymentError || !deployed) {
    return {
      ok: false,
      error: deploymentError?.message ?? "Failed to create program instance",
    };
  }
  const blockId = deployed.block_id;

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

  // TB3 advises a deload between blocks. When the peak week that raised the
  // advice was the end of the previous plan, the recovery week can only land at
  // the front of this one.
  if (startWithRecoveryWeek) {
    await leadBlockWithRecoveryWeek(supabase, user.id);
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/stats");

  return {
    ok: true,
    blockId,
    programInstanceId: deployed.program_instance_id,
    skipped: write.skipped.length,
  };
}

/**
 * Put a recovery week in front of the block that was just deployed, and clear
 * the advice that asked for it.
 *
 * Best-effort throughout: a lifter whose plan is already written must never see
 * a deploy fail because the optional light week didn't land.
 */
async function leadBlockWithRecoveryWeek(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  try {
    const preview = await getDeloadWeekPreview(supabase, userId, { prepend: true });
    if (!preview) return;
    const { error } = await supabase.rpc("insert_deload_week", {
      p_block_id: preview.blockId,
      p_user_id: userId,
      p_after_week: -1,
      p_sessions: preview.sessions.map((s) => ({
        day_index: s.dayIndex,
        slot: s.slot,
        title: s.title,
        session_modality: s.sessionModality,
        prescription: s.prescription,
      })),
    });
    if (error) {
      console.error("leading recovery week failed:", error.message);
      return;
    }
    // The advice has been taken; leaving it pending would nag for a second week.
    await supabase
      .from("program_recommendations")
      .update({ status: "accepted", resolved_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("kind", "deload")
      .eq("status", "pending");
  } catch (e) {
    console.error("leading recovery week failed:", e);
  }
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
  const { programId, customization, sessionLinks, rehabSchedule } = args;
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
      .is("deleted_at", null)
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
    // Parsed as siblings, exactly as `edit-context` does. Omitting the rehab
    // envelope here would leave the baseline with no rehab at all for a block
    // that keeps it there — every standalone rehab row would then read as
    // user-edited and be preserved, so a Settings edit could never update one.
    const priorRehabSchedule = parseStoredRehabSchedule(
      priorSetupInput.rehabSchedule,
    );
    const priorSessionLinks = parseStoredSessionLinks(
      priorSetupInput.sessionLinks,
    );
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
            ...(priorRehabSchedule ? { rehabSchedule: priorRehabSchedule } : {}),
            ...(priorSessionLinks ? { sessionLinks: priorSessionLinks } : {}),
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

  // 4) Rewrite open slots after today plus an untouched rehab slot scheduled
  //    today. Past rows, today's non-rehab work, and started/skipped rows stay.
  const { data: blockRows, error: frErr } = await supabase
    .from("planned_sessions")
    .select(
      "id, week_index, day_index, slot, role, planned_at, notes, prescription, completed_session_id, skipped_at",
    )
    .eq("block_id", blockId)
    .eq("user_id", user.id);
  if (frErr) return { ok: false, error: frErr.message };
  const insertedRecoveryWeeks = [
    ...new Set(
      (blockRows ?? []).flatMap((row) =>
        (row.prescription as Prescription | null)?.insertedRecoveryWeek === true
          ? [row.week_index as number]
          : [],
      ),
    ),
  ].sort((a, b) => a - b);
  const futureRows = (blockRows ?? []).filter(
    (row) => (row.week_index as number) >= currentWeekIndex,
  );
  const priorRehabByDay = new Map(
    (priorWrite?.sessions ?? []).flatMap((session) => {
      const rehabItems = rehabItemsForComparison(session.prescription);
      return rehabItems.length > 0
        ? [[`${session.weekIndex}-${session.dayIndex}`, rehabItems] as const]
        : [];
    }),
  );
  const priorRehabByProgramRef = new Map(
    (priorWrite?.sessions ?? []).flatMap((session) => {
      const programRef = session.prescription.programRef;
      const rehabItems = rehabItemsForComparison(session.prescription);
      return programRef && rehabItems.length > 0
        ? [[programRef, rehabItems] as const]
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
    const rowPrescription = row.prescription as Prescription | null;
    let touched =
      row.completed_session_id != null ||
      row.skipped_at != null ||
      row.planned_at != null ||
      (typeof row.notes === "string" && row.notes.trim() !== "") ||
      limitationAdjustedIds.has(row.id as string) ||
      rowPrescription?.insertedRecoveryWeek === true ||
      prescriptionCarriesUserState(rowPrescription);
    if (row.role === "rehab" && !touched) {
      const priorRehab = rowPrescription?.programRef
        ? priorRehabByProgramRef.get(rowPrescription.programRef)
        : priorRehabByDay.get(key);
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
      ...(rowPrescription?.programRef
        ? { programRef: rowPrescription.programRef }
        : {}),
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
  const shiftedSessions = write.sessions.map((session) => ({
    ...session,
    weekIndex: shiftWeekIndexForInsertedWeeks(
      session.weekIndex,
      insertedRecoveryWeeks,
    ),
  }));
  const sessionsForRewrite = shiftedSessions.map((session) =>
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
  const generatedSessionFor = (
    rewriteRow: {
      weekIndex: number;
      dayIndex: number;
      slot: string;
      programRef?: string;
    },
  ) =>
    sessionsForRewrite.find((session) =>
      rewriteRow.programRef
        ? session.prescription.programRef === rewriteRow.programRef
        : session.weekIndex === rewriteRow.weekIndex &&
          session.dayIndex === rewriteRow.dayIndex &&
          session.slot === rewriteRow.slot,
    );
  const plan = planForwardOnlyRewrite({
    currentWeekIndex,
    currentDayIndex,
    writeWeeks: write.weeks + insertedRecoveryWeeks.length,
    existingFuture,
    newSessions: sessionsForRewrite.map((s) => ({
      weekIndex: s.weekIndex,
      dayIndex: s.dayIndex,
      slot: s.slot,
      role: s.role,
      ...(s.prescription.programRef
        ? { programRef: s.prescription.programRef }
        : {}),
    })),
  });
  const newWeeks = plan.newWeeks;

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
    const generated = generatedSessionFor(rewriteRow);
    if (!generated) return [];

    const currentPrescription = row.prescription as Prescription;
    const currentSnapshot = embeddedRehabSnapshot(currentPrescription);
    const currentCarriesRehab =
      currentSnapshot.items.length > 0 || currentSnapshot.sections.length > 0;
    const priorRehab = rewriteRow.programRef
      ? priorRehabByProgramRef.get(rewriteRow.programRef)
      : priorRehabByDay.get(
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
    const generated = generatedSessionFor(rewriteRow);
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
  const atomicRewrite = await supabase.rpc(
    "update_program_instance_atomically",
    {
      p_block_id: blockId,
      p_strength_updates: strengthPrescriptionUpdates,
      p_deletions: deletionSnapshots,
      p_insertions: newRows,
      p_block_metadata: {
        weeks: newWeeks,
        days_per_week: write.daysPerWeek,
        day_index_overrides: write.dayIndexOverrides,
        cardio_source:
          args.cardioWeekdays && args.cardioWeekdays.length > 0
            ? "external"
            : "internal",
        notes: customization?.displayName ?? engine.meta.name,
      },
      p_tm_percents: write.tmPercents,
      p_program_instance: {
        instance,
        setup_input: programSetupAuditInput({
          values: args.setupValues,
          weekdays: args.weekdays,
          startedOn: blockStartedOn,
          startWeekIndex: effectiveStartWeekIndex,
          ...(customization ? { customization } : {}),
          ...(sessionLinks ? { sessionLinks } : {}),
          ...(rehabSchedule ? { rehabSchedule } : {}),
        }),
        display_name: customization?.displayName ?? null,
        customization_version: customization?.version ?? null,
      },
    },
  );
  let updatedProgramInstanceId = atomicRewrite.data;
  let rewriteErr = atomicRewrite.error;
  if (isMissingRpc(rewriteErr)) {
    const { error: legacyRewriteError } = await supabase.rpc(
      "rewrite_planned_sessions_atomically",
      {
        p_block_id: blockId,
        p_strength_updates: strengthPrescriptionUpdates,
        p_deletions: deletionSnapshots,
        p_insertions: newRows,
      },
    );
    if (legacyRewriteError) {
      return {
        ok: false,
        error: `Couldn't update upcoming workouts: ${legacyRewriteError.message}`,
      };
    }

    const { error: blockUpdateError } = await supabase
      .from("training_blocks")
      .update({
        weeks: newWeeks,
        days_per_week: write.daysPerWeek,
        day_index_overrides: write.dayIndexOverrides,
        cardio_source:
          args.cardioWeekdays && args.cardioWeekdays.length > 0
            ? "external"
            : "internal",
        notes: customization?.displayName ?? engine.meta.name,
      })
      .eq("id", blockId)
      .eq("user_id", user.id);
    if (blockUpdateError) {
      return { ok: false, error: `Couldn't update the plan: ${blockUpdateError.message}` };
    }

    for (const seed of write.tmPercents) {
      const { error: tmUpdateError } = await supabase
        .from("training_maxes")
        .update({ tm_percent: seed.tmPercent })
        .eq("user_id", user.id)
        .eq("movement_id", seed.movementId);
      if (tmUpdateError) {
        return {
          ok: false,
          error: `Couldn't align training maxes: ${tmUpdateError.message}`,
        };
      }
    }

    const { data: legacyProgramInstance, error: programInstanceError } = await supabase
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
          ...(rehabSchedule ? { rehabSchedule } : {}),
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
    if (programInstanceError || !legacyProgramInstance) {
      return {
        ok: false,
        error: programInstanceError?.message ?? "Couldn't update the active program instance.",
      };
    }
    updatedProgramInstanceId = legacyProgramInstance.id;
    rewriteErr = null;
  }
  if (rewriteErr) {
    return {
      ok: false,
      error: `Couldn't update upcoming workouts: ${rewriteErr.message}`,
    };
  }

  if (!updatedProgramInstanceId) {
    return {
      ok: false,
      error: "Couldn't update the active program instance.",
    };
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/stats");

  return {
    ok: true,
    blockId,
    programInstanceId: updatedProgramInstanceId as string,
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

  // Materialise the whole block before starting the database transaction. The
  // materializer is pure with respect to the block id, so a placeholder is safe.
  const materializationBlockId = crypto.randomUUID();
  const mat = await engine.materializeNative(
    instance,
    supabase,
    user.id,
    materializationBlockId,
    twoADay ?? false,
  );
  if (!mat.ok) {
    return { ok: false, error: mat.error };
  }
  if (mat.rows.length === 0) {
    return { ok: false, error: "This program produced no sessions — check your training maxes." };
  }
  const hybridTmPercent = resolveHybridTmPercent(setupValues.tmPercent);
  const deploymentInput = {
    block: {
      programId,
      programFamily: engine.meta.family,
      startedOn,
      weeks,
      daysPerWeek,
      dayIndexOverrides,
      cardioSource: "internal",
      allowsTwoADays: twoADay ?? false,
      accessoryVolume: resolveAccessoryVolumeLevel(instance.accessoryVolume),
      notes: engine.meta.name,
    },
    plannedSessions: mat.rows.map((row) => ({
      weekIndex: row.week_index,
      dayIndex: row.day_index,
      slot: row.slot,
      title: row.title,
      role: row.role,
      prescription: row.prescription,
      sessionModality: row.session_modality,
      effectiveStressLoad: row.effective_stress_load,
    })),
    tmPercents: mat.mainMovementIds.map((movementId) => ({
      movementId,
      tmPercent: hybridTmPercent,
    })),
    programInstance: {
      programId,
      programFamily: engine.meta.family,
      instance,
      setupInput: programSetupAuditInput({
        values: setupValues,
        weekdays,
        startedOn,
        startWeekIndex,
      }),
      displayName: null,
      customizationVersion: null,
    },
  };
  const atomicDeployment = await supabase.rpc(
    "deploy_program_instance_atomically",
    {
      p_block: {
        program_id: deploymentInput.block.programId,
        program_family: deploymentInput.block.programFamily,
        started_on: deploymentInput.block.startedOn,
        weeks: deploymentInput.block.weeks,
        days_per_week: deploymentInput.block.daysPerWeek,
        day_index_overrides: deploymentInput.block.dayIndexOverrides,
        cardio_source: deploymentInput.block.cardioSource,
        allows_two_a_days: deploymentInput.block.allowsTwoADays,
        accessory_volume: deploymentInput.block.accessoryVolume,
        notes: deploymentInput.block.notes,
      },
      p_planned_sessions: deploymentInput.plannedSessions.map((session) => ({
        week_index: session.weekIndex,
        day_index: session.dayIndex,
        slot: session.slot,
        title: session.title,
        role: session.role,
        prescription: session.prescription,
        session_modality: session.sessionModality,
        effective_stress_load: session.effectiveStressLoad,
      })),
      p_tm_percents: deploymentInput.tmPercents,
      p_program_instance: {
        program_id: deploymentInput.programInstance.programId,
        program_family: deploymentInput.programInstance.programFamily,
        instance: deploymentInput.programInstance.instance,
        setup_input: deploymentInput.programInstance.setupInput,
        display_name: deploymentInput.programInstance.displayName,
        customization_version: deploymentInput.programInstance.customizationVersion,
      },
    },
  );
  const legacyDeployment = isMissingRpc(atomicDeployment.error)
    ? await deployProgramInstanceDuringMigration(supabase, user, deploymentInput)
    : null;
  const deployment = legacyDeployment?.data ?? atomicDeployment.data;
  const deploymentError = legacyDeployment?.error ?? atomicDeployment.error;
  const deployed = (
    deployment as
      | Array<{ block_id: string; program_instance_id: string }>
      | null
  )?.[0];
  if (deploymentError || !deployed) {
    return {
      ok: false,
      error: deploymentError?.message ?? "Failed to create program instance",
    };
  }
  const blockId = deployed.block_id;

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

  return {
    ok: true,
    blockId,
    programInstanceId: deployed.program_instance_id,
    skipped: 0,
  };
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
