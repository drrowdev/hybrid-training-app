"use server";

/**
 * Manual node selection for bodyweight progression.
 *
 * Powers the "edit nodes directly" UI on /app/settings/bodyweight-
 * progression. The engine's automated progression continues to run via
 * `applyBwSessionCompletionSideEffects` — this action is the user-
 * facing override for when their real-world capability disagrees with
 * what the gate-state says.
 *
 * Validations applied:
 *   - Node exists in the catalog and matches the requested family.
 *   - Prerequisite gate: every `prerequisites[]` of the target node
 *     must resolve to either (a) the user's current node, or (b) a
 *     node strictly easier than current (lower `difficulty_anchor`).
 *     `allowSkipPrereqs === true` bypasses this for users who self-
 *     assess as further advanced than the DAG suggests.
 *   - Downgrade guard: moving to a node with a strictly lower
 *     `difficulty_anchor` than the current one requires
 *     `allowDowngrade === true`. This is the safety prompt for the
 *     "are you sure?" confirm-button swap.
 *
 * Side effects on success:
 *   - Upserts `bw_progress` for `(user_id, family)` with the new node
 *     and zeroed accumulators (`accumulated_tut_seconds = 0`,
 *     `weeks_at_node = 0`, `clean_rep_history = []`).
 *   - Inserts a `bw_progression_events` row with `reason = 'manual_set'`
 *     when there was a previous current node to audit from. New-seed
 *     paths skip the audit row (the schema requires NOT NULL on
 *     `from_node_id` — there is no prior node to point at).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MovementFamily } from "@hta/db";
import { createClient, getAuthUser } from "@/lib/supabase/server";

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

const inputSchema = z.object({
  family: familyEnum,
  nodeId: z.string().uuid("nodeId must be a UUID"),
  allowDowngrade: z.boolean().optional(),
  allowSkipPrereqs: z.boolean().optional(),
});

export type SetBwNodeManualInput = z.infer<typeof inputSchema>;
export type SetBwNodeManualResult = { ok: true } | { ok: false; error: string };

type CatalogRow = {
  id: string;
  family: MovementFamily;
  prerequisites: string[];
  difficulty_anchor: number;
};

export async function setBwNodeManual(
  input: SetBwNodeManualInput,
): Promise<SetBwNodeManualResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { family, nodeId } = parsed.data;
  const allowDowngrade = parsed.data.allowDowngrade === true;
  const allowSkipPrereqs = parsed.data.allowSkipPrereqs === true;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Fetch the full family catalog in one round-trip. We need it for
  // the prereq + downgrade checks below.
  const { data: catalogRows, error: catalogErr } = await supabase
    .from("movement_nodes")
    .select("id, family, prerequisites, difficulty_anchor")
    .eq("family", family);
  if (catalogErr) {
    return { ok: false, error: `Catalog lookup failed: ${catalogErr.message}` };
  }
  const catalog: CatalogRow[] = (catalogRows ?? []) as CatalogRow[];
  const target = catalog.find((n) => n.id === nodeId);
  if (!target) {
    return { ok: false, error: "Node not found for that family." };
  }

  const { data: progressRow } = await supabase
    .from("bw_progress")
    .select("current_node_id")
    .eq("user_id", user.id)
    .eq("family", family)
    .maybeSingle();
  const currentId = (progressRow?.current_node_id ?? null) as string | null;
  const currentNode = currentId
    ? catalog.find((n) => n.id === currentId) ?? null
    : null;

  // Downgrade check — only meaningful when there's a prior node.
  if (
    currentNode &&
    target.difficulty_anchor < currentNode.difficulty_anchor &&
    !allowDowngrade
  ) {
    return {
      ok: false,
      error: "Downgrade requires explicit confirmation.",
    };
  }

  // Prereq check — every listed prereq must be either the current node
  // or strictly easier than it. New users (no current node) must have
  // an empty prereq list unless they opt to skip.
  if (!allowSkipPrereqs) {
    const prereqIds = target.prerequisites ?? [];
    if (prereqIds.length > 0) {
      const currentAnchor = currentNode?.difficulty_anchor ?? -Infinity;
      const satisfied = prereqIds.every((pid) => {
        if (currentNode && pid === currentNode.id) return true;
        const p = catalog.find((n) => n.id === pid);
        if (!p) return false;
        return p.difficulty_anchor <= currentAnchor;
      });
      if (!satisfied) {
        return {
          ok: false,
          error: "Prerequisites not satisfied for that node.",
        };
      }
    }
  }

  const upsert = {
    user_id: user.id,
    family,
    current_node_id: nodeId,
    accumulated_tut_seconds: 0,
    weeks_at_node: 0,
    clean_rep_history: [],
    updated_at: new Date().toISOString(),
  };

  const { error: upErr } = await supabase
    .from("bw_progress")
    .upsert(upsert, { onConflict: "user_id,family" });
  if (upErr) {
    return { ok: false, error: `bw_progress upsert failed: ${upErr.message}` };
  }

  // Audit row — only when we have a `from_node_id` to point at. The
  // table schema marks it NOT NULL, so brand-new seeds skip the event.
  if (currentId && currentId !== nodeId) {
    await supabase.from("bw_progression_events").insert({
      user_id: user.id,
      family,
      from_node_id: currentId,
      to_node_id: nodeId,
      reason: "manual_set",
    });
  }

  revalidatePath("/app/settings/bodyweight-progression");
  return { ok: true };
}
