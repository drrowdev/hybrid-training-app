"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { todayYmd, ymdToUtc, daysBetweenYmd } from "@/lib/dates";
import { getUserTimezone } from "./queries";
import { swapPlannedSessions } from "./swap";
import { recordOverrideEvent } from "@/lib/engine/overrides";

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
  const nowIso = new Date().toISOString();

  // Capture engine context BEFORE the archive write so the snapshot
  // reflects the block as the user last saw it (active, week N of K).
  // DC-K4: every override carries the engine state at decision time.
  const [{ data: blockRow }, { data: completionRow }] = await Promise.all([
    supabase
      .from("training_blocks")
      .select("archetype, weeks, started_on")
      .eq("id", parsed.data.id)
      .maybeSingle(),
    supabase
      .from("planned_sessions")
      .select("id, completed_session_id, skipped_at", { count: "exact" })
      .eq("block_id", parsed.data.id),
  ]);

  await supabase
    .from("training_blocks")
    .update({ status: "archived", archived_at: nowIso, ended_at: nowIso })
    .eq("id", parsed.data.id);

  const {
    data: { user },
  } = await getAuthUser();
  if (user) {
    const totalPlanned = completionRow?.length ?? 0;
    const totalDone = (completionRow ?? []).filter(
      (r) => r.completed_session_id || r.skipped_at,
    ).length;
    const percentThrough = totalPlanned > 0 ? totalDone / totalPlanned : 0;
    const weeks = blockRow?.weeks as number | undefined;
    const startedOn = blockRow?.started_on as string | undefined;
    let weeksCompleted: number | undefined;
    if (startedOn) {
      const startMs = Date.parse(`${startedOn}T00:00:00Z`);
      if (!Number.isNaN(startMs)) {
        const days = Math.max(0, Math.floor((Date.now() - startMs) / 86_400_000));
        weeksCompleted = Math.floor(days / 7);
        if (typeof weeks === "number") {
          weeksCompleted = Math.min(weeksCompleted, weeks);
        }
      }
    }
    await recordOverrideEvent(supabase, {
      userId: user.id,
      eventType: "manual_end",
      occurredAt: nowIso,
      blockId: parsed.data.id,
      reason: parsed.data.reason ?? null,
      context: {
        archetype: blockRow?.archetype as string | undefined,
        weeks,
        weeksCompleted,
        percentThrough: Number(percentThrough.toFixed(3)),
      },
    });
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
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

  const { error } = await supabase
    .from("training_blocks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "Missing block id." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("training_blocks")
    .update({ deleted_at: null })
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
 * user identifies a Strava-imported activity (or any logged session
 * on the same calendar day) as the realisation of a planned slot, we
 * point `completed_session_id` at it. RLS + the inner-join through
 * training_blocks ensures only the owning user can mutate the row.
 */
export async function linkPlannedToSession(formData: FormData): Promise<void> {
  const parsed = linkPlannedSchema.safeParse({
    plannedId: formData.get("plannedId"),
    sessionId: formData.get("sessionId"),
  });
  if (!parsed.success) return;
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
  if (!parsed.success) return;
  const supabase = await createClient();
  const skippedAt = new Date().toISOString();

  // Read planned + block context BEFORE the update so the audit row
  // carries the engine state the user actually saw when skipping.
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select(
      "id, user_id, block_id, week_index, day_index, training_blocks!inner(archetype, started_on)",
    )
    .eq("id", parsed.data.id)
    .maybeSingle();

  await supabase
    .from("planned_sessions")
    .update({ skipped_at: skippedAt })
    .eq("id", parsed.data.id);

  if (planned) {
    const block = (planned as unknown as {
      training_blocks: { archetype: string; started_on: string };
    }).training_blocks;
    const startedOn = block?.started_on as string | undefined;
    const weekIndex = planned.week_index as number;
    const dayIndex = planned.day_index as number;
    let weekday: number | undefined;
    if (startedOn) {
      const startMs = Date.parse(`${startedOn}T12:00:00Z`);
      if (!Number.isNaN(startMs)) {
        const dayMs = startMs + (weekIndex * 7 + dayIndex) * 86_400_000;
        const d = new Date(dayMs);
        weekday = ((d.getUTCDay() + 6) % 7) + 1;
      }
    }
    await recordOverrideEvent(supabase, {
      userId: planned.user_id as string,
      eventType: "skip",
      occurredAt: skippedAt,
      plannedSessionId: parsed.data.id,
      blockId: planned.block_id as string,
      reason: parsed.data.reason ?? null,
      context: {
        archetype: block?.archetype,
        weekIndex,
        dayIndex,
        weekday,
      },
    });
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
}

const unskipSchema = z.object({ id: z.string().uuid() });

const moveSchema = z.object({
  id: z.string().uuid(),
  weekIndex: z.number().int().min(0),
  dayIndex: z.number().int().min(0).max(6),
});

/**
 * Move a planned session to a new (week_index, day_index) slot. If the
 * target slot already holds a planned_sessions row (and neither row is
 * completed), the two rows swap. Out-of-block target weeks are rejected
 * silently. Completed/skipped sessions can be moved but the partner
 * (if any) is left in place.
 *
 * UI-only operation: the engine's stress budget / recovery math is
 * unchanged — the user can already reorder days via the wizard.
 */
export async function movePlannedSession(formData: FormData): Promise<void> {
  const parsed = moveSchema.safeParse({
    id: formData.get("id"),
    weekIndex: Number(formData.get("weekIndex")),
    dayIndex: Number(formData.get("dayIndex")),
  });
  if (!parsed.success) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, block_id, week_index, day_index, slot")
    .eq("id", parsed.data.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!planned) return;

  const { data: block } = await supabase
    .from("training_blocks")
    .select("weeks")
    .eq("id", planned.block_id)
    .maybeSingle();
  if (!block) return;
  if (parsed.data.weekIndex >= (block.weeks as number)) return;

  // No-op if already on the target slot.
  if (
    planned.week_index === parsed.data.weekIndex &&
    planned.day_index === parsed.data.dayIndex
  ) {
    return;
  }

  // Find what (if anything) currently sits on the target slot. Limit to
  // the same block + same slot label so a 2-a-day doesn't get clobbered
  // by a 1-a-day swap (we only swap matching slots).
  const { data: existing } = await supabase
    .from("planned_sessions")
    .select("id, week_index, day_index, slot")
    .eq("block_id", planned.block_id)
    .eq("user_id", user.id)
    .eq("week_index", parsed.data.weekIndex)
    .eq("day_index", parsed.data.dayIndex);

  const target = (existing ?? []).find((r) => r.slot === planned.slot);

  if (target && target.id !== planned.id) {
    // Atomic-ish swap with rollback on partial failure. See
    // ./swap.ts for the parking-slot strategy + rationale. The helper
    // throws on any DB error so we surface failures to the caller
    // instead of silently leaving a row stranded at the guard slot.
    await swapPlannedSessions({
      client: supabase as unknown as Parameters<typeof swapPlannedSessions>[0]["client"],
      userId: user.id,
      sourceId: planned.id,
      sourceWeek: planned.week_index,
      sourceDay: planned.day_index,
      targetId: target.id,
      targetWeek: parsed.data.weekIndex,
      targetDay: parsed.data.dayIndex,
      blockWeeks: block.weeks as number,
    });
  } else {
    const { error: moveErr } = await supabase
      .from("planned_sessions")
      .update({ week_index: parsed.data.weekIndex, day_index: parsed.data.dayIndex })
      .eq("id", planned.id)
      .eq("user_id", user.id);
    if (moveErr) {
      throw new Error(
        `movePlannedSession: failed to move ${planned.id}: ${moveErr.message}`,
      );
    }
  }

  // Moving a day clears any explicit planned_at (the absolute timestamp
  // referred to the OLD calendar date — keeping it would put the
  // session on the wrong wall-clock day).
  const { error: clearErr } = await supabase
    .from("planned_sessions")
    .update({ planned_at: null })
    .in("id", target ? [planned.id, target.id] : [planned.id])
    .eq("user_id", user.id);
  if (clearErr) {
    throw new Error(
      `movePlannedSession: failed to clear planned_at after move: ${clearErr.message}`,
    );
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
}

export async function unskipPlannedSession(formData: FormData): Promise<void> {
  const parsed = unskipSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase
    .from("planned_sessions")
    .update({ skipped_at: null })
    .eq("id", parsed.data.id);
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

  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, title, slot, planned_at, prescription, completed_session_id, user_id")
    .eq("id", parsed.data.id)
    .maybeSingle();

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
    if (linkedSession) {
      const { error: staleLinkError } = await supabase
        .from("planned_sessions")
        .update({ completed_session_id: null })
        .eq("id", planned.id)
        .eq("user_id", user.id)
        .eq("completed_session_id", staleCandidate);
      if (staleLinkError) throw new Error(staleLinkError.message);
    }
    // A hard-deleted row has already nulled the FK; continue through the
    // ordinary create/link path. If another request won the conditional
    // stale-link update, the conditional link below will clean up our
    // orphan and redirect to that winner.
  }

  const sessionPayload: {
    user_id: string;
    title: string;
    slot: string;
    planned_at: string | null;
    performed_at?: string;
  } = {
    user_id: user.id,
    title: planned.title,
    slot: planned.slot ?? "single",
    planned_at: planned.planned_at,
  };
  if (retroPerformedAt) {
    sessionPayload.performed_at = retroPerformedAt.toISOString();
  }

  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .insert(sessionPayload)
    .select("id")
    .single();

  if (sessErr || !session) throw new Error(sessErr?.message ?? "Failed to start session");

  // Conditional link so a concurrent caller (e.g. middle-click that
  // bypasses the client-side one-tap lock) cannot overwrite an earlier
  // winner. If the UPDATE affects zero rows, another request already
  // linked first — delete our orphan insert and redirect to the winner.
  const { data: linked, error: linkErr } = await supabase
    .from("planned_sessions")
    .update({ completed_session_id: session.id })
    .eq("id", planned.id)
    .eq("user_id", user.id)
    .is("completed_session_id", null)
    .select("id, completed_session_id")
    .maybeSingle();

  if (linkErr) throw new Error(linkErr.message);

  if (!linked) {
    // Lost the race. Clean up the orphaned session and reuse the winner.
    await supabase.from("sessions").delete().eq("id", session.id);
    const { data: winner } = await supabase
      .from("planned_sessions")
      .select("completed_session_id")
      .eq("id", planned.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (winner?.completed_session_id) {
      if (!options?.skipRevalidate) {
        revalidatePath("/app");
        revalidatePath("/app/plan");
      }
      redirect(`/app/sessions/${winner.completed_session_id}`);
    }
    throw new Error("Failed to link planned session after race");
  }

  if (!options?.skipRevalidate) {
    revalidatePath("/app");
    revalidatePath("/app/plan");
  }
  redirect(`/app/sessions/${session.id}`);
}
