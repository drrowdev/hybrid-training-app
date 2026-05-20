import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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
  // layout already enforces auth; user is non-null here
  const userId = user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  const todayIso = new Date().toISOString().slice(0, 10);

  const { data: todaySessions } = await supabase
    .from("sessions")
    .select("id, title, completed_at, performed_at")
    .gte("performed_at", `${todayIso}T00:00:00`)
    .lt("performed_at", `${todayIso}T23:59:59`)
    .order("performed_at", { ascending: false });

  const { data: recent } = await supabase
    .from("sessions")
    .select("id, title, performed_at, completed_at, session_rpe, duration_min")
    .order("performed_at", { ascending: false })
    .limit(6);

  const openSession = (todaySessions ?? []).find((s) => !s.completed_at) ?? null;
  const completedToday = (todaySessions ?? []).filter((s) => s.completed_at);
  const greeting = profile?.display_name ? `Hey ${profile.display_name}` : "Hey there";

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {todayLabel()}
        </div>
        <h1 style={{ fontSize: 28, margin: "4px 0 0", letterSpacing: "-0.01em" }}>{greeting}.</h1>
      </header>

      {/* ── Today's session ───────────────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {openSession ? "Resume today's session" : completedToday.length > 0 ? "Today, so far" : "Today's session"}
        </div>

        {openSession ? (
          <>
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
          </>
        ) : completedToday.length > 0 ? (
          <>
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
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 22, margin: 0 }}>Start a session</h2>
            <p style={{ color: "var(--cp-text-muted)", margin: 0, fontSize: 14 }}>
              Once you start one, the engine will tailor recommendations to the regions you have trained recently.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/app/sessions/new" className="cp-btn primary big">
                ⚡ Start session
              </Link>
              <Link href="/app/plan" className="cp-btn">View plan</Link>
            </div>
          </>
        )}
      </section>

      {/* ── Up next this week ─────────────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Up next this week</h2>
          <Link href="/app/plan" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>full week →</Link>
        </div>
        <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
          Your forward plan will live here once the planner is wired up. For now you can{" "}
          <Link href="/app/sessions/new" style={{ color: "var(--cp-link)" }}>start a session</Link> any time —
          the engine logs and learns from what you actually do.
        </p>
      </section>

      {/* ── Recent sessions ───────────────────────────────────────── */}
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
              <li
                key={s.id}
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--cp-border)",
                  padding: "10px 0",
                }}
              >
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
