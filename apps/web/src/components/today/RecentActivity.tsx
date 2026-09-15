import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { addDaysToYmd } from "@/lib/dates";
import { trainingActivityHref, type TrainingActivity } from "@/lib/swim/activity-presentation";
import { SWIM_TRAINING_LABEL } from "@/lib/swim/conditioning-presentation";

function ActivityPill({ label, mono }: { label: string; mono?: boolean }) {
  return (
    <span className={mono ? "mono" : undefined} style={{
      fontSize: 11, color: "var(--cp-text-muted)", background: "var(--cp-surface-soft)",
      border: "1px solid var(--cp-border)", borderRadius: 7, padding: "3px 8px",
    }}>{label}</span>
  );
}

export function RecentActivity({ sessions, todayIso }: {
  sessions: readonly TrainingActivity[]; todayIso: string;
}) {
  if (sessions.length === 0) return (
    <section className="cp-card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Recent activity</h2>
        <Link href="/app/sessions" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>View all →</Link>
      </div>
      <EmptyState variant="inline" title="No sessions yet" />
    </section>
  );
  const yesterdayIso = addDaysToYmd(todayIso, -1);
  const groups: { key: string; label: string; items: TrainingActivity[] }[] = [
    { key: "today", label: "Today", items: [] },
    { key: "yesterday", label: "Yesterday", items: [] },
    { key: "earlier", label: "Earlier", items: [] },
  ];
  for (const session of sessions) {
    const group = session.date === todayIso ? groups[0]! : session.date === yesterdayIso ? groups[1]! : groups[2]!;
    group.items.push(session);
  }
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 4 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Recent activity</h2>
        <Link href="/app/sessions" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>View all →</Link>
      </div>
      {groups.filter((group) => group.items.length > 0).map((group) => (
        <div key={group.key} style={{ display: "grid", gap: 6 }}>
          <div style={{
            fontSize: 11, letterSpacing: "0.1em", color: "var(--cp-text-muted)",
            textTransform: "uppercase", fontWeight: 600, marginTop: 8,
          }}>{group.label}</div>
          {group.items.map((activity) => {
            const complete = activity.status === "completed";
            return (
              <Link key={`${activity.kind}:${activity.id}`} href={trainingActivityHref(activity, "today")} style={{
                display: "flex", alignItems: "center", gap: 12, background: "var(--cp-surface)",
                border: "1px solid var(--cp-border)", borderRadius: 11, padding: "11px 13px",
                textDecoration: "none", color: "inherit",
              }}>
                <span aria-hidden style={{
                  flex: "0 0 auto", width: 28, height: 28, borderRadius: 8, display: "grid",
                  placeItems: "center", fontSize: 13,
                  background: complete ? "var(--cp-accent-soft)" : "color-mix(in srgb, var(--cp-warning) 16%, transparent)",
                  color: complete ? "var(--cp-accent)" : "var(--cp-warning)",
                }}>{complete ? "✓" : "◷"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{activity.title}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    {complete ? <span className="sr-only">{SWIM_TRAINING_LABEL[activity.status]}</span>
                      : <ActivityPill label={SWIM_TRAINING_LABEL[activity.status]} />}
                    {activity.kind === "session" && activity.session.session_rpe != null &&
                      <ActivityPill label={`Effort ${activity.session.session_rpe}`} mono />}
                    {activity.kind === "session" && activity.session.duration_min != null &&
                      <ActivityPill label={`${activity.session.duration_min} min`} mono />}
                  </div>
                </div>
                <span style={{ color: "var(--cp-text-muted)", fontSize: 16 }} aria-hidden>›</span>
              </Link>
            );
          })}
        </div>
      ))}
    </section>
  );
}
