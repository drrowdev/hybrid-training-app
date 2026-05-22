import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getMovementBySlug,
  getSetsForMovement,
  e1rmCurve,
  bucketWeeklyVolume,
  rpeHistogram,
  summarise,
  type E1rmPoint,
  type WeeklyVolumePoint,
} from "@/lib/stats/movement";
import { getUserTimezone } from "@/lib/planner/queries";
import type { TmChangeReason } from "@hta/db";

export default async function MovementDrillDownPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const movement = await getMovementBySlug(slug);
  if (!movement) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sets = await getSetsForMovement(movement.id);
  const tz = await getUserTimezone(user.id);
  const curve = e1rmCurve(sets);
  const weekly = bucketWeeklyVolume(sets, tz).slice(-12);
  const hist = rpeHistogram(sets);
  const stats = summarise(sets);
  const recent = [...sets].reverse().slice(0, 12);

  // TM history for this movement — most recent first for the chart.
  const { data: tmHistoryRows } = await supabase
    .from("tm_history")
    .select("id, old_tm_kg, new_tm_kg, reason, changed_at")
    .eq("user_id", user.id)
    .eq("movement_id", movement.id)
    .order("changed_at", { ascending: true });
  const tmHistory = (tmHistoryRows ?? []).map((r) => ({
    id: r.id,
    oldTm: r.old_tm_kg != null ? Number(r.old_tm_kg) : null,
    newTm: Number(r.new_tm_kg),
    reason: r.reason as TmChangeReason,
    changedAt: r.changed_at as string,
  }));

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <Link href="/app/stats" style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}>
          ← all stats
        </Link>
        <h1 style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>{movement.display_name}</h1>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 4 }}>
          {movement.primary_region.replace(/_/g, " ")} · {movement.is_compound ? "compound" : "isolation"}
          {stats.lastPerformed && (
            <> · last logged {new Date(stats.lastPerformed).toLocaleDateString()}</>
          )}
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <Tile label="Best e1RM" value={stats.bestE1rm != null ? `${stats.bestE1rm} kg` : "—"} sub="Epley estimate" />
        <Tile label="Heaviest single" value={stats.heaviestSingle ? `${stats.heaviestSingle} kg` : "—"} sub="actual 1-rep" />
        <Tile label="Total sets" value={stats.totalSets.toString()} />
        <Tile label="Total volume" value={`${stats.totalVolume.toLocaleString()} kg`} sub="∑ weight × reps" />
      </div>

      {sets.length === 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 13 }}>
            No completed sets for this movement yet. Log a session to see trends here.
          </p>
        </section>
      )}

      {tmHistory.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Training max history</h2>
          <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
            How your TM has moved over time. Color-coded by what triggered the change.
          </p>
          <TmHistoryChart rows={tmHistory} />
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 4 }}>
            {[...tmHistory].reverse().slice(0, 6).map((row) => (
              <li
                key={row.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  padding: "6px 10px",
                  background: "var(--cp-surface-soft)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: tmReasonColor(row.reason),
                    }}
                  />
                  <span>{tmReasonLabel(row.reason)}</span>
                </span>
                <span className="mono" style={{ color: "var(--cp-text)" }}>
                  {row.oldTm != null ? `${row.oldTm.toFixed(1)} → ` : ""}{row.newTm.toFixed(1)} kg
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                  {new Date(row.changedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {curve.length > 1 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>e1RM trend</h2>
          <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
            Estimated one-rep max per logged set. Higher = stronger over the same rep range.
          </p>
          <E1rmChart points={curve} />
        </section>
      )}

      {weekly.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Weekly volume (last 12 weeks)</h2>
          <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
            Sum of weight × reps per ISO week.
          </p>
          <WeeklyBars points={weekly} />
        </section>
      )}

      {hist.some((h) => h.count > 0) && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>RPE distribution</h2>
          <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
            Where this movement lives on the intensity scale.
          </p>
          <RpeHist hist={hist} />
        </section>
      )}

      {recent.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Recent sets</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
            <thead>
              <tr style={{ color: "var(--cp-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <th style={{ padding: "6px 8px 6px 0", textAlign: "left", fontWeight: 500 }}>Date</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 500 }}>Weight × reps</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 500 }}>Kind</th>
                <th style={{ padding: "6px 0 6px 8px", textAlign: "right", fontWeight: 500 }}>RPE / e1RM</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((s) => {
                const e1 = s.reps === 1 ? s.weight_kg : Math.round(s.weight_kg * (1 + s.reps / 30) * 10) / 10;
                return (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--cp-border)" }}>
                    <td style={{ padding: "8px 8px 8px 0" }}>{new Date(s.performed_at).toLocaleDateString()}</td>
                    <td className="mono" style={{ padding: "8px 8px" }}>
                      {s.weight_kg} kg × {s.reps}
                    </td>
                    <td style={{ padding: "8px 8px", color: "var(--cp-text-muted)" }}>{s.set_kind.replace("_", " ")}</td>
                    <td className="mono" style={{ padding: "8px 0 8px 8px", textAlign: "right", color: "var(--cp-text-muted)" }}>
                      {s.rpe ? `@ ${s.rpe}` : "—"} · {e1} kg
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="cp-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 10, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4, letterSpacing: "-0.01em" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--cp-text-muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function E1rmChart({ points }: { points: E1rmPoint[] }) {
  const w = 600;
  const h = 180;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const min = Math.min(...points.map((p) => p.e1rm));
  const max = Math.max(...points.map((p) => p.e1rm));
  const span = max - min || 1;
  const yPad = span * 0.1;
  const yMin = Math.max(0, min - yPad);
  const yMax = max + yPad;
  const x = (i: number) => padL + ((w - padL - padR) * i) / Math.max(1, points.length - 1);
  const y = (v: number) => padT + (h - padT - padB) * (1 - (v - yMin) / (yMax - yMin));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.e1rm)}`).join(" ");
  const firstDate = points[0]!.date;
  const lastDate = points[points.length - 1]!.date;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }} aria-label="e1RM trend">
      <line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} stroke="var(--cp-border)" />
      <line x1={padL} x2={padL} y1={padT} y2={h - padB} stroke="var(--cp-border)" />
      <text x={padL - 6} y={padT + 4} textAnchor="end" fontSize="10" fill="var(--cp-text-muted)">{Math.round(yMax)}</text>
      <text x={padL - 6} y={h - padB} textAnchor="end" fontSize="10" fill="var(--cp-text-muted)">{Math.round(yMin)}</text>
      <text x={padL} y={h - 6} textAnchor="start" fontSize="10" fill="var(--cp-text-muted)">{firstDate}</text>
      <text x={w - padR} y={h - 6} textAnchor="end" fontSize="10" fill="var(--cp-text-muted)">{lastDate}</text>
      <path d={path} fill="none" stroke="var(--cp-accent)" strokeWidth="2" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.e1rm)} r={2.5} fill="var(--cp-accent)" />
      ))}
    </svg>
  );
}

function WeeklyBars({ points }: { points: WeeklyVolumePoint[] }) {
  const max = Math.max(...points.map((p) => p.volume), 1);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${points.length}, 1fr)`, gap: 4, alignItems: "end", height: 140 }}>
      {points.map((p) => {
        const h = (p.volume / max) * 100;
        return (
          <div key={p.weekStart} title={`${p.weekStart}: ${p.volume.toLocaleString()} kg · ${p.sets} sets`} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
            <div style={{ width: "100%", height: `${h}%`, minHeight: 2, background: "var(--cp-accent)", opacity: 0.85, borderRadius: "4px 4px 0 0" }} />
            <div className="mono" style={{ fontSize: 9, color: "var(--cp-text-muted)" }}>{p.weekStart.slice(5)}</div>
          </div>
        );
      })}
    </div>
  );
}

function RpeHist({ hist }: { hist: { rpe: number; count: number }[] }) {
  const max = Math.max(...hist.map((h) => h.count), 1);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 6, alignItems: "end", height: 110 }}>
      {hist.map((h) => {
        const hh = (h.count / max) * 100;
        return (
          <div key={h.rpe} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ width: "100%", height: `${Math.max(2, hh)}%`, minHeight: 2, background: h.count ? "var(--cp-accent)" : "var(--cp-surface-soft)", opacity: h.count ? 0.85 : 1, borderRadius: "4px 4px 0 0" }} />
            <div className="mono" style={{ fontSize: 10, color: "var(--cp-text-muted)" }}>{h.rpe}</div>
            <div className="mono" style={{ fontSize: 9, color: "var(--cp-text-muted)" }}>{h.count}</div>
          </div>
        );
      })}
    </div>
  );
}

type TmHistoryRow = {
  id: string;
  oldTm: number | null;
  newTm: number;
  reason: string;
  changedAt: string;
};

function tmReasonLabel(reason: string): string {
  switch (reason) {
    case "manual": return "Manual edit";
    case "pr_detection": return "PR-driven";
    case "amrap_bump": return "AMRAP bump";
    case "block_complete": return "Block complete";
    case "deload": return "Deload";
    case "onboarding": return "Initial value";
    default: return reason;
  }
}

function tmReasonColor(reason: string): string {
  switch (reason) {
    case "manual": return "var(--cp-text-muted)";
    case "pr_detection": return "var(--cp-accent)";
    case "amrap_bump": return "var(--cp-accent)";
    case "block_complete": return "var(--cp-success)";
    case "deload": return "var(--cp-warning)";
    case "onboarding": return "var(--cp-border-strong)";
    default: return "var(--cp-text-muted)";
  }
}

function TmHistoryChart({ rows }: { rows: TmHistoryRow[] }) {
  if (rows.length === 0) return null;
  const w = 600;
  const h = 140;
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 24;

  const tms = rows.map((r) => r.newTm);
  const minTm = Math.min(...tms);
  const maxTm = Math.max(...tms);
  const range = maxTm - minTm || 1;
  const padded = range * 0.15;
  const yMin = Math.max(0, minTm - padded);
  const yMax = maxTm + padded;

  const xAt = (i: number) => padL + (i / Math.max(1, rows.length - 1)) * (w - padL - padR);
  const yAt = (tm: number) => padT + (1 - (tm - yMin) / (yMax - yMin)) * (h - padT - padB);

  const linePath = rows
    .map((r, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(r.newTm)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="auto" role="img" aria-label="TM history chart">
      <line x1={padL} y1={h - padB} x2={w - padR} y2={h - padB} stroke="var(--cp-border)" />
      <text x={4} y={padT + 6} fontSize="10" fill="var(--cp-text-muted)">{yMax.toFixed(0)} kg</text>
      <text x={4} y={h - padB} fontSize="10" fill="var(--cp-text-muted)">{yMin.toFixed(0)} kg</text>
      <text x={padL} y={h - 6} fontSize="10" fill="var(--cp-text-muted)">
        {new Date(rows[0]!.changedAt).toLocaleDateString()}
      </text>
      <text x={w - padR} y={h - 6} textAnchor="end" fontSize="10" fill="var(--cp-text-muted)">
        {new Date(rows[rows.length - 1]!.changedAt).toLocaleDateString()}
      </text>
      <path d={linePath} fill="none" stroke="var(--cp-text-muted)" strokeWidth="1.5" opacity="0.7" />
      {rows.map((r, i) => (
        <circle
          key={r.id}
          cx={xAt(i)}
          cy={yAt(r.newTm)}
          r={4}
          fill={tmReasonColor(r.reason)}
          stroke="var(--cp-bg)"
          strokeWidth="1.5"
        >
          <title>{tmReasonLabel(r.reason)}: {r.newTm.toFixed(1)} kg ({new Date(r.changedAt).toLocaleDateString()})</title>
        </circle>
      ))}
    </svg>
  );
}
