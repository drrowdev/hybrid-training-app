import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { startSessionFromPlan } from "@/lib/planner/actions";
import {
  formatPrescriptionItem,
  summarisePrescription,
} from "@/lib/planner/archetypes";
import {
  getTodayPlannedSessions,
  getUpcomingPlannedSessions,
  type PlannedDay,
} from "@/lib/planner/queries";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function todayLabel(d = new Date()) {
  return `${DOW[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function formatRecentDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const ms = now.getTime() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0 && d.getDate() === now.getDate()) return "today";
  if (days <= 1) return "yesterday";
  if (days < 7) return DOW[d.getDay()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  const todayIso = new Date().toISOString().slice(0, 10);

  const [{ data: todaySessions }, { data: recent }, plannedToday, upcoming] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, title, slot, completed_at, performed_at")
      .gte("performed_at", `${todayIso}T00:00:00`)
      .lt("performed_at", `${todayIso}T23:59:59`)
      .order("performed_at", { ascending: false }),
    supabase
      .from("sessions")
      .select("id, title, performed_at, completed_at, session_rpe, duration_min")
      .order("performed_at", { ascending: false })
      .limit(6),
    getTodayPlannedSessions(),
    getUpcomingPlannedSessions(3),
  ]);

  const openSession = (todaySessions ?? []).find((s) => !s.completed_at) ?? null;
  const completedToday = (todaySessions ?? []).filter((s) => s.completed_at);
  const greeting = profile?.display_name ? `Hey ${profile.display_name}` : "Hey there";
  const isTwoADay = plannedToday.length > 1;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {todayLabel()}
        </div>
        <h1 style={{ fontSize: 28, margin: "4px 0 0", letterSpacing: "-0.01em" }}>{greeting}.</h1>
      </header>

      <TodaySessionCard
        openSession={openSession}
        completedToday={completedToday}
        plannedToday={plannedToday}
        isTwoADay={isTwoADay}
      />

      <section className="cp-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Up next this week</h2>
          <Link href="/app/plan" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>full plan →</Link>
        </div>
        {upcoming.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
            No upcoming sessions on the schedule.{" "}
            <Link href="/app/plan" style={{ color: "var(--cp-link)" }}>Start a block</Link> to populate this.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, upcoming.length)}, 1fr)`, gap: 8 }}>
            {upcoming.map((u) => (
              <Link
                key={u.id}
                href={`/app/plan?week=${u.weekIndex}`}
                style={{
                  border: "1px solid var(--cp-border)",
                  borderRadius: 12,
                  padding: 12,
                  textDecoration: "none",
                  color: "inherit",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  minHeight: 110,
                }}
              >
                <div style={{ fontSize: 10, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {new Date(u.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })} ·{" "}
                  <span style={{ color: "var(--cp-text)" }}>
                    {new Date(u.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25 }}>{u.title}</div>
                <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: "auto" }}>
                  {summarisePrescription(u.prescription.items)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="cp-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Recent sessions</h2>
          <Link href="/app/stats" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>all stats →</Link>
        </div>
        {!recent || recent.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
            Nothing logged yet. Your first session will appear here.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {recent.map((s, i) => (
              <li key={s.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--cp-border)", padding: "10px 0" }}>
                <Link
                  href={`/app/sessions/${s.id}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    color: "inherit",
                    textDecoration: "none",
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.title ?? "Untitled session"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
                      {s.completed_at ? "✓ complete" : "in progress"}
                      {s.session_rpe ? ` · sRPE ${s.session_rpe}` : ""}
                      {s.duration_min ? ` · ${s.duration_min} min` : ""}
                    </div>
                  </div>
                  <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)", flexShrink: 0 }}>
                    {formatRecentDate(s.performed_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TodaySessionCard({
  openSession,
  completedToday,
  plannedToday,
  isTwoADay,
}: {
  openSession: { id: string; title: string | null } | null;
  completedToday: { id: string; title: string | null }[];
  plannedToday: PlannedDay[];
  isTwoADay: boolean;
}) {
  if (openSession) {
    return (
      <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Resume today&apos;s session
        </div>
        <h2 style={{ fontSize: 22, margin: 0 }}>{openSession.title ?? "In-progress session"}</h2>
        <p style={{ color: "var(--cp-text-muted)", margin: 0, fontSize: 14 }}>
          You started this earlier today. Pick up where you left off.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href={`/app/sessions/${openSession.id}`} className="cp-btn primary big">
            ⚡ Resume session
          </Link>
          <Link href={`/app/sessions/${openSession.id}/complete`} className="cp-btn">
            Wrap up
          </Link>
        </div>
      </section>
    );
  }

  if (completedToday.length > 0 && plannedToday.length <= completedToday.length) {
    // All planned slots for today are logged.
    return (
      <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Today, so far
        </div>
        <h2 style={{ fontSize: 22, margin: 0 }}>
          {completedToday.length === 1 ? "Session logged ✓" : `${completedToday.length} sessions logged ✓`}
        </h2>
        <p style={{ color: "var(--cp-text-muted)", margin: 0, fontSize: 14 }}>
          {completedToday[0]?.title ?? "Untitled session"} — rest and recover. Tomorrow is in the plan.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/app/sessions/new" className="cp-btn">Add another session</Link>
          <Link href="/app/plan" className="cp-btn">See tomorrow →</Link>
        </div>
      </section>
    );
  }

  if (plannedToday.length === 0) {
    return (
      <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Today
        </div>
        <h2 style={{ fontSize: 22, margin: 0 }}>Rest or freestyle</h2>
        <p style={{ color: "var(--cp-text-muted)", margin: 0, fontSize: 14 }}>
          Nothing on the schedule today. Take it as a rest day, or log a freestyle session.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/app/sessions/new" className="cp-btn primary">
            ⚡ Log a session
          </Link>
          <Link href="/app/plan" className="cp-btn">View plan</Link>
        </div>
      </section>
    );
  }

  // 1 or 2 planned sessions today.
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {isTwoADay && (
        <div
          role="note"
          className="cp-card"
          style={{
            padding: "10px 14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            background: "color-mix(in oklab, var(--cp-accent) 4%, transparent)",
            borderColor: "var(--cp-accent)",
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--cp-text)" }}>
            <strong>Two-a-day · ≥6h gap recommended.</strong>
            <span style={{ color: "var(--cp-text-muted)", marginLeft: 4 }}>
              AM lift + PM cardio with at least 6 hours between protects the strength signal.
            </span>
          </span>
          <span className="mono" style={{ fontSize: 10, color: "var(--cp-text-muted)", flexShrink: 0 }}>
            Robineau 2016 HIGH
          </span>
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isTwoADay ? "repeat(auto-fit, minmax(300px, 1fr))" : "1fr",
          gap: 12,
        }}
      >
        {plannedToday.map((p) => (
          <PlannedSessionCard key={p.id} planned={p} isTwoADay={isTwoADay} />
        ))}
      </div>
    </div>
  );
}

function PlannedSessionCard({ planned, isTwoADay }: { planned: PlannedDay; isTwoADay: boolean }) {
  const slotLabel =
    planned.slot === "am" ? "Morning" : planned.slot === "pm" ? "Evening" : "Today's session";
  return (
    <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12, borderColor: "var(--cp-accent)" }}>
      <div style={{ fontSize: 11, color: "var(--cp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
        {isTwoADay && planned.slot !== "single" ? (
          <span>
            {slotLabel} · <span className="mono">{planned.slot.toUpperCase()}</span>
          </span>
        ) : (
          slotLabel
        )}
      </div>
      <h2 style={{ fontSize: 20, margin: 0 }}>{planned.title}</h2>
      <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
        {summarisePrescription(planned.prescription.items)}
      </div>
      {planned.prescription.items.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
          {planned.prescription.items.map((item, i) => (
            <li
              key={i}
              style={{
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 10px",
                background: "var(--cp-surface-soft)",
                borderRadius: 6,
              }}
            >
              <span>
                Set {i + 1}
                {item.notes ? (
                  <span style={{ color: "var(--cp-accent)", fontWeight: 600, marginLeft: 4 }}>· {item.notes}</span>
                ) : null}
              </span>
              <span className="mono" style={{ fontWeight: 600 }}>{formatPrescriptionItem(item)}</span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {planned.completedSessionId ? (
          <Link href={`/app/sessions/${planned.completedSessionId}`} className="cp-btn primary big">
            ⚡ Continue session
          </Link>
        ) : (
          <form action={startSessionFromPlan}>
            <input type="hidden" name="id" value={planned.id} />
            <button type="submit" className="cp-btn primary big">⚡ Start session</button>
          </form>
        )}
        <Link href="/app/plan" className="cp-btn">View plan</Link>
      </div>
    </section>
  );
}
