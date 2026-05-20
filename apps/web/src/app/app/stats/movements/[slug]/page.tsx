import Link from "next/link";
import { notFound } from "next/navigation";
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

export default async function MovementDrillDownPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const movement = await getMovementBySlug(slug);
  if (!movement) notFound();

  const sets = await getSetsForMovement(movement.id);
  const curve = e1rmCurve(sets);
  const weekly = bucketWeeklyVolume(sets).slice(-12);
  const hist = rpeHistogram(sets);
  const stats = summarise(sets);
  const recent = [...sets].reverse().slice(0, 12);

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
