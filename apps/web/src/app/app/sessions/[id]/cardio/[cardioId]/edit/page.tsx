import { notFound, redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { editCardio } from "@/lib/sessions/actions";
import {
  EditCardioForm,
  type EditCardioMode,
} from "@/components/session/EditCardioForm";
import { PageHeader } from "@/components/ui/PageHeader";

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
      "id, modality, duration_sec, distance_km, avg_hr_bpm, avg_pace_sec_per_km, rpe, notes, movement:movements(display_name)",
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
  //   - prescription-only: a Quick-cardio session BEFORE the user has
  //     logged anything (no HR, no distance, no RPE, no notes). The
  //     `duration_sec` value is always populated because creating the
  //     row required it — it does NOT count as "the user logged
  //     something." Surface only Duration + Notes; the rest lands via
  //     CardioLogForm after the workout.
  //   - full: anything else (completed, partially logged, etc.)
  //
  // Historical externally-imported rows (those with `external_source` set)
  // used to be forced read-only with a "re-sync upstream" note. That upstream
  // no longer exists, so they are now normally editable like any other row and
  // the page no longer needs to read the import-provenance columns.
  const hasLoggedMetrics =
    block.avg_hr_bpm != null ||
    block.distance_km != null ||
    block.avg_pace_sec_per_km != null ||
    block.rpe != null ||
    (block.notes != null && String(block.notes).trim() !== "");
  const mode: EditCardioMode =
    !isComplete && !hasLoggedMetrics
      ? { kind: "prescription-only" }
      : { kind: "full" };

  return (
    <main className="min-h-screen px-6 py-8 max-w-md mx-auto space-y-6">
      <PageHeader
        back={{ href: `/app/sessions/${id}`, label: "Workout" }}
        title={<span data-testid="edit-cardio-heading">Edit cardio session</span>}
        subtitle={movement?.display_name ?? block.modality}
      />

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
