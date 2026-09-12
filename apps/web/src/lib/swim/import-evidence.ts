import { z } from "zod";

const id = z.string().regex(/^\d{1,24}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const distance = z.number().finite().min(0).max(1_000_000);
const seconds = z.number().finite().min(0).max(86_400);
const milliseconds = z.number().int().min(0).max(86_400_000);
const stroke = z.enum(["freestyle", "backstroke", "breaststroke", "butterfly", "mixed", "drill"]);
const timestamp = z.string().datetime({ offset: true, local: true });

const dashboardActivity = z.object({
  activity_id: id,
  date,
  type: z.enum(["lap_swimming", "open_water_swimming"]),
  distance_m: distance,
  duration_s: seconds,
  workout_id: id.nullish(),
});
const dashboardSplit = z.object({
  distance_m: distance.nullable(),
  duration_s: seconds.nullable(),
  active_s: seconds.nullable(),
  paused_s: seconds.nullish(),
  stroke: z.string().max(64).nullable(),
  active_lengths: z.number().int().min(0).max(2000).nullish(),
  step_idx: z.number().int().min(0).max(10000).nullish(),
});
const dashboardDetail = z.object({
  splits: z.array(dashboardSplit).max(2000),
  fetched_at: timestamp.nullish(),
  fetch_status: z.object({
    splits: z.enum(["ok", "failed", "empty"]).optional(),
  }).optional(),
});

export const swimImportEvidenceSchema = z.object({
  version: z.literal(1),
  source: z.literal("local_dashboard"),
  activityId: id,
  date,
  environment: z.enum(["pool", "open_water"]),
  workoutReference: id.nullable(),
  distanceMetres: distance,
  elapsedMs: milliseconds,
  // The inspected dashboard projection does not retain exact native course units.
  nativeCourse: z.null(),
  detail: z.object({
    status: z.enum(["missing", "partial", "available", "unverified"]),
    fetchedAt: timestamp.nullable(),
    splits: z.array(z.object({
      distanceMetres: distance.nullable(),
      elapsedMs: milliseconds.nullable(),
      reportedActiveMs: milliseconds.nullable(),
      activeTimeVerified: z.literal(false),
      reportedPauseMs: milliseconds.nullable(),
      stroke: stroke.nullable(),
      strokeKnown: z.boolean(),
      activeLengths: z.number().int().min(0).max(2000).nullable(),
      workoutStep: z.number().int().min(0).max(10000).nullable(),
    }).strict()).max(2000),
  }).strict(),
}).strict();

export type SwimImportEvidence = z.infer<typeof swimImportEvidenceSchema>;
export type SwimImportResult =
  | { ok: true; value: SwimImportEvidence }
  | { ok: false; code: "unsupported_activity" | "invalid_activity" | "invalid_detail" };

function ms(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value * 1000);
}

/** Privacy projection only: no cache reads, network calls or fitness inference. */
export function projectDashboardSwim(activity: unknown, detail: unknown): SwimImportResult {
  const activityType = z.object({ type: z.string() }).safeParse(activity);
  if (activityType.success && !["lap_swimming", "open_water_swimming"].includes(activityType.data.type)) {
    return { ok: false, code: "unsupported_activity" };
  }
  const parsedActivity = dashboardActivity.safeParse(activity);
  if (!parsedActivity.success) return { ok: false, code: "invalid_activity" };
  const parsedDetail = detail == null ? null : dashboardDetail.safeParse(detail);
  if (parsedDetail && !parsedDetail.success) return { ok: false, code: "invalid_detail" };
  const source = parsedActivity.data;
  const cached = parsedDetail?.data;
  const status = cached == null ? "missing"
    : !cached.fetch_status?.splits ? "unverified"
    : cached.fetch_status.splits === "failed" ? "partial" : "available";
  const value: SwimImportEvidence = {
    version: 1, source: "local_dashboard",
    activityId: source.activity_id, date: source.date,
    environment: source.type === "lap_swimming" ? "pool" : "open_water",
    workoutReference: source.workout_id ?? null,
    distanceMetres: source.distance_m, elapsedMs: Math.round(source.duration_s * 1000),
    nativeCourse: null,
    detail: {
      status, fetchedAt: cached?.fetched_at ?? null,
      splits: (cached?.splits ?? []).map((split) => {
        const parsedStroke = stroke.safeParse(split.stroke);
        return {
          distanceMetres: split.distance_m, elapsedMs: ms(split.duration_s),
          reportedActiveMs: ms(split.active_s),
          // active_s can be the dashboard's elapsed-time fallback, not a measured moving time.
          activeTimeVerified: false,
          reportedPauseMs: ms(split.paused_s),
          stroke: parsedStroke.success ? parsedStroke.data : null,
          strokeKnown: parsedStroke.success,
          activeLengths: split.active_lengths ?? null, workoutStep: split.step_idx ?? null,
        };
      }),
    },
  };
  return { ok: true, value };
}
