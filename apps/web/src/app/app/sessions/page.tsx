import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { DeleteSessionButton } from "@/components/trash/DeleteSessionButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { loadSwimActivity } from "@/lib/swim/activity-history";
import { formatActivityDate, mergeTrainingActivity, trainingActivityHref } from "@/lib/swim/activity-presentation";
import { SWIM_TRAINING_LABEL } from "@/lib/swim/conditioning-presentation";

export default async function SessionsListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const [{ data: profile, error: profileError }, { data: sessions, error: sessionsError }, swims] = await Promise.all([
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
    loadSwimActivity(supabase, user.id, 100),
  ]);
  if (sessionsError || profileError) throw new Error("Your sessions could not be loaded.");
  const activity = mergeTrainingActivity(sessions ?? [], swims, profile?.timezone ?? "UTC", 100);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/app", label: "Today" }}
        title={
          <>
            Sessions{" "}
            <span className="text-base text-foreground/50 font-normal">
              ({activity.length})
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

      {activity.length === 0 && (
        <EmptyState
          title="No sessions yet"
          action={{ label: "Log a session →", href: "/app/sessions/new" }}
        />
      )}

      {activity.length > 0 && (
        <ul className="divide-y divide-foreground/10 rounded-lg border border-foreground/10">
          {activity.map((s) => (
            <li key={`${s.kind}:${s.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <Link
                href={trainingActivityHref(s, "sessions")}
                className="flex-1 min-w-0 hover:opacity-70"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium truncate">
                    {s.title}
                  </span>
                  <span className="text-xs text-foreground/50 shrink-0">
                    {formatActivityDate(s, profile)}
                  </span>
                </div>
                <div className="text-xs text-foreground/60">
                  {SWIM_TRAINING_LABEL[s.status]}
                  {s.kind === "session" && s.session.session_rpe ? ` · Effort ${s.session.session_rpe}` : ""}
                  {s.kind === "session" && s.session.duration_min ? ` · ${s.session.duration_min} min` : ""}
                </div>
              </Link>
              {s.kind === "session" && <DeleteSessionButton sessionId={s.id} label={s.title || "Session"} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
