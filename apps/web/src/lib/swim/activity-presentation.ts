import { ymdInTimezone } from "@/lib/dates";
import { formatDate, resolveDateFormat, type ProfileForFormat } from "@/lib/format/datetime";
import { conditioningSwimHref, type SwimOrigin } from "./conditioning-presentation";

export type NativeActivity = {
  id: string; title: string | null; performed_at: string; completed_at: string | null;
  session_rpe: number | null; duration_min: number | null;
};
export type SwimActivity = {
  kind: "swim"; id: string; title: string; date: string;
  status: "completed" | "stopped_early" | "needs_review";
};
export type TrainingActivity = SwimActivity | {
  kind: "session"; id: string; title: string; date: string; status: "completed" | "started";
  session: NativeActivity;
};

export function mergeTrainingActivity(
  sessions: readonly NativeActivity[], swims: readonly SwimActivity[], timezone: string, limit: number,
): TrainingActivity[] {
  const native: TrainingActivity[] = sessions.map((session) => ({
    kind: "session", id: session.id, title: session.title || "Untitled session",
    date: ymdInTimezone(new Date(session.performed_at), timezone),
    status: session.completed_at ? "completed" : "started", session,
  }));
  return [...native, ...swims].sort((a, b) =>
    b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind) ||
    (a.kind === "session" && b.kind === "session" ? Date.parse(b.session.performed_at) - Date.parse(a.session.performed_at) : 0) ||
    b.id.localeCompare(a.id)).slice(0, limit);
}

export function trainingActivityHref(activity: TrainingActivity, origin: SwimOrigin) {
  return activity.kind === "swim" ? conditioningSwimHref(activity.id, origin) : `/app/sessions/${activity.id}`;
}

export function formatActivityDate(activity: TrainingActivity, profile: ProfileForFormat) {
  return activity.kind === "session" ? formatDate(activity.session.performed_at, profile)
    : formatDate(activity.date, { ...profile, timezone: "UTC", date_format: resolveDateFormat(profile) });
}
