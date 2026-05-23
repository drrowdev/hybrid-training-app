import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 4 adherence seed.
 *
 * Lays down two blocks with 8 weeks of planned sessions split across
 * two archetypes (so the per-archetype card has > 1 row), with two
 * skipped sessions and a logged streak that the e2e spec can assert
 * against.
 *
 * Returned counts let the spec verify the streak number directly,
 * without re-deriving the expected value from the fixture math.
 */
export type AdminClient = SupabaseClient;

export type SeededAdherence = {
  primaryBlockId: string;
  secondaryBlockId: string;
  totalPlanned: number;
  totalLogged: number;
  totalSkipped: number;
  expectedLongestStreakMin: number;
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

export async function seedAdherenceHistory(
  admin: AdminClient,
  userId: string,
): Promise<SeededAdherence> {
  // Primary block — 8 weeks of strength_anchor, started 8 weeks (56 days) ago.
  const primaryStart = ymdDaysAgo(56);
  const { data: b1, error: e1 } = await admin
    .from("training_blocks")
    .insert({
      user_id: userId,
      archetype: "strength_anchor",
      started_on: primaryStart,
      weeks: 8,
      status: "active",
      days_per_week: 3,
    })
    .select("id")
    .single();
  if (e1 || !b1) throw new Error(`seedAdherenceHistory primary: ${e1?.message}`);
  const primaryBlockId = b1.id as string;

  // Secondary block — overlapping 4-week hypertrophy block so the
  // per-archetype card has two rows. Started 28 days ago.
  const secondaryStart = ymdDaysAgo(28);
  const { data: b2, error: e2 } = await admin
    .from("training_blocks")
    .insert({
      user_id: userId,
      archetype: "hypertrophy_anchor",
      started_on: secondaryStart,
      weeks: 4,
      status: "active",
      days_per_week: 3,
    })
    .select("id")
    .single();
  if (e2 || !b2) throw new Error(`seedAdherenceHistory secondary: ${e2?.message}`);
  const secondaryBlockId = b2.id as string;

  // Helper — insert a sessions row first when we want a logged planned.
  async function insertSession(daysAgo: number, title: string): Promise<string> {
    const performed = isoDaysAgo(daysAgo);
    const { data, error } = await admin
      .from("sessions")
      .insert({
        user_id: userId,
        performed_at: performed,
        completed_at: performed,
        title,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insertSession: ${error?.message}`);
    return data.id as string;
  }

  type PlannedInput = {
    block_id: string;
    user_id: string;
    week_index: number;
    day_index: number;
    slot: "single";
    title: string;
    role: string;
    prescription: { items: [] };
    completed_session_id: string | null;
    skipped_at: string | null;
  };

  const planned: PlannedInput[] = [];

  // Primary block: 8 weeks × 3 days (Mon/Wed/Fri). Logging pattern:
  //   weeks 0..5: every Mon/Wed/Fri logged
  //   week 6: Mon logged, Wed skipped, Fri logged
  //   week 7 (current week): Mon logged, Wed skipped (skip #2), Fri future
  for (let w = 0; w < 8; w++) {
    for (const d of [0, 2, 4]) {
      const sessionDaysAgo = 56 - (w * 7 + d);
      let completed: string | null = null;
      let skipped: string | null = null;
      const isFuture = sessionDaysAgo < 0;
      const isToday = sessionDaysAgo === 0;
      if (isFuture) {
        // leave both null — planner future row
      } else if (w === 6 && d === 2) {
        skipped = isoDaysAgo(sessionDaysAgo);
      } else if (w === 7 && d === 2) {
        skipped = isoDaysAgo(sessionDaysAgo);
      } else if (!isToday) {
        completed = await insertSession(sessionDaysAgo, `Strength block w${w}d${d}`);
      } else {
        // today: leave pending so the streak grace-period test stays
        // deterministic.
      }
      planned.push({
        block_id: primaryBlockId,
        user_id: userId,
        week_index: w,
        day_index: d,
        slot: "single",
        title: `Strength session w${w + 1}`,
        role: "primary",
        prescription: { items: [] },
        completed_session_id: completed,
        skipped_at: skipped,
      });
    }
  }

  // Secondary block: 4 weeks × 3 days (Tue/Thu/Sat = day idx 1/3/5).
  // All logged for simplicity — exercises the second archetype row.
  for (let w = 0; w < 4; w++) {
    for (const d of [1, 3, 5]) {
      const sessionDaysAgo = 28 - (w * 7 + d);
      let completed: string | null = null;
      if (sessionDaysAgo >= 1) {
        completed = await insertSession(sessionDaysAgo, `Hypertrophy w${w}d${d}`);
      }
      planned.push({
        block_id: secondaryBlockId,
        user_id: userId,
        week_index: w,
        day_index: d,
        slot: "single",
        title: `Hypertrophy session w${w + 1}`,
        role: "accessory",
        prescription: { items: [] },
        completed_session_id: completed,
        skipped_at: null,
      });
    }
  }

  const { error: pErr } = await admin.from("planned_sessions").insert(planned);
  if (pErr) throw new Error(`seedAdherenceHistory planned: ${pErr.message}`);

  const totalPlanned = planned.length;
  const totalLogged = planned.filter((p) => p.completed_session_id).length;
  const totalSkipped = planned.filter((p) => p.skipped_at).length;

  return {
    primaryBlockId,
    secondaryBlockId,
    totalPlanned,
    totalLogged,
    totalSkipped,
    // The seeded run from week 0 through week 6 Tue spans at least 45
    // days without a skip. We give the spec a conservative lower bound
    // so day-of-week phasing relative to "today" doesn't flake.
    expectedLongestStreakMin: 30,
  };
}
