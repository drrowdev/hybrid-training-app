import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { DeleteSessionButton } from "@/components/trash/DeleteSessionButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatDate } from "@/lib/format/datetime";

export default async function SessionsListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: sessions }] = await Promise.all([
    supabase
      .from("profiles")
      .select("timezone, time_format, date_format")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("sessions")
      .select(
        "id, title, performed_at, completed_at, fatigue, soreness, session_rpe, duration_min",
      )
      .is("deleted_at", null)
      .order("performed_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/app", label: "Today" }}
        title={
          <>
            Sessions{" "}
            <span className="text-base text-foreground/50 font-normal">
              ({sessions?.length ?? 0})
            </span>
          </>
        }
        actions={
          <Link
            href="/app/sessions/new"
            className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            New
          </Link>
        }
      />

      {(!sessions || sessions.length === 0) && (
        <EmptyState
          title="No sessions yet"
          body="Tap +New session and your logged training appears here, newest first."
          action={{ label: "Log a session →", href: "/app/sessions/new" }}
        />
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
                    {formatDate(s.performed_at, profile)}
                  </span>
                </div>
                <div className="text-xs text-foreground/60">
                  {s.completed_at ? "✓ complete" : "in progress"}
                  {s.session_rpe ? ` · Effort ${s.session_rpe}` : ""}
                  {s.duration_min ? ` · ${s.duration_min} min` : ""}
                </div>
              </Link>
              <DeleteSessionButton sessionId={s.id} label={s.title || "Session"} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
