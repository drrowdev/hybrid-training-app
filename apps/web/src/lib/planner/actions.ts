"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { todayYmd, ymdToUtc, daysBetweenYmd, ymdInTimezone } from "@/lib/dates";
import { getUserTimezone, dayDate } from "./queries";
import { commitUnreviewedScheduleChange, commitTrainingSchedule, loadTrainingSchedule, scheduleRequestId, scheduleReviewSchema, isMissingScheduleFunction, type ScheduleReview, type SchedulePreview } from "@/lib/schedule/storage";
import { trainingScheduleAdvice } from "@hta/domain";

export type CreateBlockResult =
  | { ok: true }
  | { ok: false; error: string };

const blockIdSchema = z.object({ id: z.string().uuid() });

const endBlockSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().max(280).optional(),
});

export async function endBlock(formData: FormData): Promise<void> {
  const parsed = endBlockSchema.safeParse({
    id: formData.get("id"),
    reason: (formData.get("reason") as string | null) ?? undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await commitUnreviewedScheduleChange(supabase, "primary-end", parsed.data);
  if (error) throw new Error(error.message);

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/programs");
  revalidatePath("/app/plan/history");
}

/**
 * Soft-delete a training block. Distinct from `endBlock` which writes
 * status='archived' to mark "no longer active". `deleteBlock` is the
 * stronger intent: remove from history, recoverable for 30 days via
 * the Trash page. AGENTS.md DC-K4 — destructive, reversible.
 *
 * Cascade is implicit: every query that lists planned_sessions joins
 * through the block and the block filter `deleted_at IS NULL` hides
 * the children too. Hard cascade to planned_sessions only fires when
 * the block is permanently deleted (FK ON DELETE CASCADE in 0008).
 *
 * RLS (training_blocks_update_self) covers ownership; the explicit
 * `eq("user_id", ...)` is defense in depth.
 */
export async function deleteBlock(
  formData: FormData,
): Promise<{ ok: true; blockId: string } | { ok: false; error: string }> {
  const parsed = blockIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await commitUnreviewedScheduleChange(supabase, "primary-delete", { id: parsed.data.id });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/plan/history");
  revalidatePath("/app/stats");
  revalidatePath("/app/settings/trash");
  return { ok: true, blockId: parsed.data.id };
}

/** Restore a soft-deleted block — flips `deleted_at` back to NULL. */
export async function restoreBlock(
  id: string,
  review?: ScheduleReview,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "Missing block id." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = review
    ? await commitTrainingSchedule(supabase, "primary-restore", { id }, scheduleReviewSchema.parse(review), { id })
    : await commitUnreviewedScheduleChange(supabase, "primary-restore", { id });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/plan/history");
  revalidatePath("/app/stats");
  revalidatePath("/app/settings/trash");
  return { ok: true };
}

/**
 * Hard-delete a block. Only callable from the Trash page after the
 * user types the block's archetype name as type-to-confirm. Cascades
 * to planned_sessions via the FK in migration 0008
 * (planned_sessions.block_id ON DELETE CASCADE).
 */
export async function permanentlyDeleteBlock(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "Missing block id." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("training_blocks")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/plan/history");
  revalidatePath("/app/stats");
  revalidatePath("/app/settings/trash");
  return { ok: true };
}

const linkPlannedSchema = z.object({
  plannedId: z.string().uuid(),
  sessionId: z.string().uuid(),
});

/**
 * Link a past planned_session to an already-logged sessions row. Used
 * by the past-unfulfilled match modal in the calendar views: when the
 * user identifies an already-logged activity (or any logged session
 * on the same calendar day) as the realisation of a planned slot, we
 * point `completed_session_id` at it. RLS + the inner-join through
 * training_blocks ensures only the owning user can mutate the row.
 */
export async function linkPlannedToSession(formData: FormData): Promise<void> {
  const parsed = linkPlannedSchema.safeParse({
    plannedId: formData.get("plannedId"),
    sessionId: formData.get("sessionId"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid workout.");
  const supabase = await createClient();
  await supabase
    .from("planned_sessions")
    .update({ completed_session_id: parsed.data.sessionId })
    .eq("id", parsed.data.plannedId);
  revalidatePath("/app");
  revalidatePath("/app/plan");
}

const skipSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().max(280).optional(),
});

export async function skipPlannedSession(formData: FormData): Promise<void> {
  const parsed = skipSchema.safeParse({
    id: formData.get("id"),
    reason: (formData.get("reason") as string | null) ?? undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid workout.");
  const supabase = await createClient();
  const { error } = await commitUnreviewedScheduleChange(supabase, "primary-skip", parsed.data);
  if (error) throw new Error(error.message);

  revalidatePath("/app");
  revalidatePath("/app/plan");
}

const unskipSchema = z.object({ id: z.string().uuid() });

const moveSchema = z.object({
  id: z.string().uuid(),
  weekIndex: z.number().int().min(0),
  dayIndex: z.number().int().min(0).max(6),
});

export type PlannedMovePreview = SchedulePreview;

const restoreInputSchema = z.object({ kind: z.enum(["block", "workout"]), id: z.string().uuid() }).strict();

export async function previewTrainingRestore(input: z.infer<typeof restoreInputSchema>): Promise<PlannedMovePreview> {
  const parsed = restoreInputSchema.parse(input);
  const supabase = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) throw new Error("Not signed in.");
  const snapshot = await loadTrainingSchedule(supabase);
  const selected = parsed.kind === "workout" ? await supabase.from("planned_sessions")
    .select("block_id,completed_session_id").eq("id", parsed.id).maybeSingle() : null;
  if (selected?.error) throw new Error("Could not read the workout. Try again.");
  if (parsed.kind === "workout" && !selected?.data) throw new Error("Workout not found.");
  if (selected?.data?.completed_session_id) throw new Error("Started workouts cannot be restored.");
  const blockId = parsed.kind === "block" ? parsed.id : selected!.data!.block_id;
  const block = await supabase.from("training_blocks").select("id,started_on,status,deleted_at").eq("id", blockId).maybeSingle();
  if (block.error) throw new Error("Could not read the program. Try again.");
  if (!block.data) throw new Error("Program not found.");
  if (parsed.kind === "workout" && (block.data.status !== "active" || block.data.deleted_at)) {
    throw new Error("Only workouts in an active program can be restored.");
  }
  const planned = await supabase.from("planned_sessions")
    .select("id,week_index,day_index,role,completed_session_id,skipped_at").eq("block_id", blockId);
  if (planned.error || !planned.data) throw new Error("Could not read the program's workouts. Try again.");
  const linkedIds = new Set<string>(planned.data.flatMap((row) => row.completed_session_id ? [row.completed_session_id] : []));
  const existingDates = new Set(snapshot.entries.filter((entry) =>
    entry.state !== "rest" && entry.state !== "paused" &&
    ((entry.source === "primary" && entry.programId === blockId) || (entry.source === "session" && linkedIds.has(entry.id))),
  ).map((entry) => entry.date));
  const candidates = block.data.status === "active" ? planned.data.filter((row) =>
    (parsed.kind === "workout" ? row.id === parsed.id : !row.skipped_at) &&
    (row.role !== "rest" || row.completed_session_id),
  ) : [];
  const completedIds = candidates.flatMap((row) => row.completed_session_id ? [row.completed_session_id] : []);
  const performedDates = new Map<string, string>();
  if (completedIds.length) {
    const sessions = await supabase.from("sessions").select("id,performed_at").in("id", completedIds);
    if (sessions.error || !sessions.data) throw new Error("Could not read the logged workout dates. Try again.");
    const timezone = await getUserTimezone(user.id);
    for (const session of sessions.data) performedDates.set(session.id, ymdInTimezone(new Date(session.performed_at), timezone));
  }
  const dates = [...new Set(candidates.map((row) =>
    performedDates.get(row.completed_session_id ?? "") ?? dayDate(block.data!.started_on, row.week_index, row.day_index),
  ))].filter((date) => !existingDates.has(date)).sort();
  const advice = trainingScheduleAdvice(snapshot.entries, dates, { source: "primary", programId: blockId });
  return { revision: snapshot.revision, requestId: scheduleRequestId({ parsed, revision: snapshot.revision }), dates, overlaps: advice.overlaps };
}

export async function previewPlannedMove(input: z.infer<typeof moveSchema>): Promise<PlannedMovePreview> {
  const parsed = moveSchema.parse(input);
  const supabase = await createClient();
  const snapshot = await loadTrainingSchedule(supabase);
  const planned = await supabase.from("planned_sessions").select("id,block_id,week_index,day_index,slot,completed_session_id")
    .eq("id", parsed.id).maybeSingle();
  if (planned.error) throw new Error("Could not read the workout. Try again.");
  if (!planned.data) throw new Error("Workout not found.");
  if (planned.data.completed_session_id) throw new Error("Started workouts cannot be moved.");
  const [block, target] = await Promise.all([
    supabase.from("training_blocks").select("started_on,weeks").eq("id", planned.data.block_id).eq("status", "active").is("deleted_at", null).maybeSingle(),
    supabase.from("planned_sessions").select("id,completed_session_id").eq("block_id", planned.data.block_id)
      .eq("week_index", parsed.weekIndex).eq("day_index", parsed.dayIndex).eq("slot", planned.data.slot).maybeSingle(),
  ]);
  if (block.error || target.error) throw new Error("Could not check these dates. Try again.");
  if (!block.data || parsed.weekIndex >= block.data.weeks) throw new Error("Choose a date in this program.");
  if (target.data?.completed_session_id) throw new Error("Started workouts cannot be moved.");
  const dates = [dayDate(block.data.started_on, parsed.weekIndex, parsed.dayIndex)];
  if (target.data && target.data.id !== planned.data.id) dates.push(dayDate(block.data.started_on, planned.data.week_index, planned.data.day_index));
  const advice = trainingScheduleAdvice(snapshot.entries.filter((entry) => entry.id !== planned.data!.id && entry.id !== target.data?.id), dates);
  return { revision: snapshot.revision, requestId: scheduleRequestId({ parsed, revision: snapshot.revision }), dates, overlaps: advice.overlaps };
}

/** The transaction moves or swaps both rows; a failed overlap review changes neither. */
export async function movePlannedSession(formData: FormData): Promise<void> {
  const parsed = moveSchema.parse({
    id: formData.get("id"), weekIndex: Number(formData.get("weekIndex")), dayIndex: Number(formData.get("dayIndex")),
  });
  const supabase = await createClient();
  let review;
  if (formData.has("scheduleReview")) review = scheduleReviewSchema.parse(JSON.parse(String(formData.get("scheduleReview"))));
  else {
    const preview = await previewPlannedMove(parsed);
    if (preview.overlaps.length) throw new Error("This date overlaps scheduled training. Open the workout and choose Move to review both dates.");
    review = { revision: preview.revision, requestId: preview.requestId, acceptOverlap: false };
  }
  const { error } = await commitTrainingSchedule(supabase, "primary-move", parsed, review, parsed);
  if (error) throw new Error(error.message);

  revalidatePath("/app");
  revalidatePath("/app/plan");
}

export async function unskipPlannedSession(formData: FormData): Promise<void> {
  const parsed = unskipSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid workout.");
  const supabase = await createClient();
  const review = formData.has("scheduleReview") ? scheduleReviewSchema.parse(JSON.parse(String(formData.get("scheduleReview")))) : null;
  const { error } = review
    ? await commitTrainingSchedule(supabase, "primary-unskip", parsed.data, review, parsed.data)
    : await commitUnreviewedScheduleChange(supabase, "primary-unskip", parsed.data);
  if (error) throw new Error(error.message);
  revalidatePath("/app");
  revalidatePath("/app/plan");
}

const setPlannedTimeSchema = z.object({
  id: z.string().uuid(),
  hhmm: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm"),
});

/**
 * Set an explicit planned_at on a planned_session. Computes the UTC instant
 * from the user's profile timezone + the day's calendar date + the HH:mm
 * the user entered. Empty / cleared input is treated as null (revert to
 * profile window default).
 */
export async function setPlannedTime(formData: FormData): Promise<void> {
  const raw = {
    id: formData.get("id"),
    hhmm: formData.get("hhmm"),
  };
  // Empty time field clears the override.
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const idValid = typeof raw.id === "string" && /^[0-9a-f-]{36}$/i.test(raw.id);
  if (!idValid) return;
  const id = raw.id as string;

  if (!raw.hhmm || raw.hhmm === "") {
    await supabase
      .from("planned_sessions")
      .update({ planned_at: null })
      .eq("id", id)
      .eq("user_id", user.id);
    revalidatePath("/app");
    revalidatePath("/app/plan");
    return;
  }

  const parsed = setPlannedTimeSchema.safeParse(raw);
  if (!parsed.success) return;

  // Look up the planned session + its block to compute the day's date.
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, week_index, day_index, block_id")
    .eq("id", parsed.data.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!planned) return;

  const { data: block } = await supabase
    .from("training_blocks")
    .select("started_on")
    .eq("id", planned.block_id)
    .maybeSingle();
  if (!block) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const tz = profile?.timezone ?? "UTC";

  // Compute the calendar date this slot falls on.
  const { dayDate } = await import("./queries");
  const date = dayDate(block.started_on, planned.week_index, planned.day_index);
  const { localTimeToUTC } = await import("./time-of-day");
  const utc = localTimeToUTC(date, parsed.data.hhmm, tz);

  await supabase
    .from("planned_sessions")
    .update({ planned_at: utc.toISOString() })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);

  revalidatePath("/app");
  revalidatePath("/app/plan");
}

const startPlannedSchema = z.object({ id: z.string().uuid() });

/**
 * Maximum allowed back-date for retroactive session logging, in days.
 *
 * Anything beyond two weeks is almost certainly user error (a typo
 * in the date picker, or "I'll just back-fill the whole previous
 * month"), which would silently scramble adherence + ESL attribution.
 * The picker pre-fill defaults to the planned date so the legitimate
 * "I logged yesterday's workout today" path never bumps against this.
 */
const MAX_RETRO_PERFORMED_AT_DAYS = 14;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a retroactive `performedAt` YYYY-MM-DD against the user
 * timezone. Returns the start-of-day UTC instant for the picked date,
 * or throws a user-facing Error.
 */
async function resolveRetroPerformedAt(
  performedAt: string,
  userId: string,
): Promise<Date> {
  // Cheap structural check first — we don't want to round-trip to
  // profiles just to reject "lol nope".
  if (!YMD_RE.test(performedAt)) {
    throw new Error("Invalid performed_at: expected YYYY-MM-DD");
  }
  const [y, m, d] = performedAt.split("-").map((s) => Number.parseInt(s, 10));
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new Error("Invalid performed_at: not a real calendar date");
  }
  const tz = await getUserTimezone(userId);
  const today = todayYmd(tz);
  const delta = daysBetweenYmd(performedAt, today); // today - picked
  if (delta < 0) {
    throw new Error("performed_at cannot be in the future");
  }
  if (delta > MAX_RETRO_PERFORMED_AT_DAYS) {
    throw new Error(
      `performed_at cannot be more than ${MAX_RETRO_PERFORMED_AT_DAYS} days in the past`,
    );
  }
  return ymdToUtc(performedAt, tz);
}

/**
 * Start a real session from a planned slot.
 *
 * Creates a sessions row pre-populated with the planned title + a set_log
 * stub per prescription item (no weights yet — user logs them as actual sets),
 * and links it back to the planned_session.
 *
 * Honours an optional `performedAt` form field (YYYY-MM-DD) — when
 * present, the new session is back-dated to start-of-day in the user's
 * timezone. See `startSessionDirect` for the validation rules.
 */
export async function startSessionFromPlan(formData: FormData): Promise<void> {
  const parsed = startPlannedSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) throw new Error("Invalid planned session id");
  const rawPerformedAt = formData.get("performedAt");
  const performedAt =
    typeof rawPerformedAt === "string" && rawPerformedAt.length > 0
      ? rawPerformedAt
      : undefined;
  await startSessionDirect(parsed.data.id, performedAt ? { performedAt } : undefined);
}

/**
 * Start a planned session WITHOUT a pre-session check-in.
 *
 * This is the single source of truth for materialising a planned
 * session into a real `sessions` row. The legacy
 * `startCheckInSession` path that also wrote `fatigue` / `soreness`
 * onto the new sessions row was removed when the pre-workout
 * interstitial was deleted, and the follow-up Today-page wellness
 * check-in card has since also been retired (see
 * chore/retire-wellness-checkin). The `wellness` table and engine
 * read path stay intact for optionality. Callers that need the
 * URL-driven version use the `/app/sessions/start/[plannedId]` page
 * which auto-invokes this helper and redirects.
 *
 * Side effects (must stay in lockstep with the planner's expectations):
 *   1. INSERT a new `sessions` row carrying the planned title, slot,
 *      and planned_at (so the planner can correlate it back).
 *   2. UPDATE the matching `planned_sessions` row's
 *      `completed_session_id` so the plan calendar knows the row is
 *      now linked-and-in-progress.
 *   3. Revalidate `/app` + `/app/plan` so the CTAs flip on the next
 *      paint. SKIPPED when `options.skipRevalidate` is set — the
 *      URL-driven `/app/sessions/start/[plannedId]` page invokes this
 *      helper DURING RENDER, where `revalidatePath` is unsupported in
 *      Next 16 (it throws). That path relies on `/app` + `/app/plan`
 *      being cookie-dynamic routes (router-cache `staleTimes.dynamic=0`),
 *      so a fresh server render on the next navigation reflects the
 *      started session without an explicit revalidate.
 *   4. Redirect to `/app/sessions/<new-id>` — the session log surface.
 *
 * Idempotent re-entry: if the planned row already has a
 * `completed_session_id`, we skip the insert and redirect to that active
 * session. A soft-deleted in-progress link is stale, though: it is cleared
 * conditionally and replaced with a fresh session so the deleted attempt's
 * set logs can never become the next workout's progress. Keeping the link
 * intact until this point lets Undo/Trash restore the original association.
 */
export async function startSessionDirect(
  plannedId: string,
  options?: { performedAt?: string; skipRevalidate?: boolean },
): Promise<never> {
  const parsed = startPlannedSchema.safeParse({ id: plannedId });
  if (!parsed.success) throw new Error("Invalid planned session id");

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // Resolve the back-date BEFORE the planned-session lookup so we
  // surface the error path before any DB mutation. `resolveRetro…`
  // throws a user-facing message that the form action surfaces via
  // Next's error overlay.
  const retroPerformedAt =
    options?.performedAt != null
      ? await resolveRetroPerformedAt(options.performedAt, user.id)
      : null;

  const { data: planned, error: plannedError } = await supabase
    .from("planned_sessions")
    .select("id, title, slot, planned_at, prescription, completed_session_id, user_id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (plannedError) throw new Error("Could not load the workout. Try again.");
  if (!planned) throw new Error("Planned session not found");
  if (planned.user_id !== user.id) throw new Error("Planned session not found");

  // Idempotent re-entry: reuse an active linked session. A soft-deleted
  // in-progress link is stale, however. It must not be revived because its
  // set_logs are the cancelled attempt's progress; the normal create/link
  // path below will replace it with a clean session.
  if (planned.completed_session_id) {
    const staleCandidate = planned.completed_session_id as string;
    const { data: linkedSession, error: linkedErr } = await supabase
      .from("sessions")
      .select("id, deleted_at, completed_at")
      .eq("id", staleCandidate)
      .eq("user_id", user.id)
      .maybeSingle();
    if (linkedErr) throw new Error(linkedErr.message);
    if (linkedSession && linkedSession.deleted_at == null) {
      redirect(`/app/sessions/${staleCandidate}`);
    }
    if (linkedSession?.completed_at != null) {
      redirect("/app/settings/trash");
    }
    // The transaction below replaces only a deleted, unfinished link.
  }

  let { data: sessionId, error } = await supabase.rpc("start_planned_session_atomically", {
    p_planned_id: planned.id, p_performed_at: retroPerformedAt?.toISOString() ?? null,
  });
  if (isMissingScheduleFunction(error, "start_planned_session_atomically")) {
    // App-first rollout only: retain the previous conditional-link path until
    // 0156 is installed. Only this request's unused insert may be cleaned up.
    const created = await supabase.from("sessions").insert({
      user_id: user.id, title: planned.title, slot: planned.slot ?? "single",
      planned_at: planned.planned_at, prescription: planned.prescription,
      ...(retroPerformedAt ? { performed_at: retroPerformedAt.toISOString() } : {}),
    }).select("id").single();
    if (created.error || !created.data) throw new Error("Could not start the workout. Try again.");
    let link = supabase.from("planned_sessions").update({ completed_session_id: created.data.id }).eq("id", planned.id).eq("user_id", user.id);
    link = planned.completed_session_id ? link.eq("completed_session_id", planned.completed_session_id) : link.is("completed_session_id", null);
    const linked = await link.select("id,completed_session_id").maybeSingle();
    if (linked.error) throw new Error("Could not confirm the workout start. Try again.");
    sessionId = created.data.id;
    if (!linked.data) {
      const winner = await supabase.from("planned_sessions").select("completed_session_id").eq("id", planned.id).eq("user_id", user.id).maybeSingle();
      if (winner.error) throw new Error("Could not confirm the workout start. Try again.");
      const cleanup = await supabase.from("sessions").delete().eq("id", created.data.id).eq("user_id", user.id);
      if (cleanup.error) throw new Error("Could not remove the unused workout. Try again.");
      if (!winner.data?.completed_session_id) throw new Error("The planned workout changed. Reload and try again.");
      sessionId = winner.data.completed_session_id;
    }
    error = null;
  }
  if (error) throw new Error(error.message);
  if (!z.string().uuid().safeParse(sessionId).success) throw new Error("The workout start was not confirmed. Try again.");

  if (!options?.skipRevalidate) {
    revalidatePath("/app");
    revalidatePath("/app/plan");
  }
  redirect(`/app/sessions/${sessionId}`);
}
