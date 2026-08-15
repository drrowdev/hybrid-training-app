import { NextResponse, type NextRequest } from "next/server";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  prescribedMovementIds,
  rankSwapCandidates,
  type SwapMovementFields,
} from "@/lib/sessions/swap-ranking";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import {
  resolveRequiredEquipment,
  isEquipmentAvailable,
} from "@/lib/planner/equipment-requirements";

/**
 * GET /api/movements/swap-candidates?originalId=<uuid>&limit=25&sessionId=<uuid>
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
 *
 * ``sessionId`` (optional) scopes the list to the workout being edited: any
 * movement the session ALREADY prescribes is dropped from the recommendations,
 * because swapping into it duplicates a movement inside one workout — e.g.
 * barbell hip thrust is a `hinge`, so it ranks near the top when replacing a
 * deadlift even on a day that already programmes it as an accessory. Explicit
 * searches still return those movements, flagged `alreadyInSession` so the
 * picker can warn instead of silently hiding a result the user typed.
 */
const MOVEMENT_FIELDS =
  "id, slug, display_name, pattern, primary_region, primary_muscles, secondary_muscles, functional_roles, bulletproof_roles, equipment, is_compound, is_supported, stability, metadata";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const url = new URL(request.url);
  const originalId = url.searchParams.get("originalId");
  const sessionId = url.searchParams.get("sessionId");
  const q = (url.searchParams.get("q") ?? "").trim();
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

  // The signed-in user's equipment, resolved once. A swap menu that suggests a
  // leg-press machine to someone training at home is noise; we filter to loadable
  // alternatives, falling back to the unfiltered pool if a profile can't be
  // resolved or filtering would empty the list.
  const {
    data: { user },
  } = await getAuthUser();
  let equipment: ReturnType<typeof resolveEquipment> | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("equipment, barbell_kg, trap_bar_kg, plate_inventory_kg")
      .eq("id", user.id)
      .maybeSingle();
    equipment = resolveEquipment(profile);
  }
  const equipmentFilter = (pool: SwapMovementFields[]): SwapMovementFields[] => {
    if (!equipment) return pool;
    const available = pool.filter((m) =>
      isEquipmentAvailable(
        resolveRequiredEquipment({ slug: m.slug, equipment: m.equipment }),
        equipment!,
      ),
    );
    return available.length > 0 ? available : pool;
  };

  // Movements this workout ALREADY carries — the prescription (planned session
  // first, then the quick/freestyle session row) plus any off-plan additions in
  // `session_movements`. Every read is user-scoped so RLS holds. A failure here
  // degrades to "no exclusions" rather than breaking the swap menu.
  const movementIdsInSession =
    sessionId && user
      ? await (async () => {
          const [planned, session, extras] = await Promise.all([
            supabase
              .from("planned_sessions")
              .select("prescription")
              .eq("completed_session_id", sessionId)
              .eq("user_id", user.id)
              .maybeSingle(),
            supabase
              .from("sessions")
              .select("prescription")
              .eq("id", sessionId)
              .eq("user_id", user.id)
              .is("deleted_at", null)
              .maybeSingle(),
            supabase
              .from("session_movements")
              .select("movement_id")
              .eq("session_id", sessionId)
              .eq("user_id", user.id),
          ]);
          const rx =
            (planned.data?.prescription as Parameters<typeof prescribedMovementIds>[0]) ??
            (session.data?.prescription as Parameters<typeof prescribedMovementIds>[0]) ??
            null;
          const ids = new Set(prescribedMovementIds(rx, { exclude: originalId }));
          for (const row of (extras.data ?? []) as Array<{ movement_id?: string | null }>) {
            if (typeof row.movement_id === "string" && row.movement_id !== originalId) {
              ids.add(row.movement_id);
            }
          }
          return Array.from(ids);
        })()
      : [];

  // SEARCH MODE: when the user types a query, search the WHOLE catalog by name /
  // slug — not just the similarity-ranked bucket. The recommendations list is
  // capped + ordered by similarity, so a relevant-but-distant movement (e.g. an
  // overhead triceps extension when swapping a close-grip bench) would otherwise
  // be unreachable by typing. Equipment-filtered, ranked so close matches lead.
  if (q.length > 0) {
    const safe = q.replace(/[%_(),]/g, "\\$&");
    const { data, error } = await supabase
      .from("movements")
      .select(MOVEMENT_FIELDS)
      .neq("id", originalId)
      .or(`display_name.ilike.%${safe}%,slug.ilike.%${safe}%`)
      .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const ranked = rankSwapCandidates(
      orig as unknown as SwapMovementFields,
      equipmentFilter((data ?? []) as unknown as SwapMovementFields[]),
      { movementIdsInSession, mode: "search" },
    ).slice(0, limit);
    return NextResponse.json({ pattern: orig.pattern, movements: ranked, mode: "search" });
  }

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

  const ranked = rankSwapCandidates(
    orig as unknown as SwapMovementFields,
    equipmentFilter(Array.from(byId.values())),
    { movementIdsInSession, mode: "recommend" },
  ).slice(0, limit);

  return NextResponse.json({
    pattern: orig.pattern,
    movements: ranked,
  });
}
