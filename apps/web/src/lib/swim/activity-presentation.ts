import { ymdInTimezone } from "@/lib/dates";
import { formatDate, resolveDateFormat, type ProfileForFormat } from "@/lib/format/datetime";
import { swimRecordingHref, type SwimOrigin } from "./return-context";
import type { StandaloneSwimTrainingStatus } from "@hta/domain";

export const SWIM_TRAINING_LABEL: Record<StandaloneSwimTrainingStatus, string> = {
  scheduled: "Scheduled", started: "In progress", completed: "Completed",
  stopped_early: "Stopped early", skipped: "Skipped", paused: "Paused",
  archived: "Plan ended", unavailable: "Unavailable", needs_review: "Review recording",
};

export type NativeActivity = {
  id: string; title: string | null; performed_at: string; completed_at: string | null;
  session_rpe: number | null; duration_min: number | null;
};
export type SwimActivity = {
  kind: "swim"; id: string; importId: string; title: string; date: string; scheduledDate: string;
  status: "completed" | "stopped_early" | "needs_review";
};
export type TrainingActivity = SwimActivity | {
  kind: "session"; id: string; title: string; date: string; status: "completed" | "started";
  session: NativeActivity;
};

export function mergeTrainingActivity(
  sessions: readonly NativeActivity[], swims: readonly SwimActivity[], timezone: string, limit: number,
): TrainingActivity[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid activity limit.");
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
  return activity.kind === "swim" ? swimRecordingHref(activity.importId, origin, activity.id) : `/app/sessions/${activity.id}`;
}

export function formatActivityDate(activity: TrainingActivity, profile: ProfileForFormat) {
  return activity.kind === "session" ? formatDate(activity.session.performed_at, profile)
    : formatDate(activity.date, { ...profile, timezone: "UTC", date_format: resolveDateFormat(profile) });
}
