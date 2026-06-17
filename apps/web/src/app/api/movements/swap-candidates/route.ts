import { NextResponse, type NextRequest } from "next/server";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  rankSwapCandidates,
  type SwapMovementFields,
} from "@/lib/sessions/swap-ranking";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import {
  resolveRequiredEquipment,
  isEquipmentAvailable,
} from "@/lib/planner/equipment-requirements";

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

  // Candidate pool = the same movement-pattern bucket UNION any movement that
  // shares a primary muscle with the original. The pattern bucket gives true
  // like-for-like (e.g. another horizontal press for a bench press); the
  // primary-muscle union surfaces same-target work the pattern misses — e.g.
  // swapping Close-Grip Bench (a "press") should also offer triceps isolation,
  // which lives in the "isolation" pattern. We fetch both, dedupe by id, then let
  // the ranker order by similarity so the closest matches still lead. Each query
  // is bounded; truncating before ranking would hand the ranker an arbitrary
  // subset and drop genuinely-similar alternatives.
  const origMuscles = ((orig.primary_muscles as string[] | null) ?? []).filter(
    (m): m is string => typeof m === "string" && m.length > 0,
  );
  const [byPattern, byMuscle] = await Promise.all([
    supabase
      .from("movements")
      .select(MOVEMENT_FIELDS)
      .eq("pattern", orig.pattern as string)
      .neq("id", originalId)
      .limit(500),
    origMuscles.length > 0
      ? supabase
          .from("movements")
          .select(MOVEMENT_FIELDS)
          .overlaps("primary_muscles", origMuscles)
          .neq("id", originalId)
          .limit(500)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  if (byPattern.error) return NextResponse.json({ error: byPattern.error.message }, { status: 500 });
  if (byMuscle.error) return NextResponse.json({ error: byMuscle.error.message }, { status: 500 });

  const byId = new Map<string, SwapMovementFields>();
  for (const m of [
    ...((byPattern.data ?? []) as unknown as SwapMovementFields[]),
    ...((byMuscle.data ?? []) as unknown as SwapMovementFields[]),
  ]) {
    if (!byId.has(m.id)) byId.set(m.id, m);
  }

  // Filter to alternatives the user can actually load with their equipment — a
  // swap menu that suggests a leg-press machine to someone training at home is
  // noise. Read the signed-in user's equipment profile; if it can't be resolved,
  // or filtering would empty the list, fall back to the unfiltered pool so the
  // picker is never blank.
  let pool = Array.from(byId.values());
  const {
    data: { user },
  } = await getAuthUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("equipment, barbell_kg, trap_bar_kg, plate_inventory_kg")
      .eq("id", user.id)
      .maybeSingle();
    const equipment = resolveEquipment(profile);
    const available = pool.filter((m) =>
      isEquipmentAvailable(
        resolveRequiredEquipment({ slug: m.slug, equipment: m.equipment }),
        equipment,
      ),
    );
    if (available.length > 0) pool = available;
  }

  const ranked = rankSwapCandidates(
    orig as unknown as SwapMovementFields,
    pool,
  ).slice(0, limit);

  return NextResponse.json({
    pattern: orig.pattern,
    movements: ranked,
  });
}
