import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Direct-DB seed + assertion helpers for the session-log E2E.
 *
 * Mirrors the pattern in `seed-blocks.ts`: thin service-role wrappers
 * that skip the UI walk for pre-conditions / post-conditions that
 * aren't the focus of the spec.
 *
 * What we seed here that `seed-blocks.ts` doesn't already cover:
 *   1) An *active* training_blocks row (the "Run it again" picker only
 *      needs a completed block, but the log path needs the user's
 *      active block so /app surfaces today's CTA).
 *   2) planned_sessions rows with a real prescription pointing at
 *      catalog movements, so the test can navigate /app → Start session
 *      → log sets against a known lift.
 *
 * Column names mirror the Drizzle schema in packages/db/src/schema —
 * snake_case at the PostgREST layer.
 */

type AdminClient = SupabaseClient;

const CANONICAL_STRENGTH_SLUGS = [
  "back-squat-high-bar",
  "conventional-deadlift",
  "bench-press-flat",
  "ohp-standing",
] as const;

export type SeedActiveBlockOptions = {
  /** Defaults to 4. */
  weeks?: number;
  /**
   * Defaults to 4. The block's days_per_week. Drives the number of
   * planned_sessions inserted per week.
   */
  daysPerWeek?: number;
  /**
   * Defaults to "strength_anchor". The archetype label is informational
   * for this seed — we build the prescription ourselves, we don't run
   * the planner.
   */
  archetype?: string;
};

export type SeedActiveBlockResult = {
  blockId: string;
  /**
   * Planned-session id for "today" (week_index 0 + today's weekday).
   * The spec navigates here to log a real session.
   */
  todayPlannedId: string;
  /** Movement id used for today's main item (canonical squat slug). */
  todayMovementId: string;
  /** Display name of the canonical movement, for UI search matching. */
  todayMovementDisplayName: string;
};

/** ISO weekday (Mon=0..Sun=6) for a local-time `Date`. */
function isoWeekday(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Build the (movementId, week, day, slot, title, role, prescription) rows
 * for an N-week × M-day strength block. Each lift gets its own day_index
 * and repeats across weeks with a simple percent-of-TM wave.
 *
 * The dayIndex assignment guarantees today is one of the training days so
 * `/app` surfaces a "Start session" CTA when the spec navigates there.
 */
function buildPlannedRows(opts: {
  blockId: string;
  userId: string;
  weeks: number;
  daysPerWeek: number;
  lifts: { id: string; slug: string; displayName: string }[];
}): {
  rows: Array<{
    block_id: string;
    user_id: string;
    week_index: number;
    day_index: number;
    slot: "single";
    title: string;
    role: string;
    prescription: { items: unknown[] };
  }>;
  todayKey: { week: number; day: number };
  todayLiftIdx: number;
} {
  const todayDayIdx = isoWeekday(new Date());
  // Choose dayIndices: today's weekday + the next (daysPerWeek-1) wrapping
  // around so every lift maps to a unique day_index and today is included.
  const dayIndices: number[] = [];
  for (let i = 0; i < opts.daysPerWeek; i++) {
    dayIndices.push((todayDayIdx + i) % 7);
  }

  // Percent-of-TM wave per week. Standard small-progression shape.
  const waves = [0.7, 0.75, 0.825, 0.6];

  const rows: ReturnType<typeof buildPlannedRows>["rows"] = [];
  for (let w = 0; w < opts.weeks; w++) {
    for (let i = 0; i < opts.daysPerWeek; i++) {
      const lift = opts.lifts[i % opts.lifts.length]!;
      const pct = Math.round((waves[w] ?? 0.7) * 100);
      rows.push({
        block_id: opts.blockId,
        user_id: opts.userId,
        week_index: w,
        day_index: dayIndices[i]!,
        slot: "single",
        title: `${lift.displayName} day`,
        role: lift.slug,
        prescription: {
          items: [
            {
              movementId: lift.id,
              movementSlug: lift.slug,
              movementName: lift.displayName,
              kind: "main",
              sets: 3,
              reps: 5,
              percentTm: pct,
            },
          ],
        },
      });
    }
  }
  return {
    rows,
    todayKey: { week: 0, day: todayDayIdx },
    todayLiftIdx: 0,
  };
}

/**
 * Seed an active training_blocks row + planned_sessions for the four
 * canonical strength-anchor lifts (squat / deadlift / bench / ohp),
 * arranged so that today's weekday is one of the training days. Returns
 * the id of "today's" planned_session so the spec can drive the
 * `/app/sessions/start/[plannedId]` flow directly when needed.
 *
 * The block's `started_on` is set to today (local) so `dayDate(week=0,
 * day=isoWeekday(today))` resolves to today and the `/app` "today's
 * card" path lights up.
 *
 * NOTE: this assumes `seedStrengthTms` already ran (so the TM dict on
 * the session page renders a percent-of-TM footer). The two helpers are
 * intentionally orthogonal — call both in the spec.
 */
export async function seedActiveBlock(
  admin: AdminClient,
  userId: string,
  opts: SeedActiveBlockOptions = {},
): Promise<SeedActiveBlockResult> {
  const weeks = opts.weeks ?? 4;
  const daysPerWeek = opts.daysPerWeek ?? 4;
  const archetype = opts.archetype ?? "strength_anchor";

  // Pull the canonical strength movements. The catalog is global
  // (user_id IS NULL); we don't filter by user_id because RLS allows
  // anyone to read the global catalog.
  const { data: movements, error: mErr } = await admin
    .from("movements")
    .select("id, slug, display_name")
    .in("slug", CANONICAL_STRENGTH_SLUGS as unknown as string[]);
  if (mErr) throw new Error(`seedActiveBlock: movements: ${mErr.message}`);
  if (!movements || movements.length < daysPerWeek) {
    throw new Error(
      `seedActiveBlock: catalog missing canonical strength movements (got ${movements?.length ?? 0}, need ${daysPerWeek})`,
    );
  }
  // Sort the resolved movements to match CANONICAL_STRENGTH_SLUGS order
  // so day_index 0 is always squat — keeps the spec deterministic.
  const liftsBySlug = new Map(
    movements.map((m) => [m.slug, { id: m.id, slug: m.slug, displayName: m.display_name }]),
  );
  const lifts = CANONICAL_STRENGTH_SLUGS.slice(0, daysPerWeek).map((slug) => {
    const m = liftsBySlug.get(slug);
    if (!m) throw new Error(`seedActiveBlock: missing canonical lift '${slug}'`);
    return m;
  });

  const startedOn = ymd(new Date());

  const { data: block, error: bErr } = await admin
    .from("training_blocks")
    .insert({
      user_id: userId,
      archetype,
      started_on: startedOn,
      weeks,
      days_per_week: daysPerWeek,
      status: "active",
    })
    .select("id")
    .single();
  if (bErr || !block) {
    throw new Error(`seedActiveBlock: training_blocks: ${bErr?.message ?? "no row"}`);
  }

  const { rows, todayKey, todayLiftIdx } = buildPlannedRows({
    blockId: block.id,
    userId,
    weeks,
    daysPerWeek,
    lifts,
  });

  const { error: psErr } = await admin.from("planned_sessions").insert(rows);
  if (psErr) {
    throw new Error(`seedActiveBlock: planned_sessions: ${psErr.message}`);
  }

  // Read back the id of today's planned_session — we don't know it
  // ahead of time because the DB generates the uuid.
  const { data: todayRow, error: tErr } = await admin
    .from("planned_sessions")
    .select("id")
    .eq("block_id", block.id)
    .eq("user_id", userId)
    .eq("week_index", todayKey.week)
    .eq("day_index", todayKey.day)
    .eq("slot", "single")
    .single();
  if (tErr || !todayRow) {
    throw new Error(
      `seedActiveBlock: failed to resolve today's planned id: ${tErr?.message ?? "no row"}`,
    );
  }

  const todayLift = lifts[todayLiftIdx]!;
  return {
    blockId: block.id,
    todayPlannedId: todayRow.id,
    todayMovementId: todayLift.id,
    todayMovementDisplayName: todayLift.displayName,
  };
}

export type AssertSessionCompleteOptions = {
  /** Expected number of set_logs rows on this session. */
  expectedSetCount?: number;
  /**
   * The planned_session id this session was started from. When set, the
   * helper asserts `planned_sessions.completed_session_id = sessionId`.
   */
  plannedSessionId?: string;
  /**
   * Expected fatigue value on the session row (from the pre-session
   * check-in). When set, the helper asserts the value persisted.
   */
  expectedFatigue?: number;
  /** Expected soreness value (see expectedFatigue). */
  expectedSoreness?: number;
};

/**
 * Service-role assertion that a session is in the canonical "complete"
 * shape: completed_at populated, optional set_logs count match, and
 * optional planned_session linkage.
 *
 * Throws when any invariant is violated. Used by the session-log spec
 * to verify the server-canonical state once the UI flow has finished.
 */
export async function assertSessionComplete(
  admin: AdminClient,
  sessionId: string,
  opts: AssertSessionCompleteOptions = {},
): Promise<void> {
  const { data: session, error: sErr } = await admin
    .from("sessions")
    .select("id, completed_at, fatigue, soreness, session_rpe, duration_min")
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr) throw new Error(`assertSessionComplete: sessions: ${sErr.message}`);
  if (!session) throw new Error(`assertSessionComplete: no session row for ${sessionId}`);
  if (!session.completed_at) {
    throw new Error(`assertSessionComplete: completed_at is null on ${sessionId}`);
  }
  if (opts.expectedFatigue != null && session.fatigue !== opts.expectedFatigue) {
    throw new Error(
      `assertSessionComplete: fatigue mismatch (expected ${opts.expectedFatigue}, got ${session.fatigue})`,
    );
  }
  if (opts.expectedSoreness != null && session.soreness !== opts.expectedSoreness) {
    throw new Error(
      `assertSessionComplete: soreness mismatch (expected ${opts.expectedSoreness}, got ${session.soreness})`,
    );
  }

  if (opts.expectedSetCount != null) {
    const { count, error: cErr } = await admin
      .from("set_logs")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);
    if (cErr) throw new Error(`assertSessionComplete: set_logs: ${cErr.message}`);
    if ((count ?? 0) !== opts.expectedSetCount) {
      throw new Error(
        `assertSessionComplete: set count mismatch (expected ${opts.expectedSetCount}, got ${count ?? 0})`,
      );
    }
  }

  if (opts.plannedSessionId) {
    const { data: planned, error: pErr } = await admin
      .from("planned_sessions")
      .select("id, completed_session_id")
      .eq("id", opts.plannedSessionId)
      .maybeSingle();
    if (pErr) throw new Error(`assertSessionComplete: planned_sessions: ${pErr.message}`);
    if (!planned) {
      throw new Error(
        `assertSessionComplete: planned_session ${opts.plannedSessionId} not found`,
      );
    }
    if (planned.completed_session_id !== sessionId) {
      throw new Error(
        `assertSessionComplete: planned_sessions.completed_session_id mismatch (expected ${sessionId}, got ${planned.completed_session_id})`,
      );
    }
  }
}
