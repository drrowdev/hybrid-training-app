"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { trainingScheduleAdvice } from "@hta/domain";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { addDaysToYmd } from "@/lib/dates";
import {
  commitTrainingSchedule, loadAvailableTrainingSchedule, loadTrainingSchedule,
  scheduleInputHash, scheduleReplay, scheduleRequestId, scheduleReviewSchema,
  type SchedulePreview, type ScheduleReview, type ScheduleSnapshot,
} from "@/lib/schedule/storage";
import { getDeloadWeekPreview, type DeloadWeekPreview } from "./deload-week-preview";
import { RECOVERY_PERCENT_MAX, RECOVERY_PERCENT_MIN } from "./recovery-week-bounds";
import { dayDate, getUserTimezone } from "./queries";

export type InsertDeloadResult =
  | { ok: true; deloadWeekIndex: number; sessions: number }
  | { ok: false; error: string };
export type RemoveDeloadResult = { ok: true } | { ok: false; error: string };
export type DeloadScheduleReview = ScheduleReview & { previewId: string };
export type ReviewedDeloadWeekPreview = DeloadWeekPreview & { review: SchedulePreview & { id: string } };
export type RemoveDeloadPreview = { blockId: string; weekIndex: number; review: SchedulePreview & { id: string } };

const removeSchema = z.object({ weekIndex: z.number().int().min(0), blockId: z.string().uuid().optional() }).strict();
const optionsSchema = z.object({
  blockId: z.string().uuid().optional(),
  percent: z.number().int().min(RECOVERY_PERCENT_MIN).max(RECOVERY_PERCENT_MAX).optional(),
  boundaryKey: z.string().min(1).max(64).optional(),
  recommendationId: z.string().uuid().optional(),
}).strict();
const reviewSchema = scheduleReviewSchema.extend({ previewId: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const insertedSchema = z.object({ deloadWeekIndex: z.number().int().min(0), sessions: z.number().int().positive() });
type Client = Awaited<ReturnType<typeof createClient>>;

function revalidateAll(): void {
  for (const path of ["/app", "/app/plan", "/app/sessions", "/app/stats"]) revalidatePath(path);
}

async function deloadSchedule(
  client: Client, snapshot: ScheduleSnapshot, blockId: string,
  change: { kind: "insert"; preview: DeloadWeekPreview } | { kind: "remove"; weekIndex: number },
) {
  const [block, planned] = await Promise.all([
    client.from("training_blocks").select("started_on,status,deleted_at").eq("id", blockId).maybeSingle(),
    client.from("planned_sessions").select("id,week_index,day_index,role,completed_session_id").eq("block_id", blockId),
  ]);
  if (block.error || planned.error || !planned.data) throw new Error("Could not read the program's dates. Try again.");
  if (!block.data || block.data.status !== "active" || block.data.deleted_at) throw new Error("No active program.");
  const startedOn = block.data.started_on;
  if (change.kind === "remove") {
    const removed = planned.data.filter((row) => row.week_index === change.weekIndex && row.role === "deload");
    if (!removed.length) throw new Error("This is not a recovery week.");
    if (removed.some((row) => row.completed_session_id)) throw new Error("Started recovery workouts cannot be removed.");
  }
  const rows = new Map(planned.data.map((row) => [row.id, row]));
  const existing = snapshot.entries.filter((entry) => entry.source === "primary" && entry.programId === blockId &&
    entry.state !== "rest" && entry.state !== "paused");
  const existingDates = new Set(existing.map((entry) => entry.date));
  const proposed = existing.flatMap((entry) => {
    const row = rows.get(entry.id);
    if (!row) throw new Error("The schedule changed. Review it again.");
    if (entry.state === "started" || entry.state === "completed") return [entry.date];
    if (change.kind === "insert") return [row.week_index > change.preview.afterWeek ? addDaysToYmd(entry.date, 7) : entry.date];
    if (row.week_index === change.weekIndex && row.role === "deload") return [];
    return [row.week_index > change.weekIndex ? addDaysToYmd(entry.date, -7) : entry.date];
  });
  if (change.kind === "insert") {
    proposed.push(...change.preview.sessions.map((session) => dayDate(startedOn, change.preview.deloadWeekIndex, session.dayIndex)));
  }
  const dates = [...new Set(proposed)].filter((date) => !existingDates.has(date)).sort();
  const overlaps = trainingScheduleAdvice(snapshot.entries, dates, { source: "primary", programId: blockId }).overlaps;
  const id = scheduleInputHash({ change, blockId, revision: snapshot.revision, dates });
  return { id, revision: snapshot.revision, requestId: scheduleRequestId({ operation: `primary-${change.kind}-deload`, id }), dates, overlaps };
}

async function prepareInsertion(
  client: Client, userId: string, snapshot: ScheduleSnapshot, options: z.infer<typeof optionsSchema>,
): Promise<ReviewedDeloadWeekPreview | null> {
  const timezone = await getUserTimezone(userId);
  const preview = await getDeloadWeekPreview(client, userId, { ...options, timezone });
  if (preview && options.blockId && preview.blockId !== options.blockId) throw new Error("The selected program changed. Review it again.");
  return preview ? { ...preview, review: await deloadSchedule(client, snapshot, preview.blockId, { kind: "insert", preview }) } : null;
}

/** The reviewed graph includes every shifted week, not just the inserted sessions. */
export async function previewDeloadWeekAction(
  percent?: number, boundaryKey?: string, recommendationId?: string, blockId?: string,
): Promise<ReviewedDeloadWeekPreview | null> {
  const options = optionsSchema.parse({ percent, boundaryKey, recommendationId, blockId });
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const snapshot = await loadAvailableTrainingSchedule(client);
  return snapshot ? prepareInsertion(client, user.id, snapshot, options) : null;
}

export async function insertDeloadWeekAction(
  percent?: number, boundaryKey?: string, recommendationId?: string, review?: DeloadScheduleReview, blockId?: string,
): Promise<InsertDeloadResult> {
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  try {
    if (!review) throw new Error("Review the recovery week before adding it.");
    const accepted = reviewSchema.parse(review);
    const options = optionsSchema.parse({ percent, boundaryKey, recommendationId, blockId });
    const input = { ...options, previewId: accepted.previewId };
    const replay = await scheduleReplay(client, accepted.requestId, "primary-insert-deload", input);
    if (replay) return { ok: true, ...insertedSchema.parse(replay) };
    const snapshot = await loadTrainingSchedule(client);
    const preview = await prepareInsertion(client, user.id, snapshot, options);
    if (!preview) throw new Error("No active program to deload.");
    if (preview.review.id !== accepted.previewId || preview.review.revision !== accepted.revision) {
      throw new Error("The schedule changed. Review the recovery week again.");
    }
    if (preview.review.overlaps.length && !accepted.acceptOverlap) throw new Error("Confirm the overlapping workouts before adding this week.");
    const { data, error } = await commitTrainingSchedule(client, "primary-insert-deload", {
      blockId: preview.blockId, afterWeek: preview.afterWeek,
      sessions: preview.sessions.map((session) => ({
        day_index: session.dayIndex, slot: session.slot, title: session.title,
        session_modality: session.sessionModality, prescription: session.prescription,
      })),
    }, accepted, input);
    if (error) return { ok: false, error: error.message };
    const result = insertedSchema.parse(data);
    revalidateAll();
    return { ok: true, ...result };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not add the recovery week. Try again." }; }
}

async function prepareRemoval(client: Client, userId: string, snapshot: ScheduleSnapshot, weekIndex: number, blockId?: string): Promise<RemoveDeloadPreview | null> {
  let query = client.from("training_blocks").select("id").eq("user_id", userId).eq("status", "active").is("deleted_at", null);
  if (blockId) query = query.eq("id", blockId);
  const block = await query.maybeSingle();
  if (block.error) throw new Error("Could not read the active program. Try again.");
  if (!block.data) return null;
  if (blockId && block.data.id !== blockId) throw new Error("The selected program changed. Review it again.");
  return { blockId: block.data.id, weekIndex,
    review: await deloadSchedule(client, snapshot, block.data.id, { kind: "remove", weekIndex }) };
}

export async function previewRemoveDeloadWeekAction(input: z.infer<typeof removeSchema>): Promise<RemoveDeloadPreview | null> {
  const { weekIndex, blockId } = removeSchema.parse(input);
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  return prepareRemoval(client, user.id, await loadTrainingSchedule(client), weekIndex, blockId);
}

export async function removeDeloadWeekAction(
  input: z.infer<typeof removeSchema>, review?: DeloadScheduleReview,
): Promise<RemoveDeloadResult> {
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  try {
    if (!review) throw new Error("Review the schedule before removing this week.");
    const parsed = removeSchema.parse(input), accepted = reviewSchema.parse(review);
    const requestInput = { ...parsed, previewId: accepted.previewId };
    const replay = await scheduleReplay(client, accepted.requestId, "primary-remove-deload", requestInput);
    if (replay) { z.object({ blockId: z.string().uuid() }).parse(replay); return { ok: true }; }
    const preview = await prepareRemoval(client, user.id, await loadTrainingSchedule(client), parsed.weekIndex, parsed.blockId);
    if (!preview) throw new Error("No active program.");
    if (preview.review.id !== accepted.previewId || preview.review.revision !== accepted.revision) {
      throw new Error("The schedule changed. Review it again.");
    }
    if (preview.review.overlaps.length && !accepted.acceptOverlap) throw new Error("Confirm the overlapping workouts before removing this week.");
    const { data, error } = await commitTrainingSchedule(client, "primary-remove-deload",
      { blockId: preview.blockId, weekIndex: parsed.weekIndex }, accepted, requestInput);
    if (error) return { ok: false, error: error.message };
    z.object({ blockId: z.string().uuid() }).parse(data);
    revalidateAll();
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not remove the recovery week. Try again." }; }
}
