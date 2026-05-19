import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { completeSession } from "@/lib/sessions/actions";

export default async function CompleteSessionPage({
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
    .select("id, title, performed_at, completed_at")
    .eq("id", id)
    .maybeSingle();

  if (!session) notFound();
  if (session.completed_at) redirect(`/app/sessions/${id}`);

  const { count: setCount } = await supabase
    .from("set_logs")
    .select("id", { count: "exact", head: true })
    .eq("session_id", id);
  const { count: cardioCount } = await supabase
    .from("cardio_logs")
    .select("id", { count: "exact", head: true })
    .eq("session_id", id);

  return (
    <main className="min-h-screen px-6 py-12 max-w-md mx-auto space-y-6">
      <header className="space-y-1">
        <Link
          href={`/app/sessions/${id}`}
          className="text-xs text-foreground/50 hover:text-foreground"
        >
          ← back to session
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Finish session</h1>
        <p className="text-sm text-foreground/60">
          {setCount ?? 0} sets · {cardioCount ?? 0} cardio blocks
        </p>
      </header>

      <form action={completeSession} className="space-y-4">
        <input type="hidden" name="sessionId" value={id} />

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="sessionRpe">
            Session RPE (0–10)
          </label>
          <input
            id="sessionRpe"
            name="sessionRpe"
            type="number"
            step="0.5"
            min="0"
            max="10"
            placeholder="e.g. 7.5"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm"
          />
          <p className="text-xs text-foreground/50">
            How hard the whole session felt overall (Helms 2016, Zourdos 2016).
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="durationMin">
            Duration (minutes)
          </label>
          <input
            id="durationMin"
            name="durationMin"
            type="number"
            min="0"
            max="600"
            placeholder="e.g. 75"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="notes">
            Notes (optional)
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            maxLength={2000}
            placeholder="How did it go? Anything that needs follow-up next session?"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-foreground text-background py-2 text-sm font-medium hover:opacity-90"
        >
          Mark complete
        </button>
      </form>
    </main>
  );
}
