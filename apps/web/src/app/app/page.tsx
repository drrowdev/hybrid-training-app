import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth/actions";

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, bodyweight_kg")
    .eq("id", user.id)
    .maybeSingle();

  const { data: recent } = await supabase
    .from("sessions")
    .select(
      "id, title, performed_at, completed_at, fatigue, soreness, session_rpe, duration_min",
    )
    .order("performed_at", { ascending: false })
    .limit(8);

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayCount = (recent ?? []).filter((s) =>
    s.performed_at.startsWith(todayIso),
  ).length;

  return (
    <main className="min-h-screen px-6 py-8 max-w-2xl mx-auto space-y-6">
      <header className="flex items-baseline justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {profile?.display_name ? `Hey ${profile.display_name}` : "Hey"}
          </h1>
          <p className="text-xs text-foreground/50 font-mono">{user.email}</p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md border border-foreground/20 px-3 py-1.5 text-xs hover:bg-foreground/5"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="rounded-lg border border-foreground/10 p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">Log today</h2>
            <p className="text-xs text-foreground/60">
              {todayCount > 0
                ? `${todayCount} session${todayCount > 1 ? "s" : ""} already today`
                : "Start a new session"}
            </p>
          </div>
          <Link
            href="/app/sessions/new"
            className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            New session
          </Link>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-medium">Recent sessions</h2>
          <Link
            href="/app/sessions"
            className="text-xs text-foreground/50 hover:text-foreground"
          >
            see all →
          </Link>
        </div>
        {(!recent || recent.length === 0) && (
          <p className="text-sm text-foreground/50">
            No sessions yet. Click <strong>New session</strong> above to log your first.
          </p>
        )}
        {recent && recent.length > 0 && (
          <ul className="divide-y divide-foreground/10 rounded-lg border border-foreground/10">
            {recent.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/app/sessions/${s.id}`}
                  className="block px-3 py-2.5 hover:bg-foreground/5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">
                      {s.title || "Untitled session"}
                    </span>
                    <span className="text-xs text-foreground/50">
                      {new Date(s.performed_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-xs text-foreground/60">
                    {s.completed_at ? "✓ complete" : "in progress"}
                    {s.session_rpe ? ` · sRPE ${s.session_rpe}` : ""}
                    {s.duration_min ? ` · ${s.duration_min} min` : ""}
                    {s.fatigue ? ` · fatigue ${s.fatigue}/5` : ""}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="flex justify-between gap-4 text-xs text-foreground/40 pt-2">
        <span>Phase 1 — logging</span>
        <span className="flex gap-3">
          <Link href="/privacy" className="hover:underline">Privacy</Link>
          <Link href="/terms" className="hover:underline">Terms</Link>
        </span>
      </footer>
    </main>
  );
}
