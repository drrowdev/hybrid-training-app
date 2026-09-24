import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { trainingScheduleAdvice, type TrainingCommitment } from "@hta/domain";
import { addDaysToYmd, mondayOfYmd } from "@/lib/dates";
import { loadOwnedActivePrograms, requireBlockProgramKind, requireIndependentPrograms, selectProgramTarget, type OwnedActiveProgram } from "@/lib/programs/ownership";
import {
  commitTrainingSchedule, loadAvailableTrainingSchedule, scheduleInputHash,
  ScheduleUnavailableError, type ScheduleReview, type ScheduleSnapshot,
} from "@/lib/schedule/storage";
import type { ProgramRecommendationOrigin } from "./recommendation-origin";
import { assertSeasonProgramReplacement, type SeasonProgramOrigin } from "@/lib/seasons/activation";

export interface ProgramSchedulePreview {
  id: string;
  revision: string;
  dates: { date: string; title: string }[];
  overlaps: TrainingCommitment[];
  plannedRest: TrainingCommitment[];
  replaces: { id: string; name: string } | null;
}

export interface ProgramReviewContext {
  previewOnly: boolean;
  snapshot: ScheduleSnapshot;
  input: unknown;
  review?: ScheduleReview & { previewId: string };
  active: OwnedActiveProgram[];
  recommendation?: ProgramRecommendationOrigin;
  season?: SeasonProgramOrigin;
}

export async function programReviewContext(
  client: SupabaseClient, userId: string, input: unknown, previewOnly: boolean,
  review?: ProgramReviewContext["review"],
): Promise<ProgramReviewContext> {
  await requireIndependentPrograms(client);
  const snapshot = await loadAvailableTrainingSchedule(client);
  if (!snapshot) {
    throw new ScheduleUnavailableError();
  }
  const active = await loadOwnedActivePrograms(client, userId);
  return { previewOnly, snapshot, input, review, active };
}

export function programSchedulePreview(
  context: ProgramReviewContext, args: Record<string, unknown>,
  startedOn: string, rows: readonly { week_index: number; day_index: number; title: string | null }[],
  editBlockId?: string,
): ProgramSchedulePreview {
  const dates = rows.map((row) => ({
    date: addDaysToYmd(mondayOfYmd(startedOn), row.week_index * 7 + row.day_index),
    title: row.title ?? "Workout",
  })).sort((a, b) => a.date.localeCompare(b.date));
  const blockArgs = args.p_block;
  const kind = requireBlockProgramKind(editBlockId ? args.programKind
    : typeof blockArgs === "object" && blockArgs !== null && "program_kind" in blockArgs ? blockArgs.program_kind : null);
  const active = selectProgramTarget(context.active, kind, editBlockId);
  if (context.season) assertSeasonProgramReplacement(context.season, active?.id);
  const excluded = active?.id;
  const advice = trainingScheduleAdvice(context.snapshot.entries, dates.map((row) => row.date),
    excluded ? { source: "primary", programId: excluded, retainExistingOverlaps: !!editBlockId } : undefined);
  return {
    id: scheduleInputHash({ args, revision: context.snapshot.revision }),
    revision: context.snapshot.revision, dates,
    overlaps: advice.overlaps, plannedRest: advice.plannedRest,
    replaces: !editBlockId && active
      ? { id: active.id, name: active.notes ?? "Current program" } : null,
  };
}

export async function commitReviewedProgram(
  client: SupabaseClient, context: ProgramReviewContext, preview: ProgramSchedulePreview,
  operation: "primary-create" | "primary-update", args: Record<string, unknown>,
) {
  const review = context.review;
  if (review && (review.previewId !== preview.id || review.revision !== preview.revision)) {
    throw new Error("Your program or schedule changed. Review the dates again.");
  }
  if (preview.replaces && review?.replaceBlockId !== preview.replaces.id) {
    throw new Error("Review and confirm which program to replace.");
  }
  if (preview.overlaps.length && !review?.acceptOverlap) {
    throw new Error("Review and accept the overlapping workouts before saving.");
  }
  return commitTrainingSchedule(client, operation, args, review ?? {
    revision: preview.revision, requestId: randomUUID(), acceptOverlap: false,
  }, context.input);
}
