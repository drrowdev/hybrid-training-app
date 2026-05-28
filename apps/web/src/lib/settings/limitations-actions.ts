/**
 * Profile-level "Active limitations" toggle — server actions.
 *
 * This is the set-and-forget surface used by /app/settings/limitations
 * to declare:
 *   1. Which of the seven engine regions are currently fully blocked.
 *   2. Whether a tendinopathy / tendon irritation is currently active.
 *
 * Both flags are read on every block generation via
 * `readLimitationsContext` in `@/lib/planner/limitations-context`.
 *
 * ─── Storage model ────────────────────────────────────────────────
 *
 * We reuse the existing `limitations` table. The richer
 * /app/recovery/injuries flow already writes rows with custom `kind`,
 * `affected_muscles`, etc. To keep the toggle UI idempotent and
 * non-destructive, the toggle writes sentinel rows tagged with a
 * predictable `kind`:
 *
 *   Region toggle ON   → INSERT { region, kind: KIND_REGION_TOGGLE, severity: 'moderate' }
 *   Region toggle OFF  → UPDATE resolved_at = now() WHERE kind = KIND_REGION_TOGGLE AND region = X
 *   Tendinopathy ON    → INSERT { region: null, kind: KIND_TENDINOPATHY, severity: 'moderate' }
 *   Tendinopathy OFF   → UPDATE resolved_at = now() WHERE kind = KIND_TENDINOPATHY
 *
 * Rich rows (kind set by the user) are never modified by this action
 * — they stay owned by the /app/recovery/injuries flow. The planner
 * detects tendinopathy via /tendin/i over `kind` regardless of source,
 * so a free-text "Patellar tendinitis" row still activates the flag
 * even when the toggle is off.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  KIND_REGION_TOGGLE,
  KIND_TENDINOPATHY,
  REGIONS,
  type Region,
  type UpdateLimitationsInput,
  type UpdateLimitationsResult,
} from "./limitations-constants";

const updateSchema = z.object({
  blockedRegions: z.array(z.enum(REGIONS)),
  tendinopathyActive: z.boolean(),
});

type ActiveSentinelRow = {
  id: string;
  region: string | null;
  kind: string | null;
};

/**
 * Diff the user's current sentinel rows against the requested state
 * and apply the minimum set of inserts / updates. Idempotent — calling
 * twice with the same input is a no-op on the second call.
 *
 * Only touches sentinel rows (`kind` exactly KIND_REGION_TOGGLE or
 * KIND_TENDINOPATHY). Rich rows from /app/recovery/injuries stay
 * untouched.
 */
export async function updateLimitations(
  input: UpdateLimitationsInput,
): Promise<UpdateLimitationsResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: existing, error: readErr } = await supabase
    .from("limitations")
    .select("id, region, kind")
    .eq("user_id", user.id)
    .is("resolved_at", null)
    .in("kind", [KIND_REGION_TOGGLE, KIND_TENDINOPATHY]);

  if (readErr) return { ok: false, error: readErr.message };

  const rows = (existing ?? []) as ActiveSentinelRow[];
  const want = new Set<Region>(parsed.data.blockedRegions);
  const haveRegions = new Map<string, string>(); // region → row id
  const tendinopathyRows: string[] = [];
  for (const r of rows) {
    if (r.kind === KIND_TENDINOPATHY) {
      tendinopathyRows.push(r.id);
    } else if (r.kind === KIND_REGION_TOGGLE && r.region) {
      // Keep the first; if duplicates exist (legacy), collapse them.
      if (!haveRegions.has(r.region)) haveRegions.set(r.region, r.id);
      else tendinopathyRows.push(r.id); // reuse the "to resolve" path
    }
  }

  const toInsert: Array<{
    user_id: string;
    region: Region | null;
    kind: string;
    severity: "moderate";
  }> = [];
  const toResolve: string[] = [];

  for (const region of want) {
    if (!haveRegions.has(region)) {
      toInsert.push({
        user_id: user.id,
        region,
        kind: KIND_REGION_TOGGLE,
        severity: "moderate",
      });
    }
  }
  for (const [region, id] of haveRegions) {
    if (!want.has(region as Region)) toResolve.push(id);
  }

  if (parsed.data.tendinopathyActive) {
    if (tendinopathyRows.length === 0) {
      toInsert.push({
        user_id: user.id,
        region: null,
        kind: KIND_TENDINOPATHY,
        severity: "moderate",
      });
    }
    // If multiple exist (legacy), leave them — they're all active.
  } else {
    for (const id of tendinopathyRows) toResolve.push(id);
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("limitations").insert(toInsert);
    if (error) return { ok: false, error: error.message };
  }
  if (toResolve.length > 0) {
    const { error } = await supabase
      .from("limitations")
      .update({ resolved_at: new Date().toISOString() })
      .in("id", toResolve);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/app");
  revalidatePath("/app/settings/limitations");
  return { ok: true };
}
