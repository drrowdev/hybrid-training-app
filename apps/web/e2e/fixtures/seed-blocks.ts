import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Direct-DB seed helpers for E2E pre-conditions.
 *
 * The integration-test layer mandated by AGENTS.md (Vitest + real
 * Postgres via testcontainers) isn't wired yet, so we lean on the
 * Supabase service-role client to skip the UI walk for pre-conditions
 * that aren't what the spec is actually testing.
 *
 * Column names mirror the Drizzle schema in packages/db/src/schema —
 * profiles.id (PK = auth.uid()), profiles.onboarded_at,
 * training_blocks.user_id, training_blocks.started_on,
 * training_blocks.weeks, etc.
 */

export type AdminClient = SupabaseClient;

/**
 * Mark `profiles.onboarded_at` so the onboarding gate (see
 * `lib/onboarding/gate.ts`) won't redirect this user to `/onboarding`.
 * The profile row itself is created by the `handle_new_user` trigger in
 * migration 0001 when the auth user is created, so we just update it.
 */
export async function markOnboarded(
  admin: AdminClient,
  userId: string,
): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) {
    throw new Error(`markOnboarded failed: ${error.message}`);
  }
}

/**
 * Seed a training_blocks row so the "Run it again" picker on
 * /plan/new has something to show. Returns the inserted block id.
 *
 * NOTE: we do not seed planned_sessions / completed sessions here —
 * the "Run again" card only requires a block row to render.
 * The follow-up click invokes the createBlock server action, which
 * builds the new block from scratch.
 */
export async function seedRecentBlock(
  admin: AdminClient,
  userId: string,
  opts: {
    archetype?: string;
    daysPerWeek?: number;
    weeks?: number;
    status?: "active" | "completed" | "archived";
    startedOn?: string;
  } = {},
): Promise<string> {
  const startedOn =
    opts.startedOn ??
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("training_blocks")
    .insert({
      user_id: userId,
      archetype: opts.archetype ?? "strength_anchor",
      started_on: startedOn,
      weeks: opts.weeks ?? 4,
      status: opts.status ?? "completed",
      days_per_week: opts.daysPerWeek ?? 4,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedRecentBlock failed: ${error?.message ?? "no row"}`);
  }
  return data.id;
}

/**
 * Seed one or more training_maxes rows so the wizard's TM-gating logic
 * (see `getTrainingMaxContext`) marks the strength archetypes as ready.
 *
 * Strategy: pick the first N movements that have one of the canonical
 * strength slugs, insert a TM per movement. Returns the inserted rows.
 */
export async function seedStrengthTms(
  admin: AdminClient,
  userId: string,
): Promise<void> {
  // Slugs cover the four standard strength-anchor roles
  // (squat / hinge / push / pull). Picking by slug is more resilient
  // than relying on row order.
  const slugs = [
    "back-squat-high-bar",
    "conventional-deadlift",
    "bench-press-flat",
    "ohp-standing",
  ];
  const { data: movements, error: mErr } = await admin
    .from("movements")
    .select("id, slug")
    .in("slug", slugs);
  if (mErr) throw new Error(`seedStrengthTms: fetch movements: ${mErr.message}`);
  if (!movements || movements.length === 0) {
    throw new Error(
      "seedStrengthTms: no canonical strength movements found in catalog",
    );
  }
  const rows = movements.map((m) => ({
    user_id: userId,
    movement_id: m.id,
    one_rm_kg: "100",
  }));
  const { error } = await admin.from("training_maxes").insert(rows);
  if (error) throw new Error(`seedStrengthTms: insert TMs: ${error.message}`);
}
