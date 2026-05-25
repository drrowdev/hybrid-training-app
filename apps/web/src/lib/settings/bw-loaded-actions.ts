"use server";

/**
 * Settings → Bodyweight progression: loaded-BW server actions.
 *
 * Phase 7. The settings page lists the user's loaded BW families
 * (those whose current node returns a positive `bwMultiplier`) with
 * a per-family "Suggested next" line driven by `suggestLoadOrVariant`.
 * Tapping "Apply suggestion" calls one of:
 *
 *   - `applyLoadIncrement` — bumps `bw_progress.target_external_load_kg`
 *     by the suggested delta. The planner reads this column on the
 *     next session-generate and surfaces it as the new starting load.
 *   - `applyVariantAdvance` — moves `bw_progress.current_node_id` to
 *     the variant the engine recommends. Also clears the
 *     `target_external_load_kg` since the new node starts fresh.
 *
 * Both actions revalidate the settings page so the UI reflects the
 * new state without a hard reload. RLS-scoped — all reads/writes go
 * through the user's auth context via the standard `createClient()`.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MovementFamily } from "@hta/db";
import { createClient } from "@/lib/supabase/server";

const familyEnum = z.enum([
  "push_h",
  "push_v",
  "pull_h",
  "pull_v",
  "squat_unilateral",
  "squat_bilateral",
  "hinge",
  "core_anti_flexion",
  "core_anti_rotation",
  "planche",
  "lever_front",
  "lever_back",
  "muscle_up",
  "handstand",
  "human_flag",
]) satisfies z.ZodType<MovementFamily>;

const loadSchema = z.object({
  family: familyEnum,
  deltaKg: z.coerce.number().min(-50).max(50),
});

const variantSchema = z.object({
  family: familyEnum,
  toNodeId: z.string().uuid(),
});

export async function applyLoadIncrement(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const parsed = loadSchema.safeParse({
    family: formData.get("family"),
    deltaKg: formData.get("deltaKg"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: row } = await supabase
    .from("bw_progress")
    .select("target_external_load_kg")
    .eq("user_id", user.id)
    .eq("family", parsed.data.family)
    .maybeSingle();
  const current = Number(row?.target_external_load_kg ?? 0);
  const next = Math.max(0, current + parsed.data.deltaKg);

  const { error } = await supabase
    .from("bw_progress")
    .update({
      target_external_load_kg: next,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("family", parsed.data.family);
  if (error) return { error: error.message };

  revalidatePath("/app/settings/bodyweight-progression");
  return { ok: true };
}

export async function applyVariantAdvance(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const parsed = variantSchema.safeParse({
    family: formData.get("family"),
    toNodeId: formData.get("toNodeId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Read the current node id first so we can write a clean audit row.
  const { data: row } = await supabase
    .from("bw_progress")
    .select("current_node_id, target_external_load_kg")
    .eq("user_id", user.id)
    .eq("family", parsed.data.family)
    .maybeSingle();
  if (!row?.current_node_id) {
    return { error: "No progress row to advance." };
  }

  const { error: upErr } = await supabase
    .from("bw_progress")
    .update({
      current_node_id: parsed.data.toNodeId,
      target_external_load_kg: null,
      weeks_at_node: 0,
      accumulated_tut_seconds: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("family", parsed.data.family);
  if (upErr) return { error: upErr.message };

  await supabase.from("bw_progression_events").insert({
    user_id: user.id,
    family: parsed.data.family,
    from_node_id: row.current_node_id,
    to_node_id: parsed.data.toNodeId,
    reason: "manual_loaded_advance",
    load_kg_at_advance: row.target_external_load_kg ?? null,
  });

  revalidatePath("/app/settings/bodyweight-progression");
  return { ok: true };
}
