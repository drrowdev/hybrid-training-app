import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { editCardio } from "@/lib/sessions/actions";
import {
  EditCardioForm,
  type EditCardioMode,
} from "@/components/session/EditCardioForm";

export default async function EditCardioPage({
  params,
}: {
  params: Promise<{ id: string; cardioId: string }>;
}) {
  const { id, cardioId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: block } = await supabase
    .from("cardio_logs")
    .select(
      "id, modality, duration_sec, distance_km, avg_hr_bpm, avg_pace_sec_per_km, rpe, notes, external_source, strava_activity_id, movement:movements(display_name)",
    )
    .eq("id", cardioId)
    .eq("session_id", id)
    .maybeSingle();

  if (!block) notFound();
  const movement = Array.isArray(block.movement) ? block.movement[0] : block.movement;

  const { data: profile } = await supabase
    .from("profiles")
    .select("units")
    .eq("user_id", user.id)
    .maybeSingle();
  const units: "metric" | "imperial" =
    profile?.units === "imperial" ? "imperial" : "metric";

  // Session-completion flag: completed sessions show all fields with
  // the canonical edit form, same as a session that has logged metrics.
  const { data: session } = await supabase
    .from("sessions")
    .select("completed_at")
    .eq("id", id)
    .maybeSingle();
  const isComplete = !!session?.completed_at;

  // What "mode" is the form in?
  //   - strava-readonly: imported from Strava, never editable here.
  //   - prescription-only: a Quick-cardio session BEFORE the user has
  //     logged anything (no HR, no distance, no RPE, no notes). The
  //     `duration_sec` value is always populated because creating the
  //     row required it — it does NOT count as "the user logged
  //     something." Surface only Duration + Notes; the rest lands via
  //     CardioLogForm after the workout.
  //   - full: anything else (completed, partially logged, etc.)
  const fromStrava =
    block.external_source === "strava" || block.strava_activity_id != null;
  const hasLoggedMetrics =
    block.avg_hr_bpm != null ||
    block.distance_km != null ||
    block.avg_pace_sec_per_km != null ||
    block.rpe != null ||
    (block.notes != null && String(block.notes).trim() !== "");
  const mode: EditCardioMode = fromStrava
    ? { kind: "strava-readonly" }
    : !isComplete && !hasLoggedMetrics
      ? { kind: "prescription-only" }
      : { kind: "full" };

  return (
    <main className="min-h-screen px-6 py-8 max-w-md mx-auto space-y-6">
      <header className="space-y-1">
        <Link href={`/app/sessions/${id}`} className="text-xs text-foreground/50 hover:text-foreground">
          ← back to session
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="edit-cardio-heading">
          Edit cardio session
        </h1>
        <p className="text-sm text-foreground/60">{movement?.display_name ?? block.modality}</p>
      </header>

      <EditCardioForm
        sessionId={id}
        block={{
          id: block.id,
          duration_sec: block.duration_sec ?? null,
          distance_km: block.distance_km ?? null,
          avg_hr_bpm: block.avg_hr_bpm ?? null,
          avg_pace_sec_per_km: block.avg_pace_sec_per_km ?? null,
          rpe: block.rpe ?? null,
          notes: block.notes ?? null,
        }}
        units={units}
        mode={mode}
        action={editCardio}
      />
    </main>
  );
}
