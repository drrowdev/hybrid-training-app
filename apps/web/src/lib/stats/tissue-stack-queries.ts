/**
 * DC-O4 weekly tissue-stack deficit check.
 *
 * Reads the current week's prescription items for the active block,
 * counts how many bulletproof roles are satisfied, and reports any gaps.
 * The plan-page card surfaces "tissue-stack-deficient" warnings per
 * docs/design/accessory-schema.md §11.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import {
  BULLETPROOF_ROLES,
  DC_O4_FLOOR,
  FLOOR_PLYOMETRIC_TOTAL,
  type BulletproofRole,
} from "@/lib/planner/accessory-roles";

export type TissueStackGap = {
  role: BulletproofRole;
  required: number;
  actual: number;
  label: string;
};

const ROLE_LABEL: Record<BulletproofRole, string> = {
  heavy_isometric: "Heavy isometric hold",
  hsr: "Heavy slow resistance",
  alfredson_eccentric: "Alfredson eccentric",
  plyometric_low: "Plyometric (low-amplitude)",
  plyometric_high: "Plyometric (high-amplitude)",
  carry: "Loaded carry",
};

export async function getCurrentWeekTissueStackGaps(
  supabase: SupabaseClient,
  userId: string,
): Promise<TissueStackGap[]> {
  const { data: block } = await supabase
    .from("training_blocks")
    .select("id, started_on, weeks")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!block) return [];

  const startedOn = new Date(block.started_on + "T00:00:00");
  const daysSinceStart = Math.floor((Date.now() - startedOn.getTime()) / 86_400_000);
  const weekIndex = Math.max(0, Math.min(block.weeks - 1, Math.floor(daysSinceStart / 7)));

  const { data: sessions } = await supabase
    .from("planned_sessions")
    .select("prescription")
    .eq("block_id", block.id)
    .eq("week_index", weekIndex);

  const counts: Record<BulletproofRole, number> = {
    heavy_isometric: 0,
    hsr: 0,
    alfredson_eccentric: 0,
    plyometric_low: 0,
    plyometric_high: 0,
    carry: 0,
  };

  // Collect movement ids from this week's prescriptions, then look up
  // their role tags.
  const movementIds = new Set<string>();
  for (const s of sessions ?? []) {
    const items = (s.prescription as Prescription | null)?.items ?? [];
    for (const it of items) movementIds.add(it.movementId);
  }
  if (movementIds.size === 0) return [];

  const { data: movs } = await supabase
    .from("movements")
    .select("id, bulletproof_roles")
    .in("id", Array.from(movementIds));
  for (const m of movs ?? []) {
    const roles = (m.bulletproof_roles ?? []) as BulletproofRole[];
    for (const r of roles) counts[r] += 1;
  }

  const gaps: TissueStackGap[] = [];
  for (const role of BULLETPROOF_ROLES) {
    // Plyometric is a single floor slot satisfied by either low or high;
    // we report at most one plyometric gap (under the "low" label).
    if (role === "plyometric_high") continue;
    const required = effectiveTarget(role);
    if (required === 0) continue;
    const actual = effectiveCount(role, counts);
    if (actual >= required) continue;
    gaps.push({ role, required, actual, label: ROLE_LABEL[role] });
  }
  return gaps;
}

function effectiveTarget(role: BulletproofRole): number {
  if (role === "plyometric_low" || role === "plyometric_high") {
    return FLOOR_PLYOMETRIC_TOTAL;
  }
  return DC_O4_FLOOR[role];
}

function effectiveCount(role: BulletproofRole, counts: Record<BulletproofRole, number>): number {
  if (role === "plyometric_low" || role === "plyometric_high") {
    return counts.plyometric_low + counts.plyometric_high;
  }
  return counts[role];
}
