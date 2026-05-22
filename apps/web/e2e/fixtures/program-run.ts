import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Direct-DB seed + assertion helpers for the program-run E2E.
 *
 * Closes the third AGENTS.md critical path ("auth + log + program-run").
 *
 * The helpers here are richer than `session-log.ts::seedActiveBlock`
 * because the program-run scenarios need to navigate to a SPECIFIC
 * `(weekIndex, dayIndex)` of an active block — most importantly the
 * deload week (weekIndex=3 for strength_anchor) and the very last
 * planned session of the block.
 *
 * Cursor math (mirrors `apps/web/src/lib/planner/queries.ts::dayDate`):
 *
 *   dayDate(startedOn, w, d):
 *     blockMonday = startedOn - isoWeekday(startedOn)
 *     return blockMonday + w*7 + d
 *
 * All arithmetic anchored in UTC string-math (post fix/daydate-timezone),
 * so the resolved date is invariant under host TZ.
 *
 * To make `dayDate(startedOn, weekIndex, dayIndex)` resolve to TODAY,
 * we set `dayIndex = isoWeekday(today)` and
 * `startedOn = today - (weekIndex * 7 + dayIndex)`. By construction
 * that startedOn lands on a Monday (isoWeekday=0), so the snap-back
 * in `dayDate` is a no-op and the math holds.
 *
 * The deload prescription values mirror `STRENGTH_ANCHOR.weekProfiles[3]`
 * from `apps/web/src/lib/planner/archetypes.ts`. We hard-code them here
 * rather than importing the module so the fixture stays free of Next.js
 * server-only imports (the archetype file pulls @hta/db types transitively
 * but never touches I/O at module top level — still, the simpler invariant
 * to maintain is "fixture has zero imports from /app code").
 *
 * If `STRENGTH_ANCHOR.weekProfiles[3]` ever changes, the deload assertion
 * in `program-run-desktop.spec.ts` will catch the drift — it asserts both
 * the fixture-supplied prescription AND the rendered title, so a values
 * change without spec update will fail loudly.
 */

type AdminClient = SupabaseClient;

const CANONICAL_STRENGTH_SLUGS = [
  "back-squat-high-bar",
  "conventional-deadlift",
  "bench-press-flat",
  "ohp-standing",
] as const;

/** Mirrors STRENGTH_ANCHOR.weekProfiles in apps/web/src/lib/planner/archetypes.ts. */
export const STRENGTH_ANCHOR_WEEK_PROFILES = [
  { weekIndex: 0, setIntensities: [0.65, 0.75, 0.85], setReps: 5, intensityLabel: "5s wave" },
  { weekIndex: 1, setIntensities: [0.7, 0.8, 0.9], setReps: 3, intensityLabel: "3s wave" },
  {
    weekIndex: 2,
    setIntensities: [0.75, 0.85, 0.95],
    setReps: [5, 3, 1] as number[],
    intensityLabel: "Heavy peak",
  },
  {
    weekIndex: 3,
    setIntensities: [0.4, 0.5, 0.6],
    setReps: 5,
    intensityLabel: "Deload",
    strengthVolumeScale: 0.5,
  },
] as const;

/**
 * Pure YYYY-MM-DD arithmetic, identical to production's `dayDate` (post
 * timezone fix). We anchor everything in UTC so the math is timezone-free:
 * parsing as UTC, adding days via setUTCDate, and reading back UTC
 * components never crosses a TZ boundary.
 *
 * Re-implemented rather than imported so the fixture stays free of
 * server-only Next.js code (the queries module pulls in @/lib/supabase/server).
 * If `dayDate`'s contract ever changes, this fixture and the
 * `daydate-tz.test.ts` regression suite will diverge from production —
 * keep them in sync.
 */
function productionDayDate(startedOn: string, weekIndex: number, dayIndex: number): string {
  const parse = (iso: string) => {
    const [y, m, d] = iso.split("-").map((s) => Number.parseInt(s, 10));
    return new Date(Date.UTC(y, m - 1, d));
  };
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const addDays = (iso: string, days: number) => {
    const d = parse(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return fmt(d);
  };
  const isoWeekdayStr = (iso: string) => (parse(iso).getUTCDay() + 6) % 7;
  const blockMonday = addDays(startedOn, -isoWeekdayStr(startedOn));
  return addDays(blockMonday, weekIndex * 7 + dayIndex);
}

/**
 * Local YYYY-MM-DD matching production's `todayYmd(tz)` when `tz` is the
 * host's system timezone — which is what the dev server / Playwright
 * worker process sees. The Playwright workers don't have a profile row to
 * pull from, so we anchor on the host's wall clock.
 */
function todayLocalYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type SeedBlockAtWeekDayOptions = {
  /**
   * Target week_index that should contain TODAY's planned_session. 0..3
   * for a 4-week strength_anchor block. The exact day_index within that
   * week is whichever value `productionDayDate(startedOn, weekIndex, d)`
   * resolves to today — the fixture doesn't try to control that; it just
   * positions `started_on` so that *some* day in the target week maps
   * to today. Defaults to 0.
   */
  weekIndex?: number;
  /** Defaults to 4. */
  weeks?: number;
  /** Defaults to 4. */
  daysPerWeek?: number;
  /** Informational only. Defaults to "strength_anchor". */
  archetype?: string;
  /**
   * Mark every planned_session whose production-resolved date is
   * strictly before today as completed (creating a backing `sessions`
   * row for each so the FK is satisfied). Defaults to false.
   */
  completePriorSessions?: boolean;
  /**
   * Mark every planned_session as completed EXCEPT today's row(s) —
   * i.e. the rows production resolves to today's calendar date. Used by
   * the block-completion scenario. Forces `weekIndex` to `weeks - 1` so
   * today's row sits in the last week of the block. Defaults to false.
   */
  completeAllExceptLast?: boolean;
};

export type SeedBlockAtWeekDayResult = {
  blockId: string;
  startedOn: string;
  /** The planned_session whose production-resolved date is TODAY. */
  todayPlannedId: string;
  /** week_index of the today row. */
  todayWeekIndex: number;
  /** day_index of the today row. */
  todayDayIndex: number;
  /** Title persisted on the today row (carries "(deload)" suffix in deload weeks). */
  todayTitle: string;
  /** Movement id of the today row's main item. */
  todayMovementId: string;
  /** Display name of the today row's movement (for UI catalog search). */
  todayMovementDisplayName: string;
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return ymd(d);
}

/**
 * Build a prescription that matches what production's `buildPrescription`
 * (apps/web/src/lib/planner/archetypes.ts) emits for a strength_anchor
 * strength day at the given weekIndex. The deload week (intensityLabel
 * "Deload") applies the same `strengthVolumeScale` halving production
 * does, so the rendered card matches /app/plan exactly.
 */
function buildStrengthPrescription(
  weekIndex: number,
  movement: { id: string; slug: string; displayName: string },
): { items: unknown[] } {
  const profile = STRENGTH_ANCHOR_WEEK_PROFILES[weekIndex];
  if (!profile) return { items: [] };
  const items = profile.setIntensities.map((pct, i) => {
    const reps = Array.isArray(profile.setReps)
      ? (profile.setReps as number[])[i] ?? 5
      : (profile.setReps as number);
    const item: Record<string, unknown> = {
      movementId: movement.id,
      movementSlug: movement.slug,
      movementName: movement.displayName,
      kind: "main",
      sets: 1,
      reps,
      percentTm: Math.round(pct * 100),
      intensityLabel: `${Math.round(pct * 100)}% TM`,
    };
    if (i === profile.setIntensities.length - 1) item.notes = "top set";
    return item;
  });
  const scale = (profile as { strengthVolumeScale?: number }).strengthVolumeScale;
  if (scale != null && scale < 1) {
    const keep = Math.max(1, Math.round(items.length * scale));
    return { items: items.slice(0, keep) };
  }
  return { items };
}

/**
 * Seed an active strength_anchor-shaped block + planned_sessions, then
 * resolve which row /app will surface as "today" by replicating
 * production's `dayDate` math 1:1 (including its TZ-skew quirk). Returns
 * the canonical today-row metadata for the spec to assert against.
 *
 * The placement strategy:
 *
 *   1. Pick a calendar offset so that the (`targetWeekIndex`, *)
 *      coordinate pair contains some day equal to today per production's
 *      buggy dayDate. We do this by picking startedOn = today minus
 *      (targetWeekIndex * 7 + slack). The slack tries a small window of
 *      day_index offsets and picks one where production dayDate lands
 *      on today for at least one day_index in our 4-day-per-week pool.
 *
 *   2. Insert all `weeks * daysPerWeek` planned_sessions, with
 *      day_indices = [todayDayIdx_local, +1, +2, +3] (mod 7). This is
 *      the same shape `session-log.ts::seedActiveBlock` uses.
 *
 *   3. Read back rows, compute production-resolved date per row, find
 *      the row whose date === today and return its metadata.
 *
 * For `completeAllExceptLast`, we force targetWeekIndex = weeks-1 and
 * after step 3 mark every row whose production date is < today as
 * completed (with a backing `sessions` row).
 */
export async function seedBlockAtWeekDay(
  admin: AdminClient,
  userId: string,
  opts: SeedBlockAtWeekDayOptions = {},
): Promise<SeedBlockAtWeekDayResult> {
  const weeks = opts.weeks ?? 4;
  const daysPerWeek = opts.daysPerWeek ?? 4;
  const archetype = opts.archetype ?? "strength_anchor";
  const targetWeekIndex = opts.completeAllExceptLast
    ? weeks - 1
    : opts.weekIndex ?? 0;
  if (targetWeekIndex < 0 || targetWeekIndex >= weeks) {
    throw new Error(
      `seedBlockAtWeekDay: weekIndex ${targetWeekIndex} out of range [0, ${weeks})`,
    );
  }

  // Build the local dayIndices pool: today's local weekday + 3 following.
  const nowLocal = new Date();
  const todayDayIdxLocal = (nowLocal.getDay() + 6) % 7;
  const dayIndices: number[] = [];
  for (let i = 0; i < daysPerWeek; i++) {
    dayIndices.push((todayDayIdxLocal + i) % 7);
  }
  const todayIsoLocal = todayLocalYmd();

  // Find a (startedOn, dayIndex) pair where production resolves SOME row
  // in `targetWeekIndex` to today. Because the TZ skew is at most ±2
  // days for a typical UTC offset, we search a small window of slack
  // offsets around the naive `today - targetWeekIndex*7 - dayIdx`.
  const slackPool = [0, -1, 1, -2, 2, -3, 3];
  let startedOn: string | null = null;
  for (const baseDay of dayIndices) {
    const slackAttempted: string[] = [];
    for (const slack of slackPool) {
      const candidate = addDaysIso(
        todayIsoLocal,
        -(targetWeekIndex * 7 + baseDay) + slack,
      );
      slackAttempted.push(candidate);
      // Does production resolve any (targetWeekIndex, d in dayIndices) to today?
      const hit = dayIndices.some(
        (d) => productionDayDate(candidate, targetWeekIndex, d) === todayIsoLocal,
      );
      if (hit) {
        startedOn = candidate;
        break;
      }
    }
    if (startedOn) break;
    void slackAttempted;
  }
  if (!startedOn) {
    throw new Error(
      `seedBlockAtWeekDay: could not place started_on so that production dayDate lands on today (target week ${targetWeekIndex}, dayIndices ${dayIndices.join(",")})`,
    );
  }

  // Look up the canonical strength movements.
  const { data: movements, error: mErr } = await admin
    .from("movements")
    .select("id, slug, display_name")
    .in("slug", CANONICAL_STRENGTH_SLUGS as unknown as string[]);
  if (mErr) throw new Error(`seedBlockAtWeekDay: movements: ${mErr.message}`);
  if (!movements || movements.length < daysPerWeek) {
    throw new Error(
      `seedBlockAtWeekDay: catalog missing canonical strength movements (got ${movements?.length ?? 0}, need ${daysPerWeek})`,
    );
  }
  const liftsBySlug = new Map(
    movements.map((m) => [
      m.slug,
      { id: m.id as string, slug: m.slug as string, displayName: m.display_name as string },
    ]),
  );
  const lifts = CANONICAL_STRENGTH_SLUGS.slice(0, daysPerWeek).map((slug) => {
    const m = liftsBySlug.get(slug);
    if (!m) throw new Error(`seedBlockAtWeekDay: missing canonical lift '${slug}'`);
    return m;
  });

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
    throw new Error(`seedBlockAtWeekDay: training_blocks: ${bErr?.message ?? "no row"}`);
  }

  // Build planned_session rows. day_indices map index-for-index to lifts:
  // i=0→squat, i=1→deadlift, i=2→bench, i=3→ohp.
  type PsRow = {
    block_id: string;
    user_id: string;
    week_index: number;
    day_index: number;
    slot: "single";
    title: string;
    role: string;
    prescription: { items: unknown[] };
  };
  const rows: PsRow[] = [];
  for (let w = 0; w < weeks; w++) {
    const profile = STRENGTH_ANCHOR_WEEK_PROFILES[w];
    const isDeload = profile?.intensityLabel === "Deload";
    for (let i = 0; i < daysPerWeek; i++) {
      const lift = lifts[i % lifts.length]!;
      rows.push({
        block_id: block.id,
        user_id: userId,
        week_index: w,
        day_index: dayIndices[i]!,
        slot: "single",
        title: `${lift.displayName}${isDeload ? " (deload)" : ""}`,
        role: lift.slug,
        prescription: buildStrengthPrescription(w, lift),
      });
    }
  }

  const { error: psErr } = await admin.from("planned_sessions").insert(rows);
  if (psErr) {
    throw new Error(`seedBlockAtWeekDay: planned_sessions: ${psErr.message}`);
  }

  // Read back, compute production date per row, identify today.
  const { data: allPlanned, error: allErr } = await admin
    .from("planned_sessions")
    .select("id, week_index, day_index, title, role")
    .eq("block_id", block.id)
    .order("week_index", { ascending: true })
    .order("day_index", { ascending: true });
  if (allErr || !allPlanned) {
    throw new Error(
      `seedBlockAtWeekDay: read-back planned_sessions: ${allErr?.message ?? "no rows"}`,
    );
  }

  const today = todayIsoLocal;
  const todayRows = allPlanned.filter(
    (r) => productionDayDate(startedOn!, r.week_index as number, r.day_index as number) === today,
  );
  if (todayRows.length === 0) {
    throw new Error(
      `seedBlockAtWeekDay: no row resolves to today (${today}) with startedOn=${startedOn}`,
    );
  }
  // Prefer a row in the target week (in case the calendar offset
  // accidentally lands today in an adjacent week).
  const todayRow =
    todayRows.find((r) => (r.week_index as number) === targetWeekIndex) ?? todayRows[0]!;
  if ((todayRow.week_index as number) !== targetWeekIndex) {
    throw new Error(
      `seedBlockAtWeekDay: today landed in week ${todayRow.week_index} (expected ${targetWeekIndex})`,
    );
  }
  const todayLift = liftsBySlug.get(todayRow.role as string)!;

  // Optionally mark prior sessions as completed.
  if (opts.completePriorSessions || opts.completeAllExceptLast) {
    const completeIds: string[] = [];
    for (const r of allPlanned) {
      const rDate = productionDayDate(
        startedOn,
        r.week_index as number,
        r.day_index as number,
      );
      if (opts.completeAllExceptLast) {
        // Complete every row that's NOT one of the today rows. Today
        // remains open so the spec can log it.
        const isToday = rDate === today;
        if (!isToday) completeIds.push(r.id as string);
      } else {
        if (rDate < today) completeIds.push(r.id as string);
      }
    }
    if (completeIds.length > 0) {
      const performedAtBase = Date.now() - completeIds.length * 86_400_000;
      const sessionsRows = completeIds.map((_pid, i) => ({
        user_id: userId,
        title: "seeded prior",
        slot: "single" as const,
        performed_at: new Date(performedAtBase + i * 3_600_000).toISOString(),
        completed_at: new Date(performedAtBase + i * 3_600_000 + 60 * 60_000).toISOString(),
      }));
      const { data: insertedSessions, error: sErr } = await admin
        .from("sessions")
        .insert(sessionsRows)
        .select("id");
      if (sErr || !insertedSessions || insertedSessions.length !== completeIds.length) {
        throw new Error(
          `seedBlockAtWeekDay: insert prior sessions: ${sErr?.message ?? "row count mismatch"}`,
        );
      }
      for (let i = 0; i < completeIds.length; i++) {
        const { error: linkErr } = await admin
          .from("planned_sessions")
          .update({ completed_session_id: insertedSessions[i]!.id })
          .eq("id", completeIds[i]!);
        if (linkErr) {
          throw new Error(`seedBlockAtWeekDay: link planned→session: ${linkErr.message}`);
        }
      }
    }
  }

  return {
    blockId: block.id,
    startedOn,
    todayPlannedId: todayRow.id as string,
    todayWeekIndex: todayRow.week_index as number,
    todayDayIndex: todayRow.day_index as number,
    todayTitle: todayRow.title as string,
    todayMovementId: todayLift.id,
    todayMovementDisplayName: todayLift.displayName,
  };
}

export async function assertBlockStatus(
  admin: AdminClient,
  blockId: string,
  expected: "active" | "completed" | "archived",
): Promise<void> {
  const { data, error } = await admin
    .from("training_blocks")
    .select("status")
    .eq("id", blockId)
    .maybeSingle();
  if (error) throw new Error(`assertBlockStatus: ${error.message}`);
  if (!data) throw new Error(`assertBlockStatus: block ${blockId} not found`);
  if (data.status !== expected) {
    throw new Error(
      `assertBlockStatus: expected '${expected}', got '${data.status}' for block ${blockId}`,
    );
  }
}
