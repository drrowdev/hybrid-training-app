import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMovementsRanked } from "@/lib/stats/movement";
import { BAND_COLOR, BAND_LABEL, getWeeklyMuscleVolume } from "@/lib/stats/muscle-volume";
import { formatHitValue, getRecentPrs } from "@/lib/stats/pr-queries";
import { PR_KIND_LABEL } from "@/lib/engine/pr";

export default async function StatsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: all } = await supabase
    .from("sessions")
    .select("id, title, slot, performed_at, completed_at, session_rpe, duration_min")
    .order("performed_at", { ascending: false })
    .limit(40);

  const completed = (all ?? []).filter((s) => s.completed_at);
  const total = completed.length;
  const last30 = completed.filter(
    // eslint-disable-next-line react-hooks/purity -- server-rendered "30 days ago" anchor
    (s) => Date.now() - new Date(s.performed_at).getTime() < 30 * 86_400_000,
  ).length;
  const rpeSamples = completed.filter((s) => s.session_rpe);
  const avgRpe = rpeSamples.length
    ? rpeSamples.reduce((a, s) => a + (s.session_rpe ?? 0), 0) / rpeSamples.length
    : 0;

  // Two-a-day breakdown over the last 30 days. Useful at-a-glance signal for
  // whether the AM/PM rhythm is actually landing.
  // eslint-disable-next-line react-hooks/purity -- server-rendered "30 days ago" anchor
  const thirtyDaysAgoMs = Date.now() - 30 * 86_400_000;
  const twoADayLast30 = completed.filter((s) => {
    if (s.slot !== "am" && s.slot !== "pm") return false;
    return new Date(s.performed_at).getTime() >= thirtyDaysAgoMs;
  }).length;
  const amCount = completed.filter((s) => s.slot === "am").length;
  const pmCount = completed.filter((s) => s.slot === "pm").length;

  const movements = await listMovementsRanked();
  const muscleVolume = await getWeeklyMuscleVolume(supabase, user.id);
  const recentPrs = await getRecentPrs(supabase, user.id, 5);

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

      {recentPrs.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Recent PRs</h2>
            <Link href="/app/stats/prs" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
              see all →
            </Link>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {recentPrs.map((p, i) => (
              <li
                key={`${p.sessionId}:${p.movementId}:${p.hit.kind}`}
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--cp-border)",
                  padding: "10px 0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 10,
                  fontSize: 13,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span aria-hidden="true">🏆</span>
                    <span style={{ fontWeight: 500 }}>{p.movementDisplayName}</span>
                    <span className="cp-pill" style={{ fontSize: 10 }}>{PR_KIND_LABEL[p.hit.kind]}</span>
                  </div>
                </div>
                <span className="mono" style={{ fontWeight: 600, color: "var(--cp-accent)", flexShrink: 0 }}>
                  {formatHitValue(p.hit, p.hit.kind)}
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)", flexShrink: 0 }}>
                  <Link href={`/app/sessions/${p.sessionId}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {new Date(p.sessionPerformedAt).toLocaleDateString()}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cp-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>This week by muscle</h2>
          <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
            {muscleVolume.totalSets} working sets · rolling 7 days
          </span>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
          One row per muscle. The bar shows working sets this week against the recommended range
          for that muscle.
          {muscleVolume.concurrentScaled && (
            <>
              {" "}
              <span style={{ color: "var(--cp-warning)", fontWeight: 600 }}>
                Cardio is heavy this week — recommended ranges pulled back so you don&apos;t outrun recovery.
              </span>
            </>
          )}
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {muscleVolume.rows.map((row) => (
            <MuscleRow key={row.muscle} row={row} />
          ))}
        </ul>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12, fontSize: 10, color: "var(--cp-text-muted)" }}>
          <LegendChip color="var(--cp-border)" label="Untouched" />
          <LegendChip color="var(--cp-danger)" label="Below maintenance / Too much" />
          <LegendChip color="var(--cp-warning)" label="Maintaining / High volume" />
          <LegendChip color="var(--cp-success)" label="Building" />
        </div>
      </section>

      {(amCount > 0 || pmCount > 0) && (
        <section className="cp-card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Two-a-day rhythm</h2>
            <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>{twoADayLast30} in last 30d</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--cp-border)",
                background: "var(--cp-surface-soft)",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                AM sessions
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{amCount}</div>
            </div>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--cp-border)",
                background: "var(--cp-surface-soft)",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                PM sessions
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{pmCount}</div>
            </div>
          </div>
        </section>
      )}

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

function MuscleRow({
  row,
}: {
  row: {
    muscle: string;
    label: string;
    sets: number;
    band: keyof typeof BAND_LABEL;
    thresholds: { maintenance: number; building: number; productive: number; limit: number };
  };
}) {
  const barMax = Math.max(row.thresholds.limit + 2, row.sets, 8);
  const pct = (n: number) => `${Math.min(100, (n / barMax) * 100)}%`;
  const fillPct = pct(row.sets);
  const buildingStart = pct(row.thresholds.building);
  const productiveEnd = pct(row.thresholds.productive);
  const limitEnd = pct(row.thresholds.limit);
  const color = BAND_COLOR[row.band];

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr 60px",
        alignItems: "center",
        gap: 10,
        fontSize: 12,
      }}
      title={`${row.label}: ${row.sets} sets · target range ${row.thresholds.building}-${row.thresholds.productive}`}
    >
      <div style={{ color: "var(--cp-text)", fontWeight: 500 }}>{row.label}</div>
      <div
        style={{
          position: "relative",
          height: 18,
          borderRadius: 6,
          background: "var(--cp-surface-soft)",
          overflow: "hidden",
        }}
      >
        {/* Target range band — muted green strip between building and productive. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: buildingStart,
            width: `calc(${productiveEnd} - ${buildingStart})`,
            top: 0,
            bottom: 0,
            background: "color-mix(in oklab, var(--cp-success) 18%, transparent)",
          }}
        />
        {/* Limit tick — where 'too much' starts. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: limitEnd,
            top: 0,
            bottom: 0,
            width: 1,
            background: "var(--cp-danger)",
            opacity: 0.5,
          }}
        />
        {/* Actual sets bar. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 4,
            bottom: 4,
            width: fillPct,
            background: color,
            borderRadius: 4,
            transition: "width 0.3s",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
        <span className="mono" style={{ fontWeight: 600, color: "var(--cp-text)" }}>
          {row.sets}
        </span>
        <span
          style={{
            fontSize: 9,
            color,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            display: "none",
          }}
        >
          {BAND_LABEL[row.band]}
        </span>
      </div>
    </li>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      <span>{label}</span>
    </span>
  );
}
