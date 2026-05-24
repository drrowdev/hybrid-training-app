import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { editSet } from "@/lib/sessions/actions";

export default async function EditSetPage({
  params,
}: {
  params: Promise<{ id: string; setId: string }>;
}) {
  const { id, setId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: set } = await supabase
    .from("set_logs")
    .select(
      "id, set_kind, weight_kg, reps, duration_sec, distance_m, rpe, notes, movement:movements(display_name, pattern)",
    )
    .eq("id", setId)
    .eq("session_id", id)
    .maybeSingle();

  if (!set) notFound();
  const movement = Array.isArray(set.movement) ? set.movement[0] : set.movement;

  return (
    <main className="min-h-screen px-6 py-8 max-w-md mx-auto space-y-6">
      <header className="space-y-1">
        <Link href={`/app/sessions/${id}`} className="text-xs text-foreground/50 hover:text-foreground">
          ← back to session
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Edit set</h1>
        {movement && (
          <p className="text-sm text-foreground/60">
            {movement.display_name}{" "}
            <span className="text-xs text-foreground/40">· {movement.pattern}</span>
          </p>
        )}
      </header>

      <form action={editSet} className="space-y-4 rounded-lg border border-foreground/10 p-4">
        <input type="hidden" name="id" value={set.id} />
        <input type="hidden" name="sessionId" value={id} />

        <div className="space-y-1">
          <label className="text-xs text-foreground/60" htmlFor="setKind">Set kind</label>
          <select id="setKind" name="setKind" defaultValue={set.set_kind} className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm">
            <option value="warmup">warmup</option>
            <option value="main">main</option>
            <option value="back_off">Volume set</option>
            <option value="accessory">accessory</option>
            <option value="tendon">tendon</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field name="weightKg" label="Weight (kg)" type="number" step="0.5" inputMode="decimal" defaultValue={set.weight_kg} />
          <Field name="reps" label="Reps" type="number" inputMode="numeric" defaultValue={set.reps} />
          <Field name="rpe" label="RPE" type="number" step="0.5" min="0" max="10" inputMode="decimal" defaultValue={set.rpe} />
          <Field name="durationSec" label="Hold (s)" type="number" inputMode="numeric" defaultValue={set.duration_sec} />
          <Field name="distanceM" label="Distance (m)" type="number" inputMode="numeric" defaultValue={set.distance_m} />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-foreground/60" htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} maxLength={400} defaultValue={set.notes ?? ""} className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm" />
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
