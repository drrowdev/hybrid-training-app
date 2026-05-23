import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DeleteSessionButton } from "@/components/trash/DeleteSessionButton";

export default async function SessionsListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: sessions } = await supabase
    .from("sessions")
    .select(
      "id, title, performed_at, completed_at, fatigue, soreness, session_rpe, duration_min",
    )
    .is("deleted_at", null)
    .order("performed_at", { ascending: false })
    .limit(100);

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
            Sessions <span className="text-base text-foreground/50 font-normal">({sessions?.length ?? 0})</span>
          </h1>
          <Link
            href="/app/sessions/new"
            className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            New
          </Link>
        </div>
      </header>

      {(!sessions || sessions.length === 0) && (
        <p className="text-sm text-foreground/50">No sessions yet.</p>
      )}

      {sessions && sessions.length > 0 && (
        <ul className="divide-y divide-foreground/10 rounded-lg border border-foreground/10">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <Link
                href={`/app/sessions/${s.id}`}
                className="flex-1 min-w-0 hover:opacity-70"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium truncate">
                    {s.title || "Untitled session"}
                  </span>
                  <span className="text-xs text-foreground/50 shrink-0">
                    {new Date(s.performed_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="text-xs text-foreground/60">
                  {s.completed_at ? "✓ complete" : "in progress"}
                  {s.session_rpe ? ` · sRPE ${s.session_rpe}` : ""}
                  {s.duration_min ? ` · ${s.duration_min} min` : ""}
                </div>
              </Link>
              <DeleteSessionButton sessionId={s.id} label={s.title || "Session"} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
