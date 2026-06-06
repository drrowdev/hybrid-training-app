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

const outputSchema = z.object({
  found: z.boolean(),
  onPlan: z.boolean(),
  session: sessionSchema,
  movements: z.array(movementSchema),
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
    "Returns full detail for one of the user's workout sessions — its prescribed movements with the engine's per-movement reason, plus the generation context (athlete profile, goal/focus, plan phase, performance, readiness) that shaped it. Accepts a completed/in-progress session id OR a planned-session id for a not-yet-started workout. Use this to explain WHY a session is programmed as it is.",
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
          weekIndex: null,
          phase: "",
        },
        movements: [],
        generationContext: emptyContext(),
      };
    }

    return {
      found: true,
      onPlan: detail.onPlan,
      session: detail.session,
      movements: detail.movements,
      generationContext: detail.generationContext,
    };
  },
};
