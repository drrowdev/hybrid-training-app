import { z } from "zod";

export type SwimWorkoutView = {
  id: string;
  revision: number;
  sessionId: string | null;
  status: "scheduled" | "started" | "completed" | "skipped";
  planStatus: "active" | "paused" | "finished" | "archived";
  date: string;
  title: string;
  course: string;
  total: string;
  provisional: boolean;
  budgetMinutes: number;
  calibrationLabel?: string;
  stroke: string;
  strokes: string[];
  equipment: string[];
  pool: { numerator: number; denominator: number; unit: "m" | "yd" };
  steps: { id: string; repeatIds: string[]; section: string; title: string; detail: string; rest: string; effort: string; pace?: string; guidance?: string }[];
  result: null | {
    lengths: number; timeMs: number; rpe?: number; notes?: string; reason?: string; splits?: string; stroke: string;
    equipment?: string[]; course?: string; strokes?: string[];
    distance?: string; pool?: SwimWorkoutView["pool"];
  };

  deleted: boolean;
  sourceGone?: boolean;
  notes?: string;
};

export type SwimCompletion = {
  receiptId: string;
  workoutId: string;
  sessionId: string;
  userId: string;
  view?: SwimWorkoutView;
  warning?: string;
};

export type SwimPlanPreview = {
  course: string;
  workoutCount: number;
  weeks: {
    week: number;
    startDate: string;
    provisional: boolean;
    total: string;
    workouts: (Pick<SwimWorkoutView, "title" | "total" | "budgetMinutes" | "calibrationLabel" | "steps"> & {
      slotId: string;
      date: string;
    })[];
  }[];
};

const completionPool = z.object({ numerator: z.number().int().positive(), denominator: z.number().int().positive(), unit: z.enum(["m", "yd"]) });
const completionView = z.object({
  id: z.string().uuid(), sessionId: z.string().uuid(), revision: z.number().int().positive(),
  status: z.literal("completed"), planStatus: z.enum(["active", "paused", "finished", "archived"]),
  date: z.string(), title: z.string(), course: z.string(), total: z.string(),
  provisional: z.boolean(), budgetMinutes: z.number().positive(), calibrationLabel: z.string().optional(),
  stroke: z.string(), strokes: z.array(z.string()), equipment: z.array(z.string()), pool: completionPool,
  steps: z.array(z.object({
    id: z.string(), repeatIds: z.array(z.string()), section: z.string(), title: z.string(), detail: z.string(),
    rest: z.string(), effort: z.string(), pace: z.string().optional(), guidance: z.string().optional(),
  })),
  result: z.object({
    lengths: z.number().int().positive().safe(), timeMs: z.number().int().positive().safe(),
    rpe: z.number().finite().optional(), notes: z.string().optional(), reason: z.string().optional(),
    splits: z.string().optional(), stroke: z.string(), equipment: z.array(z.string()).optional(),
    course: z.string().optional(), strokes: z.array(z.string()).optional(),
    distance: z.string().optional(), pool: completionPool.optional(),
  }),
  deleted: z.literal(false), sourceGone: z.literal(false).optional(), notes: z.string().optional(),
});

export function confirmedSwimCompletionView(
  completion: SwimCompletion, workout: Pick<SwimWorkoutView, "id" | "sessionId" | "revision">,
): SwimWorkoutView | null {
  const view = completion.view;
  if (!view || view.id !== workout.id || view.sessionId !== workout.sessionId ||
    !Number.isSafeInteger(view.revision) || view.revision <= workout.revision ||
    !completionView.safeParse(view).success) return null;
  return view;
}

export type SwimHubView = {
    id: string; revision: number; status: SwimWorkoutView["planStatus"]; goal: string;
    course: string; dates: string; today: string;
    assessment?: { label: string; pace: string };
    workouts: { id: string; date: string; title: string; total: string; status: string; week: number; provisional: boolean }[];
    proposals: {
      id: string; kind: "week" | "benchmark"; status: string; title: string;
      detail: string; changes: { title: string; before: string; after: string }[];
      mainRepeats?: number;
      excludedCount?: number;
      warning?: string;
    }[];
    analytics: {
      weeks: { week: string; course: string; planned: string; actual: string; frequency: number; adherence: string }[];
      bests: { label: string; time: string; date: string }[];
      benchmarks: { label: string; pace: string; date: string }[];
    };
  };

export function nextConfirmedView<T extends { id: string; revision: number }>(current: T, incoming: T, source: "props" | "confirmed"): T {
  if (current.id !== incoming.id) return source === "props" ? incoming : current;
  if (incoming.revision > current.revision || (source === "props" && incoming.revision === current.revision)) return incoming;
  return current;
}

export const nextSwimHubView = nextConfirmedView<SwimHubView>;

export function nextEditMode(current: number | null, edit: boolean, revision: number) {
  const intent = edit ? (current ?? revision) : null;
  return { intent, open: intent === revision };
}

export type SwimResumePreview = {
    planId: string; revision: number; startDate: string;
    dates: { id: string; revision: number; date: string }[];
  };
