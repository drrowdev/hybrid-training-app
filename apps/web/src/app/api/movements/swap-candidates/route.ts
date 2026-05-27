import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/movements/swap-candidates?originalId=<uuid>&limit=25
 *
 * Phase 2 A1 — returns role-compatible alternatives for the given
 * movement, used by the mid-workout swap menu. "Compatible" today
 * means: same ``pattern`` value (squat / hinge / press / pull /
 * isolation / cardio_run / cardio_bike / ...). Excludes the original
 * itself.
 *
 * For accessory swaps the pattern alone is a coarse filter — the UI
 * keeps the original sets/reps so the user picks whatever feels right
 * within the same pattern bucket. The accessory picker's role-tag
 * filtering (``bulletproof_roles`` / ``functional_roles``) is more
 * granular but isn't required for "give me an alternative now".
 */
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

  // Resolve the original movement's pattern. Catalog reads are RLS-open.
  const { data: orig, error: oErr } = await supabase
    .from("movements")
    .select("id, pattern, is_supported")
    .eq("id", originalId)
    .maybeSingle();
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
  if (!orig) return NextResponse.json({ error: "Movement not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("movements")
    .select(
      "id, slug, display_name, pattern, primary_region, primary_muscles, equipment, is_compound, is_supported, stability, metadata",
    )
    .eq("pattern", orig.pattern as string)
    .neq("id", originalId)
    .order("display_name", { ascending: true })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    pattern: orig.pattern,
    movements: data ?? [],
  });
}
