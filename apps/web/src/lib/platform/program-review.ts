import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { trainingScheduleAdvice, type TrainingCommitment } from "@hta/domain";
import { addDaysToYmd, mondayOfYmd } from "@/lib/dates";
import {
  commitTrainingSchedule, loadAvailableTrainingSchedule, scheduleInputHash,
  ScheduleUnavailableError, type ScheduleReview, type ScheduleSnapshot,
} from "@/lib/schedule/storage";

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
  active: { id: string; notes: string | null } | null;
}

export async function programReviewContext(
  client: SupabaseClient, userId: string, input: unknown, previewOnly: boolean,
  review?: ProgramReviewContext["review"],
): Promise<ProgramReviewContext | undefined> {
  const snapshot = await loadAvailableTrainingSchedule(client);
  if (!snapshot) {
    if (previewOnly || review) throw new ScheduleUnavailableError();
    return undefined;
  }
  const active = await client.from("training_blocks").select("id,notes")
    .eq("user_id", userId).eq("status", "active").is("deleted_at", null).maybeSingle();
  if (active.error) throw new Error("Could not load your current program. Try again.");
  return { previewOnly, snapshot, input, review, active: active.data };
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
  const excluded = editBlockId ?? context.active?.id;
  const advice = trainingScheduleAdvice(context.snapshot.entries, dates.map((row) => row.date),
    excluded ? { source: "primary", programId: excluded, retainExistingOverlaps: !!editBlockId } : undefined);
  return {
    id: scheduleInputHash({ args, revision: context.snapshot.revision }),
    revision: context.snapshot.revision, dates,
    overlaps: advice.overlaps, plannedRest: advice.plannedRest,
    replaces: !editBlockId && context.active
      ? { id: context.active.id, name: context.active.notes ?? "Current program" } : null,
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
