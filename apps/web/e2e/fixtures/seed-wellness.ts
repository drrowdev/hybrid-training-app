import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 3 wellness seed helpers.
 *
 * `seedWellnessHistory` upserts daily check-in rows (bodyweight_kg,
 * sleep_hours, motivation) into `public.wellness` for the last N days.
 *
 * `seedSessionWellness` inserts `sessions` rows carrying pre-check-in
 * fatigue/soreness (DC-P1) and post-session sRPE (DC-A2) — these back
 * the prediction-accuracy scatter. The synthetic correlation is
 * monotonic-noisy so it lands in the "strong" band (~0.7-0.85)
 * deterministically.
 */
export type AdminClient = SupabaseClient;

export async function seedWellnessHistory(
  admin: AdminClient,
  userId: string,
  days: number,
): Promise<void> {
  const today = new Date();
  const rows: Array<{
    user_id: string;
    date: string;
    bodyweight_kg: number;
    sleep_hours: number;
    motivation: number;
  }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    // Bodyweight: linear drift + small sine wiggle.
    const bw = 82.0 + (days - 1 - i) * 0.05 + Math.sin(i / 3) * 0.4;
    // Sleep: oscillates between 6.5 and 8.5h.
    const sleep = 7.5 + Math.sin(i / 2) * 1.0;
    // Motivation: 3..5 range.
    const motivation = 3 + ((i % 3) === 0 ? 2 : i % 2);
    rows.push({
      user_id: userId,
      date,
      bodyweight_kg: Math.round(bw * 10) / 10,
      sleep_hours: Math.round(sleep * 10) / 10,
      motivation,
    });
  }
  const { error } = await admin
    .from("wellness")
    .upsert(rows, { onConflict: "user_id,date" });
  if (error) throw new Error(`seedWellnessHistory: ${error.message}`);
}

export async function seedSessionWellness(
  admin: AdminClient,
  userId: string,
  count: number,
): Promise<void> {
  const rows: Array<{
    user_id: string;
    performed_at: string;
    completed_at: string;
    title: string;
    fatigue: number;
    soreness: number;
    session_rpe: number;
  }> = [];
  for (let i = 0; i < count; i++) {
    // Spread sessions over the last `count` days, one per day.
    const performed = new Date(Date.now() - (count - i) * 86_400_000);
    // Pre-score in [2..10] cycling; rpe correlates strongly but noisy.
    const pre = 2 + (i % 8);
    const rpe = Math.max(
      1,
      Math.min(10, pre - 1 + ((i % 3) === 0 ? 1 : 0) + (i % 2 === 0 ? -0.5 : 0.5)),
    );
    // Split fatigue + soreness so they sum to pre (both within 1..5).
    const fatigue = Math.max(1, Math.min(5, Math.round(pre / 2)));
    const soreness = Math.max(1, Math.min(5, pre - fatigue));
    rows.push({
      user_id: userId,
      performed_at: performed.toISOString(),
      completed_at: performed.toISOString(),
      title: `Seeded session ${i + 1}`,
      fatigue,
      soreness,
      session_rpe: Math.round(rpe * 10) / 10,
    });
  }
  const { error } = await admin.from("sessions").insert(rows);
  if (error) throw new Error(`seedSessionWellness: ${error.message}`);
}
