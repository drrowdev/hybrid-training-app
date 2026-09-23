import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { DeleteSessionButton } from "@/components/trash/DeleteSessionButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { loadSwimActivity } from "@/lib/swim/activity-history";
import { formatActivityDate, mergeTrainingActivity, trainingActivityHref, SWIM_TRAINING_LABEL } from "@/lib/swim/activity-presentation";
import { readSwimRehabOrigin } from "@/lib/swim/rehab-workouts";

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
        "id, title, performed_at, completed_at, fatigue, soreness, session_rpe, duration_min, swim_rehab:prescription->meta->swimRehab",
      )
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("performed_at", { ascending: false })
      .limit(100),
    loadSwimActivity(supabase, user.id, 100),
  ]);
  if (profileError || sessionsError || !sessions) throw new Error("Your training history could not be loaded.");
  const activities = mergeTrainingActivity(sessions, swims, profile?.timezone ?? "UTC", 100);
  const rehabSessionIds = new Set(sessions.filter((session) =>
    session.swim_rehab != null && readSwimRehabOrigin({ meta: { swimRehab: session.swim_rehab } })).map((session) => session.id));

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/app", label: "Today" }}
        title={
          <>
            Sessions{" "}
            <span className="text-base text-foreground/50 font-normal">
              ({activities.length})
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

      {activities.length === 0 && (
        <EmptyState
          title="No sessions yet"
          action={{ label: "Log a session →", href: "/app/sessions/new" }}
        />
      )}

      {activities.length > 0 && (
        <ul className="divide-y divide-foreground/10 rounded-lg border border-foreground/10">
          {activities.map((activity) => (
            <li key={`${activity.kind}:${activity.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <Link
                href={trainingActivityHref(activity, "sessions")}
                className="flex-1 min-w-0 hover:opacity-70"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium truncate">
                    {activity.title}
                  </span>
                  <span className="text-xs text-foreground/50 shrink-0">
                    {formatActivityDate(activity, profile)}
                  </span>
                </div>
                <div className="text-xs text-foreground/60">
                  {activity.kind === "swim" ? SWIM_TRAINING_LABEL[activity.status] : <>
                    {rehabSessionIds.has(activity.id) && "Swimming · Rehab · "}
                    {activity.session.completed_at ? "✓ complete" : "in progress"}
                    {activity.session.session_rpe ? ` · Effort ${activity.session.session_rpe}` : ""}
                    {activity.session.duration_min ? ` · ${activity.session.duration_min} min` : ""}
                  </>}
                </div>
              </Link>
              {activity.kind === "session" && <DeleteSessionButton sessionId={activity.id} label={activity.session.title || "Session"} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
