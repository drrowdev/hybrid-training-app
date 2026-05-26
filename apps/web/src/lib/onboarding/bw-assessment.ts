"use server";

/**
 * Bodyweight onboarding assessment — server action.
 *
 * Phase 2 of the bodyweight progression plan. Replaces the Training
 * Maxes step for users whose equipment preset has no loadable
 * main-lift (per `hasLoadableMainLift`). The wizard collects:
 *
 *   - Page 1: rep tests (push-up, pull-up, squat, plank) — each
 *     skippable.
 *   - Page 2: skill chips (12 milestone skills).
 *   - Page 3: hinge-gap acknowledgement (required checkbox).
 *
 * Submit fans those inputs out to per-family `bw_progress` rows via
 * `resolveAllFamilyNodes`, then stamps `profiles.bw_assessment_completed_at`.
 *
 * Re-running the assessment from settings is supported: the upsert
 * is keyed on `(user_id, family)` so the existing accumulators
 * (weeks_at_node / accumulated_tut_seconds) are zeroed on
 * re-calibration — the user explicitly asked to start over.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  BW_SKILL_CHIPS,
  resolveAllFamilyNodes,
  type BwSkillChip,
} from "@/lib/onboarding/bw-mapping";

// ── Public input shape (matches the wizard step) ──────────────────────

export type BwAssessmentInput = {
  /** Strict reps to failure; null = skipped by the user. */
  pushUpMaxReps: number | null;
  /** Strict reps to failure; null counts as 0 strict (per spec). */
  pullUpMaxReps: number | null;
  /** Reps to failure; null = skipped. */
  squatMaxReps: number | null;
  /** Hold seconds; null = skipped. */
  plankHoldSeconds: number | null;
  /** Mastered skill chips (12-chip taxonomy). */
  skillChips: BwSkillChip[];
  /** Page 3 acknowledgement — required to submit. */
  hingeGapAcknowledged: boolean;
};

export type BwAssessmentResult = { ok: true } | { ok: false; error: string };

// ── Validation ────────────────────────────────────────────────────────

/**
 * Per-spec validation: rep counts are non-negative integers ≤ 200,
 * plank seconds ≤ 600. Nullable inputs are passed through (null =
 * skipped). The hinge ack must be true — page 3 is required.
 */
const repCount = z
  .number()
  .int("Rep counts must be whole numbers")
  .min(0, "Rep counts cannot be negative")
  .max(200, "Rep counts cannot exceed 200")
  .nullable();

const plankSeconds = z
  .number()
  .int("Plank seconds must be whole numbers")
  .min(0, "Plank seconds cannot be negative")
  .max(600, "Plank seconds cannot exceed 600")
  .nullable();

const assessmentSchema = z.object({
  pushUpMaxReps: repCount,
  pullUpMaxReps: repCount,
  squatMaxReps: repCount,
  plankHoldSeconds: plankSeconds,
  skillChips: z.array(z.enum(BW_SKILL_CHIPS)),
  hingeGapAcknowledged: z.literal(true, {
    errorMap: () => ({ message: "Hinge-gap acknowledgement is required" }),
  }),
});

// ── Action ────────────────────────────────────────────────────────────

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/**
 * Persist the assessment outcome.
 *
 * Side effects:
 *   1. Resolves rep tests + chips → `(family, nodeKey)` pairs for all
 *      15 families (signal families get the mapping; the rest get
 *      the family-entry node — see `resolveAllFamilyNodes`).
 *   2. Looks up the corresponding `movement_nodes.id` per pair via a
 *      single SELECT.
 *   3. Upserts one row per family into `bw_progress`, zeroing the
 *      accumulators (this is an explicit re-calibration).
 *   4. Stamps `profiles.bw_assessment_completed_at`.
 */
export async function submitBwAssessment(
  input: BwAssessmentInput,
): Promise<BwAssessmentResult> {
  const parsed = assessmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid assessment input",
    };
  }
  const { skillChips, ...reps } = parsed.data;

  const { supabase, user } = await requireUser();

  // Resolve every family. `fromSignal` is kept for telemetry / future
  // analytics but isn't written to the DB — bw_progress doesn't carry
  // a "calibration provenance" column yet.
  const resolved = resolveAllFamilyNodes(reps, skillChips);

  // Look up the catalog node ids in one round-trip. The catalog is
  // global (user_id-less), so the `or` filter shape works under RLS.
  const familyKeyPairs = resolved.map((r) => `${r.family}:${r.nodeKey}`);
  const { data: nodeRows, error: nodeErr } = await supabase
    .from("movement_nodes")
    .select("id, family, node_key")
    .in(
      "family",
      Array.from(new Set(resolved.map((r) => r.family))),
    );
  if (nodeErr) {
    return { ok: false, error: `Node lookup failed: ${nodeErr.message}` };
  }
  const idByFamilyKey = new Map<string, string>(
    (nodeRows ?? []).map((r) => [`${r.family}:${r.node_key}`, r.id as string]),
  );

  const missing = familyKeyPairs.filter((k) => !idByFamilyKey.has(k));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Catalog missing nodes: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`,
    };
  }

  // Upsert one row per family — clears accumulators on re-submission
  // so a re-calibrated user doesn't carry stale TUT against the new
  // (often different) current node.
  const upsertRows = resolved.map(({ family, nodeKey }) => ({
    user_id: user.id,
    family,
    current_node_id: idByFamilyKey.get(`${family}:${nodeKey}`)!,
    accumulated_tut_seconds: 0,
    weeks_at_node: 0,
    clean_rep_history: [],
    updated_at: new Date().toISOString(),
  }));

  const { error: upErr } = await supabase
    .from("bw_progress")
    .upsert(upsertRows, { onConflict: "user_id,family" });
  if (upErr) {
    return { ok: false, error: `bw_progress upsert failed: ${upErr.message}` };
  }

  const { error: profileErr } = await supabase
    .from("profiles")
    .update({ bw_assessment_completed_at: new Date().toISOString() })
    .eq("id", user.id);
  if (profileErr) {
    return { ok: false, error: `Profile stamp failed: ${profileErr.message}` };
  }

  revalidatePath("/app/settings/bodyweight-progression");
  return { ok: true };
}
