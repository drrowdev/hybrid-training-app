/**
 * getSessionDetail — full detail for one of the user's workout sessions:
 * its prescribed movements with the engine's per-movement reason, plus the
 * compact generation context (athlete profile, goal/focus, plan phase,
 * performance, readiness) that shaped it.
 *
 * Data source: `loadSessionDetail` (apps/web/src/lib/sessions/session-detail.ts),
 * which resolves the session, its prescription + plan position, and a
 * resilient generation-context snapshot. Read-only; pinned to ctx.userId.
 */
import { z } from "zod";
import type { Tool } from "./types";

const movementSchema = z.object({
  kind: z.string(),
  name: z.string().nullable(),
  setsReps: z.string().nullable(),
  intensity: z.string().nullable(),
  why: z.string().nullable(),
});

const sessionSchema = z.object({
  id: z.string(),
  date: z.string().nullable(),
  title: z.string().nullable(),
  archetype: z.string().nullable(),
  program: z
    .object({
      id: z.string(),
      name: z.string(),
      summary: z.string(),
    })
    .nullable(),
  weekIndex: z.number().int().nullable(),
  phase: z.string(),
});

const athleteSchema = z
  .object({
    experience: z.string().nullable(),
    equipment: z.array(z.string()),
    activeLimitations: z.array(z.string()),
    bodyweightKg: z.number().nullable(),
  })
  .nullable();

const goalSchema = z
  .object({
    archetype: z.string().nullable(),
    archetypeFocus: z.string().nullable(),
    focusMuscles: z.array(z.string()),
    secondaryFocus: z.string().nullable(),
    accessoryVolume: z.string().nullable(),
    powerEmphasis: z.boolean().nullable(),
  })
  .nullable();

const planPositionSchema = z
  .object({
    startedOn: z.string().nullable(),
    weeksTotal: z.number().int().nullable(),
    currentWeekIndex: z.number().int().nullable(),
    phase: z.string().nullable(),
    deloadProximity: z.number().int().nullable(),
    deloadSkipped: z.boolean().nullable(),
    earlyDeload: z.boolean().nullable(),
  })
  .nullable();

const performanceSchema = z
  .object({
    recoveredWeeks: z.number().int().nullable(),
    ceiling: z
      .object({
        final: z.number(),
        confidence: z.number(),
        reasons: z.array(z.string()),
      })
      .nullable(),
  })
  .nullable();

const readinessSchema = z
  .object({
    bucketPressure: z.array(
      z.object({ bucket: z.string(), percentOfCeiling: z.number() }),
    ),
    freshness: z.array(
      z.object({
        region: z.string(),
        label: z.string(),
        freshness: z.number(),
      }),
    ),
  })
  .nullable();

const generationContextSchema = z.object({
  athlete: athleteSchema,
  goal: goalSchema,
  planPosition: planPositionSchema,
  performance: performanceSchema,
  readiness: readinessSchema,
});

const performedSetSchema = z.object({
  weightKg: z.number().nullable(),
  reps: z.number().nullable(),
  rpe: z.number().nullable(),
  skipped: z.boolean(),
  setKind: z.string(),
});

const performedMovementSchema = z.object({
  movementId: z.string(),
  name: z.string().nullable(),
  loggedSets: z.array(performedSetSchema),
});

const performanceSchema2 = z
  .object({
    hasLog: z.boolean(),
    totalLoggedSets: z.number().int(),
    loggedWorkingSets: z.number().int(),
    prCount: z.number().int(),
    movements: z.array(performedMovementSchema),
    notPerformed: z.array(z.string()),
  })
  .nullable();

const outputSchema = z.object({
  found: z.boolean(),
  onPlan: z.boolean(),
  session: sessionSchema,
  movements: z.array(movementSchema),
  performance: performanceSchema2,
  generationContext: generationContextSchema,
});

const inputSchema = z
  .object({
    sessionId: z
      .string()
      .min(1)
      .describe(
        "The session id to explain. Accepts a completed/in-progress session id, or a planned-session id for a not-yet-started workout.",
      ),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

function emptyContext(): Output["generationContext"] {
  return {
    athlete: null,
    goal: null,
    planPosition: null,
    performance: null,
    readiness: null,
  };
}

export const getSessionDetail: Tool<Input, Output> = {
  name: "getSessionDetail",
  description:
    "Returns full detail for one of the user's workout sessions — which PROGRAM it belongs to (`session.program`: name + summary, resolved from the block's program_id; null for legacy archetype blocks or off-plan sessions), its prescribed movements with the engine's per-movement reason and the generation context that shaped it, PLUS `performance`: what the user ACTUALLY logged (per-movement sets, working-set count, and `notPerformed` = prescribed movements with zero logged sets). Accepts a completed/in-progress session id OR a planned-session id (where `performance` is null). Use this to explain WHY a session is programmed AND to assess HOW the user actually did — basing any recap on `performance`, never the prescription alone.",
  inputSchema,
  outputSchema,
  async handler(input, ctx) {
    const { loadSessionDetail } = await import("@/lib/sessions/session-detail");
    const detail = await loadSessionDetail(
      ctx.userId,
      input.sessionId,
      ctx.supabase,
      ctx.tz,
    );

    if (!detail) {
      return {
        found: false,
        onPlan: false,
        session: {
          id: input.sessionId,
          date: null,
          title: null,
          archetype: null,
          program: null,
          weekIndex: null,
          phase: "",
        },
        movements: [],
        performance: null,
        generationContext: emptyContext(),
      };
    }

    return {
      found: true,
      onPlan: detail.onPlan,
      session: detail.session,
      movements: detail.movements,
      performance: detail.performance,
      generationContext: detail.generationContext,
    };
  },
};
