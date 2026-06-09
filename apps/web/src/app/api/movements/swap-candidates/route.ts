import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  rankSwapCandidates,
  type SwapMovementFields,
} from "@/lib/sessions/swap-ranking";

/**
 * GET /api/movements/swap-candidates?originalId=<uuid>&limit=25
 *
 * Phase 2 A1 — returns role-compatible alternatives for the given
 * movement, used by the mid-workout swap menu. "Compatible" today
 * means: same ``pattern`` value (squat / hinge / press / pull /
 * isolation / cardio_run / cardio_bike / ...). Excludes the original
 * itself.
 *
 * The list is RANKED by similarity to the original (shared target muscles,
 * role, region) so the closest alternatives lead and the top few are flagged
 * `recommended` — instead of an unhelpful alphabetical dump of the whole pattern
 * bucket. See `lib/sessions/swap-ranking.ts`.
 */
const MOVEMENT_FIELDS =
  "id, slug, display_name, pattern, primary_region, primary_muscles, secondary_muscles, functional_roles, bulletproof_roles, equipment, is_compound, is_supported, stability, metadata";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const url = new URL(request.url);
  const originalId = url.searchParams.get("originalId");
  const limit = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("limit") ?? "25")),
  );
  if (!originalId) {
    return NextResponse.json({ error: "originalId is required" }, { status: 400 });
  }

  // Resolve the original movement (incl. the fields the ranker compares on).
  // Catalog reads are RLS-open.
  const { data: orig, error: oErr } = await supabase
    .from("movements")
    .select(MOVEMENT_FIELDS)
    .eq("id", originalId)
    .maybeSingle();
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
  if (!orig) return NextResponse.json({ error: "Movement not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("movements")
    .select(MOVEMENT_FIELDS)
    .eq("pattern", orig.pattern as string)
    .neq("id", originalId)
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ranked = rankSwapCandidates(
    orig as unknown as SwapMovementFields,
    (data ?? []) as unknown as SwapMovementFields[],
  );

  return NextResponse.json({
    pattern: orig.pattern,
    movements: ranked,
  });
}
