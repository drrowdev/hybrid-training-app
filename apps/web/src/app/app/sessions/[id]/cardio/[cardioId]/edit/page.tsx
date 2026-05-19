import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { editCardio } from "@/lib/sessions/actions";

export default async function EditCardioPage({
  params,
}: {
  params: Promise<{ id: string; cardioId: string }>;
}) {
  const { id, cardioId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  return (
    <main className="min-h-screen px-6 py-8 max-w-md mx-auto space-y-6">
      <header className="space-y-1">
        <Link href={`/app/sessions/${id}`} className="text-xs text-foreground/50 hover:text-foreground">
          ← back to session
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Edit cardio block</h1>
        <p className="text-sm text-foreground/60">{movement?.display_name ?? block.modality}</p>
      </header>

      <form action={editCardio} className="space-y-4 rounded-lg border border-foreground/10 p-4">
        <input type="hidden" name="id" value={block.id} />
        <input type="hidden" name="sessionId" value={id} />

        <div className="grid grid-cols-2 gap-3">
          <Field name="durationSec" label="Duration (s)" type="number" inputMode="numeric" required defaultValue={block.duration_sec} />
          <Field name="distanceKm" label="Distance (km)" type="number" step="0.1" inputMode="decimal" defaultValue={block.distance_km} />
          <Field name="avgHrBpm" label="Avg HR (bpm)" type="number" inputMode="numeric" defaultValue={block.avg_hr_bpm} />
          <Field name="avgPaceSecPerKm" label="Pace (s/km)" type="number" inputMode="numeric" defaultValue={block.avg_pace_sec_per_km} />
          <Field name="rpe" label="RPE" type="number" step="0.5" min="0" max="10" inputMode="decimal" defaultValue={block.rpe} />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-foreground/60" htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} maxLength={400} defaultValue={block.notes ?? ""} className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm" />
        </div>

        <button type="submit" className="w-full rounded-md bg-foreground text-background py-2 text-sm font-medium hover:opacity-90">
          Save changes
        </button>
      </form>
    </main>
  );
}

function Field({ name, label, defaultValue, ...rest }: { name: string; label: string; defaultValue?: string | number | null } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-foreground/60" htmlFor={name}>{label}</label>
      <input id={name} name={name} defaultValue={defaultValue ?? undefined} {...rest} className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm" />
    </div>
  );
}
