import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  AddCardioBlockForm,
  AddStrengthSetForm,
} from "@/components/add-log-forms";
import {
  addCardioBlock,
  addStrengthSet,
  deleteCardio,
  deleteSet,
} from "@/lib/sessions/actions";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("sessions")
    .select(
      "id, performed_at, title, fatigue, soreness, session_rpe, duration_min, notes, completed_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!session) notFound();

  // Sets with movement names (RLS scopes set_logs via the parent session).
  const { data: sets } = await supabase
    .from("set_logs")
    .select(
      "id, set_index, set_kind, weight_kg, reps, duration_sec, distance_m, rpe, notes, movement:movements(id, display_name, pattern, primary_region)",
    )
    .eq("session_id", id)
    .order("set_index", { ascending: true });

  const { data: cardio } = await supabase
    .from("cardio_logs")
    .select(
      "id, block_index, modality, duration_sec, distance_km, avg_hr_bpm, avg_pace_sec_per_km, rpe, notes, movement:movements(id, display_name)",
    )
    .eq("session_id", id)
    .order("block_index", { ascending: true });

  const isComplete = !!session.completed_at;

  return (
    <main className="min-h-screen px-6 py-8 max-w-2xl mx-auto space-y-6">
      <header className="space-y-1">
        <Link
          href="/app"
          className="text-xs text-foreground/50 hover:text-foreground"
        >
          ← back
        </Link>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {session.title || "Session"}
          </h1>
          {isComplete && (
            <span className="text-xs rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 px-2 py-0.5">
              completed
            </span>
          )}
        </div>
        <p className="text-sm text-foreground/60">
          {new Date(session.performed_at).toLocaleString()}
        </p>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Fatigue" value={session.fatigue ? `${session.fatigue}/5` : "—"} />
        <Stat label="Soreness" value={session.soreness ? `${session.soreness}/5` : "—"} />
        <Stat label="sRPE" value={session.session_rpe ?? "—"} />
        <Stat label="Duration" value={session.duration_min ? `${session.duration_min} min` : "—"} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">
          Sets <span className="text-xs text-foreground/50">({sets?.length ?? 0})</span>
        </h2>
        {(!sets || sets.length === 0) && (
          <p className="text-sm text-foreground/50">No sets logged yet.</p>
        )}
        {sets && sets.length > 0 && (
          <ul className="divide-y divide-foreground/10 rounded-lg border border-foreground/10">
            {sets.map((s) => {
              const mov = Array.isArray(s.movement) ? s.movement[0] : s.movement;
              return (
                <li key={s.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium">
                      {mov?.display_name ?? "Unknown movement"}{" "}
                      <span className="text-xs text-foreground/50">· {s.set_kind}</span>
                    </div>
                    <div className="text-xs text-foreground/60">
                      {formatSetBody(s)}
                    </div>
                  </div>
                  {!isComplete && (
                    <form action={deleteSet}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="sessionId" value={id} />
                      <button
                        type="submit"
                        className="text-xs text-foreground/40 hover:text-red-600"
                      >
                        delete
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">
          Cardio <span className="text-xs text-foreground/50">({cardio?.length ?? 0})</span>
        </h2>
        {(!cardio || cardio.length === 0) && (
          <p className="text-sm text-foreground/50">No cardio logged.</p>
        )}
        {cardio && cardio.length > 0 && (
          <ul className="divide-y divide-foreground/10 rounded-lg border border-foreground/10">
            {cardio.map((c) => {
              const mov = Array.isArray(c.movement) ? c.movement[0] : c.movement;
              return (
                <li key={c.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium">{mov?.display_name ?? c.modality}</div>
                    <div className="text-xs text-foreground/60">
                      {Math.round(c.duration_sec / 60)} min
                      {c.distance_km ? ` · ${c.distance_km} km` : ""}
                      {c.avg_hr_bpm ? ` · HR ${c.avg_hr_bpm}` : ""}
                      {c.rpe ? ` · RPE ${c.rpe}` : ""}
                    </div>
                  </div>
                  {!isComplete && (
                    <form action={deleteCardio}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="sessionId" value={id} />
                      <button
                        type="submit"
                        className="text-xs text-foreground/40 hover:text-red-600"
                      >
                        delete
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!isComplete && (
        <>
          <AddStrengthSetForm sessionId={id} action={addStrengthSet} />
          <AddCardioBlockForm sessionId={id} action={addCardioBlock} />

          <div className="pt-2">
            <Link
              href={`/app/sessions/${id}/complete`}
              className="inline-block rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Finish session →
            </Link>
          </div>
        </>
      )}

      {isComplete && session.notes && (
        <section className="rounded-lg border border-foreground/10 p-4 space-y-1">
          <h3 className="text-sm font-medium">Notes</h3>
          <p className="text-sm whitespace-pre-wrap text-foreground/80">{session.notes}</p>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-foreground/10 px-3 py-2">
      <div className="text-xs text-foreground/50">{label}</div>
      <div className="text-base font-medium">{value}</div>
    </div>
  );
}

function formatSetBody(s: {
  weight_kg: string | number | null;
  reps: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  rpe: string | number | null;
}): string {
  const parts: string[] = [];
  if (s.weight_kg) parts.push(`${s.weight_kg} kg`);
  if (s.reps) parts.push(`${s.reps} reps`);
  if (s.duration_sec) parts.push(`${s.duration_sec}s hold`);
  if (s.distance_m) parts.push(`${s.distance_m} m`);
  if (s.rpe) parts.push(`@ RPE ${s.rpe}`);
  return parts.join(" · ") || "—";
}
