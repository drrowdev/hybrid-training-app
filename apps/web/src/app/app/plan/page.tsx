import Link from "next/link";

export default function PlanPage() {
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          This week
        </div>
        <h1 style={{ fontSize: 28, margin: "4px 0 0", letterSpacing: "-0.01em" }}>Plan</h1>
      </header>

      <section className="cp-card" style={{ padding: 24, display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Planner is on its way</h2>
        <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 14 }}>
          Block builder, week/month/block views and recommended-session generation land in the next phase.
          Until then, log sessions as you do them — the engine maintains region freshness and stress budgets
          from real data, not the plan.
        </p>
        <div>
          <Link href="/app/sessions/new" className="cp-btn primary">Start a session</Link>
        </div>
      </section>
    </div>
  );
}
