import { notFound, redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { completeSession } from "@/lib/sessions/actions";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function CompleteSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("sessions")
    .select("id, title, performed_at, completed_at")
    .eq("id", id)
    .is("deleted_at", null)
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
      <PageHeader
        back={{ href: `/app/sessions/${id}`, label: "Workout" }}
        title="Finish session"
        subtitle={`${setCount ?? 0} sets · ${cardioCount ?? 0} cardio blocks`}
      />

      <div className="rounded-lg border border-foreground/15 bg-foreground/[0.02] p-4 text-sm text-foreground/70">
        Session RPE and duration are computed automatically from your logged
        sets. Just tap complete when you&apos;re done.
      </div>

      <form action={completeSession} className="space-y-4">
        <input type="hidden" name="sessionId" value={id} />

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
          Complete session
        </button>
      </form>
    </main>
  );
}
