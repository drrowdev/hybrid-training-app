import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 5 per-movement deep-dive seed.
 *
 * Lays down a strength block with eight Back Squat sessions across the
 * last ~10 weeks, plus a Front Squat → Back Squat swap so the swap
 * card has something to render. The session layout is chosen so:
 *   - the latest session is a clean PR (so the PR badge + red dot test
 *     can assert at least one PR row), and
 *   - at least one Front Squat session also lives in the user's history
 *     so the sister-movements card can surface a non-null peer e1RM.
 */
export type AdminClient = SupabaseClient;

export type SeededMovementHistory = {
  backSquatMovementId: string;
  frontSquatMovementId: string;
  /** Session id of the most recent Back Squat session (used for click-through assertions). */
  latestBackSquatSessionId: string;
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

async function ensureMovement(
  admin: AdminClient,
  slug: string,
  displayName: string,
  opts: {
    pattern: string;
    primaryRegion: string;
    functionalRoles?: string[];
  },
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
      pattern: opts.pattern,
      primary_region: opts.primaryRegion,
      functional_roles: opts.functionalRoles ?? [],
      is_compound: true,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`ensureMovement(${slug}): ${error?.message}`);
  return data.id as string;
}

export async function seedMovementHistory(
  admin: AdminClient,
  userId: string,
): Promise<SeededMovementHistory> {
  // Back Squat is part of the global seed catalog on every dev project;
  // the helper falls back to creating it when missing so the spec is
  // resilient against a partially-seeded test project.
  const backSquatMovementId = await ensureMovement(admin, "back-squat", "Back Squat", {
    pattern: "squat",
    primaryRegion: "lower",
    functionalRoles: ["quad_dominant_squat"],
  });
  const frontSquatMovementId = await ensureMovement(admin, "front-squat", "Front Squat", {
    pattern: "squat",
    primaryRegion: "lower",
    functionalRoles: ["quad_dominant_squat"],
  });

  // Eight Back Squat sessions ramping 100 → 142.5 kg so the most recent
  // session is a strict e1RM PR.
  const schedule: Array<{ daysAgo: number; weight: number; reps: number; rpe: number }> = [
    { daysAgo: 70, weight: 100, reps: 5, rpe: 7 },
    { daysAgo: 63, weight: 102.5, reps: 5, rpe: 7.5 },
    { daysAgo: 56, weight: 105, reps: 5, rpe: 8 },
    { daysAgo: 42, weight: 110, reps: 5, rpe: 8 },
    { daysAgo: 28, weight: 115, reps: 5, rpe: 8.5 },
    { daysAgo: 21, weight: 117.5, reps: 5, rpe: 8.5 },
    { daysAgo: 10, weight: 120, reps: 5, rpe: 9 },
    { daysAgo: 3, weight: 122.5, reps: 5, rpe: 9 },
  ];

  let latestBackSquatSessionId = "";
  for (const s of schedule) {
    const performed = isoDaysAgo(s.daysAgo);
    const { data: sess, error: sErr } = await admin
      .from("sessions")
      .insert({
        user_id: userId,
        performed_at: performed,
        completed_at: performed,
        title: "Squat day",
      })
      .select("id")
      .single();
    if (sErr || !sess) throw new Error(`seed session: ${sErr?.message}`);
    const sessionId = sess.id as string;
    if (s.daysAgo === 3) latestBackSquatSessionId = sessionId;

    const { error: setErr } = await admin.from("set_logs").insert({
      session_id: sessionId,
      movement_id: backSquatMovementId,
      set_index: 1,
      weight_kg: s.weight,
      reps: s.reps,
      rpe: s.rpe,
      set_kind: "main",
    });
    if (setErr) throw new Error(`seed set: ${setErr.message}`);
  }

  // One Front Squat session — gives the sister-movement card a peer
  // with a non-null current e1RM.
  const frontPerformed = isoDaysAgo(14);
  const { data: frontSess, error: fsErr } = await admin
    .from("sessions")
    .insert({
      user_id: userId,
      performed_at: frontPerformed,
      completed_at: frontPerformed,
      title: "Front squat day",
    })
    .select("id")
    .single();
  if (fsErr || !frontSess) throw new Error(`seed front session: ${fsErr?.message}`);
  await admin.from("set_logs").insert({
    session_id: frontSess.id,
    movement_id: frontSquatMovementId,
    set_index: 1,
    weight_kg: 90,
    reps: 5,
    rpe: 8,
    set_kind: "main",
  });

  // Block + a planned session whose prescription records a Front Squat
  // → Back Squat swap so the swap-history card has at least one entry.
  const { data: block, error: bErr } = await admin
    .from("training_blocks")
    .insert({
      user_id: userId,
      archetype: "strength_anchor",
      started_on: new Date(Date.now() - 70 * 86_400_000).toISOString().slice(0, 10),
      weeks: 10,
      status: "active",
      days_per_week: 3,
    })
    .select("id")
    .single();
  if (bErr || !block) throw new Error(`seed block: ${bErr?.message}`);

  await admin.from("planned_sessions").insert({
    block_id: block.id,
    user_id: userId,
    week_index: 9,
    day_index: 0,
    slot: "single",
    title: "Squat day (swap)",
    role: "primary",
    prescription: {
      items: [
        {
          movementId: backSquatMovementId,
          movementSlug: "back-squat",
          movementName: "Back Squat",
          kind: "main",
          sets: 3,
          reps: 5,
          meta: {
            swappedFrom: {
              movementId: frontSquatMovementId,
              movementName: "Front Squat",
            },
            swappedAt: isoDaysAgo(3),
          },
        },
      ],
    },
    completed_session_id: latestBackSquatSessionId,
  });

  return {
    backSquatMovementId,
    frontSquatMovementId,
    latestBackSquatSessionId,
  };
}
