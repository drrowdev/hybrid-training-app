import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TrainingCommitment } from "@hta/domain";

const entrySchema = z.object({
  id: z.string(), source: z.enum(["primary", "swim", "session"]), programId: z.string().nullable(),
  date: z.string(), title: z.string(), state: z.enum(["scheduled", "started", "completed", "rest", "paused"]),
});
const snapshotSchema = z.object({ revision: z.string(), entries: z.array(entrySchema) });

export interface ScheduleSnapshot {
  revision: string;
  entries: TrainingCommitment[];
}
export interface ScheduleReview {
  revision: string;
  requestId: string;
  acceptOverlap: boolean;
  replaceBlockId?: string;
}
export const scheduleReviewSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{32}$/),
  requestId: z.string().uuid(),
  acceptOverlap: z.boolean(),
  replaceBlockId: z.string().uuid().optional(),
}).strict();

export function isMissingScheduleFunction(error: { code?: string; message?: string } | null, name: string): boolean {
  return !!error && (error.code === "PGRST202" || error.code === "42883") &&
    typeof error.message === "string" && error.message.includes(name);
}

export class ScheduleUnavailableError extends Error {
  constructor() { super("Program setup is temporarily unavailable. Try again shortly."); }
}

/** Only the app-first migration gap is optional; failed reads never become empty calendars. */
export async function loadAvailableTrainingSchedule(client: SupabaseClient): Promise<ScheduleSnapshot | null> {
  try { return await loadTrainingSchedule(client); }
  catch (error) { if (error instanceof ScheduleUnavailableError) return null; throw error; }
}

export function scheduleInputHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function scheduleRequestId(value: unknown): string {
  const hash = scheduleInputHash(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function scheduleReplay(client: SupabaseClient, requestId: string, operation: string, input: unknown): Promise<unknown | null> {
  const { data, error } = await client.from("engine_override_events").select("context").eq("id", z.string().uuid().parse(requestId)).maybeSingle();
  if (error) throw new Error("Could not check this save. Try again.", { cause: error });
  if (!data) return null;
  const receipt = z.object({ kind: z.literal("training-schedule-v1"), operation: z.string(), inputHash: z.string(), result: z.unknown() }).parse(data.context);
  if (receipt.operation !== operation || receipt.inputHash !== scheduleInputHash(input)) {
    throw new Error("This save request was already used for a different change.");
  }
  return receipt.result;
}

export async function loadTrainingSchedule(client: SupabaseClient): Promise<ScheduleSnapshot> {
  const result = await client.rpc("training_schedule_snapshot");
  if (isMissingScheduleFunction(result.error, "training_schedule_snapshot")) throw new ScheduleUnavailableError();
  if (result.error) throw new Error("Could not load your training schedule. Try again.", { cause: result.error });
  const parsed = snapshotSchema.safeParse(result.data);
  if (!parsed.success) throw new Error("Your training schedule could not be read. Try again.");
  return parsed.data;
}

export async function commitTrainingSchedule(
  client: SupabaseClient,
  operation: string,
  args: Record<string, unknown>,
  review: ScheduleReview,
  input: unknown,
) {
  return client.rpc("training_schedule_commit", {
    p_operation: operation, p_args: { ...args, ...(review.replaceBlockId ? { p_replace_block_id: review.replaceBlockId } : {}) }, p_expected_revision: review.revision,
    p_request_id: review.requestId, p_input_hash: scheduleInputHash(input),
    p_accept_overlap: review.acceptOverlap,
  });
}

/** Legacy controls may proceed without overlap; new conflicts always require review. */
export async function commitUnreviewedScheduleChange(
  client: SupabaseClient, operation: string, args: Record<string, unknown>,
) {
  const snapshot = await loadTrainingSchedule(client);
  return commitTrainingSchedule(client, operation, args, {
    revision: snapshot.revision, requestId: randomUUID(), acceptOverlap: false,
  }, args);
}
