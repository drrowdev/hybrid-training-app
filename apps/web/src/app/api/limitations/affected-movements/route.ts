import { NextResponse, type NextRequest } from "next/server";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getAffectedMovements } from "@/lib/limitations/affected-movements";
import { ALL_MUSCLE_GROUPS } from "@/lib/muscle/muscle-groups";

/**
 * POST /api/limitations/affected-movements
 * Body: { affectedMuscles: string[], affectedRegion: string | null }
 *
 * Backs the "Engine will block" preview inside AddLimitationModal.
 * POST (not GET) so a long muscle list doesn't bloat the URL.
 */
const MUSCLE_SET = new Set<string>(ALL_MUSCLE_GROUPS);

export async function POST(request: NextRequest) {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { affectedMuscles?: unknown; affectedRegion?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const muscles = Array.isArray(body.affectedMuscles)
    ? body.affectedMuscles.filter(
        (m): m is string => typeof m === "string" && MUSCLE_SET.has(m),
      )
    : [];
  const region =
    typeof body.affectedRegion === "string" ? body.affectedRegion : null;

  const supabase = await createClient();
  const movements = await getAffectedMovements(
    supabase,
    user.id,
    muscles,
    region,
  );
  return NextResponse.json({ movements });
}
