import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 6 engine-page seed.
 *
 * Lays down everything the /app/stats/engine spec needs to assert on
 * non-trivial data:
 *
 *   - An active Strength Focus block starting today (so we land in week
 *     0 and the decision-trace card has a current week index).
 *   - A planned session for today titled "Squat day" referencing Back
 *     Squat as the main item (so the headline contains the seeded
 *     movement name).
 *   - A completed Back Squat session 2 days ago that contributed to
 *     region freshness via region_state (we write region_state directly
 *     so the spec doesn't have to wait on the materialiser).
 *   - One historical skipped planned-session row (so the recent
 *     overrides card has a non-empty list).
 *   - A movement swap recorded in a different planned session
 *     (`prescription.items[].meta.swappedFrom`) — the second override.
 */
export type AdminClient = SupabaseClient;

export type SeededEngine = {
  blockId: string;
  archetypeName: string;
  todayPlannedTitle: string;
};

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

async function ensureMovement(
  admin: AdminClient,
  slug: string,
  displayName: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("movements")
    .select("id")
    .eq("slug", slug)
    .is("user_id", null)
    .maybeSingle();
  if (existing) return existing.id as string;
  const { data, error } = await admin
    .from("movements")
    .insert({
      slug,
      display_name: displayName,
      pattern: "squat",
      primary_region: "knee",
      functional_roles: ["quad_dominant_squat"],
      is_compound: true,
      axial_load: "high",
      high_strain_tendon: false,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`ensureMovement(${slug}): ${error?.message}`);
  return data.id as string;
}

export async function seedEngineState(
  admin: AdminClient,
  userId: string,
): Promise<SeededEngine> {
  const backSquatId = await ensureMovement(admin, "back-squat", "Back Squat");
  const frontSquatId = await ensureMovement(admin, "front-squat", "Front Squat");

  // Block started today so we're in week 0 day 0.
  const startedOn = ymdDaysAgo(0);
  const { data: block, error: bErr } = await admin
    .from("training_blocks")
    .insert({
      user_id: userId,
      archetype: "strength_anchor",
      started_on: startedOn,
      weeks: 4,
      status: "active",
      days_per_week: 3,
    })
    .select("id")
    .single();
  if (bErr || !block) throw new Error(`seedEngineState block: ${bErr?.message}`);
  const blockId = block.id as string;

  // Today's planned session — day_index matches today's ISO weekday so
  // the page's lookup finds it.
  const today = new Date();
  const isoWeekday = (today.getUTCDay() + 6) % 7;
  await admin.from("planned_sessions").insert({
    block_id: blockId,
    user_id: userId,
    week_index: 0,
    day_index: isoWeekday,
    slot: "single",
    title: "Squat day",
    role: "primary",
    prescription: {
      items: [
        {
          movementId: backSquatId,
          movementSlug: "back-squat",
          movementName: "Back Squat",
          kind: "main",
          sets: 3,
          reps: 5,
        },
      ],
    },
  });

  // Historical session — drives region freshness via region_state, and
  // the recent-overrides card via a swap on its planned row.
  const performedAt = isoDaysAgo(2);
  const { data: hist, error: hErr } = await admin
    .from("sessions")
    .insert({
      user_id: userId,
      performed_at: performedAt,
      completed_at: performedAt,
      title: "Front squat day (swap)",
    })
    .select("id")
    .single();
  if (hErr || !hist) throw new Error(`seedEngineState session: ${hErr?.message}`);
  await admin.from("set_logs").insert({
    session_id: hist.id,
    movement_id: backSquatId,
    set_index: 1,
    weight_kg: 110,
    reps: 5,
    rpe: 8,
    set_kind: "main",
  });

  // Recorded movement swap (Front Squat → Back Squat). Lives in the
  // prescription JSONB on a planned_sessions row.
  await admin.from("planned_sessions").insert({
    block_id: blockId,
    user_id: userId,
    week_index: 0,
    day_index: (isoWeekday + 6) % 7, // a different weekday so the unique-key holds
    slot: "single",
    title: "Front squat day (swap)",
    role: "primary",
    prescription: {
      items: [
        {
          movementId: backSquatId,
          movementSlug: "back-squat",
          movementName: "Back Squat",
          kind: "main",
          sets: 3,
          reps: 5,
          meta: {
            swappedFrom: {
              movementId: frontSquatId,
              movementName: "Front Squat",
            },
            swappedAt: isoDaysAgo(2),
          },
        },
      ],
    },
    completed_session_id: hist.id,
  });

  // Skipped planned session — drives the override card's first row.
  const skippedAt = isoDaysAgo(1);
  const { data: skippedPs } = await admin
    .from("planned_sessions")
    .insert({
      block_id: blockId,
      user_id: userId,
      week_index: 0,
      day_index: (isoWeekday + 5) % 7,
      slot: "single",
      title: "Bench day (skipped)",
      role: "primary",
      prescription: { items: [] },
      skipped_at: skippedAt,
    })
    .select("id")
    .single();

  // Override audit log rows (migration 0028). These power Section F.
  if (skippedPs) {
    await admin.from("engine_override_events").insert({
      user_id: userId,
      occurred_at: skippedAt,
      event_type: "skip",
      planned_session_id: skippedPs.id,
      block_id: blockId,
      context: {
        archetype: "strength_anchor",
        weekIndex: 0,
        dayIndex: (isoWeekday + 5) % 7,
      },
    });
  }
  await admin.from("engine_override_events").insert({
    user_id: userId,
    occurred_at: isoDaysAgo(2),
    event_type: "swap",
    block_id: blockId,
    original_movement_slug: "front-squat",
    new_movement_slug: "back-squat",
    reason: "Bar busy in the rack",
    context: {
      archetype: "strength_anchor",
      weekIndex: 0,
      dayIndex: (isoWeekday + 6) % 7,
    },
  });

  // Write region_state directly so the freshness card has non-trivial
  // data without running the materialiser end-to-end.
  await admin.from("region_state").upsert(
    [
      {
        user_id: userId,
        region: "knee",
        atl: 3.5,
        ctl: 5.0,
        baseline_tolerance: 5.0,
        last_load_date: ymdDaysAgo(2),
        updated_at: new Date().toISOString(),
      },
      {
        user_id: userId,
        region: "shoulder_scapular",
        atl: 1.0,
        ctl: 4.0,
        baseline_tolerance: 4.0,
        last_load_date: ymdDaysAgo(7),
        updated_at: new Date().toISOString(),
      },
    ],
    { onConflict: "user_id,region" },
  );

  return {
    blockId,
    archetypeName: "Strength Focus",
    todayPlannedTitle: "Squat day",
  };
}
