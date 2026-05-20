import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listMovementsRanked } from "@/lib/stats/movement";

export default async function StatsPage() {
  const supabase = await createClient();
  const { data: all } = await supabase
    .from("sessions")
    .select("id, title, performed_at, completed_at, session_rpe, duration_min")
    .order("performed_at", { ascending: false })
    .limit(40);

  const completed = (all ?? []).filter((s) => s.completed_at);
  const total = completed.length;
  const last30 = completed.filter(
    (s) => Date.now() - new Date(s.performed_at).getTime() < 30 * 86_400_000,
  ).length;
  const rpeSamples = completed.filter((s) => s.session_rpe);
  const avgRpe = rpeSamples.length
    ? rpeSamples.reduce((a, s) => a + (s.session_rpe ?? 0), 0) / rpeSamples.length
    : 0;

  const movements = await listMovementsRanked();

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: "-0.01em" }}>Stats</h1>
        <p style={{ margin: "4px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          Everything you have actually done. Drill into a movement, or peek at what the engine sees.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <Tile label="Sessions logged" value={total.toString()} />
        <Tile label="Last 30 days" value={last30.toString()} />
        <Tile label="Avg session RPE" value={avgRpe ? avgRpe.toFixed(1) : "—"} />
        <Tile label="Engine state" value="View →" href="/app/stats/engine" />
      </div>

      <section className="cp-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Movement drill-down</h2>
          <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>{movements.length} logged</span>
        </div>
        {movements.length === 0 ? (
          <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 13 }}>
            No movements logged yet. Start a session to start building trends.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {movements.slice(0, 15).map((m, i) => (
              <li key={m.movementId} style={{ borderTop: i === 0 ? "none" : "1px solid var(--cp-border)" }}>
                <Link
                  href={`/app/stats/movements/${m.slug}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    color: "inherit",
                    textDecoration: "none",
                    padding: "10px 0",
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.displayName}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
                      {m.setCount} sets · last {new Date(m.lastPerformed).toLocaleDateString()}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cp-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Recent sessions</h2>
          <Link href="/app/sessions" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>see all →</Link>
        </div>
        {completed.length === 0 ? (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--cp-text-muted)" }}>No completed sessions yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
            {completed.slice(0, 8).map((s, i) => (
              <li
                key={s.id}
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--cp-border)",
                  padding: "8px 0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 8,
                  fontSize: 13,
                }}
              >
                <Link href={`/app/sessions/${s.id}`} style={{ color: "inherit", textDecoration: "none", flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.title ?? "Untitled session"}
                  </span>
                </Link>
                <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)", flexShrink: 0 }}>
                  {new Date(s.performed_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <div className="cp-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, letterSpacing: "-0.01em" }}>{value}</div>
    </div>
  );
  return href ? (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>{body}</Link>
  ) : (
    body
  );
}
