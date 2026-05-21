import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getRegionFreshness, type FreshnessRow } from "@/lib/engine/freshness";
import { getBucketState, type BucketStateRow } from "@/lib/stats/bucket-state-queries";
import { getRpeDrift, type RpeDrift } from "@/lib/stats/rpe-drift-queries";
import { getCeilingUtilization, type CeilingUtilization } from "@/lib/stats/ceiling-queries";

// Plain-language status from freshness ratio.
function statusFor(f: number, lastLoadDate: string | null): string {
  const days = lastLoadDate
    ? Math.floor(
        (Date.now() - new Date(lastLoadDate + "T00:00:00").getTime()) / 86_400_000,
      )
    : null;
  if (f >= 0.85) return days != null && days < 1 ? "fresh" : "fully recovered";
  if (f >= 0.6) return "moderate";
  if (f >= 0.3) return days != null ? `loaded ${days}d ago` : "loaded";
  return days != null ? `heavily loaded ${days}d ago` : "heavily loaded";
}

function tone(f: number): string {
  if (f >= 0.7) return "var(--cp-success)";
  if (f >= 0.4) return "var(--cp-warning)";
  return "var(--cp-danger)";
}

// Group by anatomical region.
const REGION_GROUP: Record<string, "upper" | "core" | "lower"> = {
  foot_ankle_calf: "lower",
  knee: "lower",
  hamstring_posterior: "lower",
  adductor_groin: "lower",
  lumbar_trunk: "core",
  shoulder_scapular: "upper",
  elbow_forearm: "upper",
};

export default async function EngineStatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [rows, buckets, drift, ceiling] = await Promise.all([
    getRegionFreshness(),
    user ? getBucketState(supabase, user.id) : Promise.resolve([] as BucketStateRow[]),
    user ? getRpeDrift(supabase, user.id) : Promise.resolve(null as RpeDrift | null),
    user ? getCeilingUtilization(supabase, user.id) : Promise.resolve(null as CeilingUtilization | null),
  ]);
  const hasData = rows.length > 0 && rows.some((r) => r.atl > 0 || r.ctl > 0);
  const hasBucketData = buckets.some((b) => b.atl > 0 || b.ctl > 0);

  const grouped: Record<"upper" | "core" | "lower", FreshnessRow[]> = {
    upper: [],
    core: [],
    lower: [],
  };
  rows.forEach((r) => grouped[REGION_GROUP[r.region] ?? "core"].push(r));

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Stats · Engine state
        </div>
        <h1 style={{ fontSize: 28, margin: "4px 0 0", letterSpacing: "-0.01em" }}>
          What the engine sees
        </h1>
      </header>

      {/* ── Region freshness table ───────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          Region freshness
          <span
            className="cp-info"
            tabIndex={0}
            aria-label="How region freshness is computed"
          >
            i
            <span className="pop">
              Each region carries an <strong>acute load</strong> (last few days) divided by
              <strong> baseline tolerance</strong>. 100% = fully recovered, 0% = hammered.
              Drives recommendations and stops collisions between strength and cardio in the same area.
            </span>
          </span>
        </h2>
        <p style={{ margin: "4px 0 16px", color: "var(--cp-text-muted)", fontSize: 13 }}>
          Updates automatically after each completed session.
        </p>

        {!hasData ? (
          <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
            No data yet. Log and complete a session — region freshness materialises automatically.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {(["upper", "core", "lower"] as const).map((group) =>
              grouped[group].length === 0 ? null : (
                <RegionGroup key={group} title={GROUP_LABELS[group]} rows={grouped[group]} />
              ),
            )}
          </div>
        )}
      </section>

      {/* ── Ceiling utilization vs archetype ─────────────────── */}
      {ceiling && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            Ceiling utilization
            <span className="cp-info" tabIndex={0} aria-label="How ceiling utilization is computed">
              i
              <span className="pop" style={{ width: 260 }}>
                This week&apos;s actual work vs the active archetype&apos;s
                prescribed dose. 70–110% is the sweet spot.
              </span>
            </span>
          </h2>
          <p style={{ margin: "4px 0 12px", color: "var(--cp-text-muted)", fontSize: 13 }}>
            {ceiling.archetypeName} · {ceiling.weekLabel} (week {ceiling.weekIndex + 1})
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            <CeilingRow
              label="Strength"
              actual={ceiling.strength.actual}
              prescribed={ceiling.strength.prescribed}
              pct={ceiling.strength.pct}
              bandLabel={ceiling.strength.bandLabel}
              tone={ceilingTone(ceiling.strength.band)}
              unit="working sets"
            />
            <CeilingRow
              label="Cardio"
              actual={ceiling.cardio.actual}
              prescribed={ceiling.cardio.prescribed}
              pct={ceiling.cardio.pct}
              bandLabel={ceiling.cardio.bandLabel}
              tone={ceilingTone(ceiling.cardio.band)}
              unit="sessions"
            />
          </div>
        </section>
      )}

      {/* ── RPE drift over last 28 days ──────────────────────── */}
      {drift && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            How hard sessions have felt
            <span className="cp-info" tabIndex={0} aria-label="How RPE drift is computed">
              i
              <span className="pop" style={{ width: 260 }}>
                Trend of session RPE across the last 28 days. Same work
                feeling harder is a leading sign you need a lighter week.
              </span>
            </span>
          </h2>
          <RpeDriftView drift={drift} />
        </section>
      )}

      {/* ── Bucket load — six-bucket stress model ───────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          Bucket load
          <span className="cp-info" tabIndex={0} aria-label="How bucket load is computed">
            i
            <span className="pop" style={{ width: 280 }}>
              Six global stress dimensions. Each set + cardio block contributes
              load to each bucket based on movement type, intensity, and reps.
              Same recovery-ratio math as region freshness.
            </span>
          </span>
        </h2>
        <p style={{ margin: "4px 0 16px", color: "var(--cp-text-muted)", fontSize: 13 }}>
          Where on your body the load is concentrated. Different from regions —
          regions are anatomy; buckets are the type of stress.
        </p>
        {!hasBucketData ? (
          <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
            Log a few sessions and bucket load will materialise here.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {buckets.map((b) => (
              <BucketRow key={b.bucket} row={b} />
            ))}
          </ul>
        )}
      </section>

      {/* ── Volume vs landmarks ──────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Weekly volume per muscle</h2>
        <p style={{ margin: "4px 0 0", color: "var(--cp-text-muted)", fontSize: 13 }}>
          Per-muscle weekly hard-set counts live on the{" "}
          <Link href="/app/stats" style={{ color: "var(--cp-link)" }}>Stats overview</Link>.
        </p>
      </section>
    </div>
  );
}

function bucketTone(tone: "ok" | "caution" | "warn"): string {
  if (tone === "ok") return "var(--cp-success)";
  if (tone === "caution") return "var(--cp-warning)";
  return "var(--cp-danger)";
}

function BucketRow({ row }: { row: BucketStateRow }) {
  const pct = Math.round(row.freshness * 100);
  const color = bucketTone(row.tone);
  return (
    <li
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface)",
        display: "grid",
        gap: 6,
      }}
      title={`${row.label}: freshness ${pct}% · ATL ${row.atl.toFixed(0)} · CTL ${row.ctl.toFixed(0)}`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{row.label}</div>
        <span style={{ fontSize: 12, color, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: color, display: "inline-block" }} />
          {row.bandLabel}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>{row.description}</div>
      <div style={{ height: 6, borderRadius: 999, background: "var(--cp-surface-soft)", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            transition: "width .3s",
          }}
        />
      </div>
    </li>
  );
}

function driftTone(verdict: RpeDrift["verdict"]): string {
  if (verdict === "rising") return "var(--cp-warning)";
  if (verdict === "easing") return "var(--cp-link)";
  if (verdict === "stable") return "var(--cp-success)";
  return "var(--cp-text-muted)";
}

function RpeDriftView({ drift }: { drift: RpeDrift }) {
  if (drift.verdict === "no-data") {
    return (
      <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: "8px 0 0" }}>
        {drift.verdictLabel}.
      </p>
    );
  }
  const color = driftTone(drift.verdict);
  const minRpe = Math.min(4, ...drift.points.map((p) => p.rpe));
  const maxRpe = Math.max(10, ...drift.points.map((p) => p.rpe));
  const range = Math.max(0.1, maxRpe - minRpe);
  const t0 = new Date(drift.points[0]!.date + "T00:00:00").getTime();
  const tN = new Date(drift.points[drift.points.length - 1]!.date + "T00:00:00").getTime();
  const span = Math.max(1, tN - t0);
  const w = 600;
  const h = 60;
  const pad = 4;
  const linePoints = drift.points
    .map((p) => {
      const t = new Date(p.date + "T00:00:00").getTime();
      const x = pad + ((t - t0) / span) * (w - pad * 2);
      const y = pad + (1 - (p.rpe - minRpe) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  // Trend line endpoints from slope through the mean.
  const meanY =
    pad + (1 - ((drift.meanRpe ?? 7) - minRpe) / range) * (h - pad * 2);
  const slopePerPixel = -drift.slopePerDay * (span / 86_400_000) * ((h - pad * 2) / range) / (w - pad * 2);
  const trendY0 = meanY + slopePerPixel * ((w - pad * 2) / 2);
  const trendY1 = meanY - slopePerPixel * ((w - pad * 2) / 2);
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color }}>{drift.verdictLabel}</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          mean {drift.meanRpe?.toFixed(1) ?? "—"} sRPE
        </span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 60, background: "var(--cp-surface-soft)", borderRadius: 8 }}
        role="img"
        aria-label="Session RPE drift over the last 28 days"
      >
        <polyline points={linePoints} fill="none" stroke="var(--cp-text-muted)" strokeWidth={1.2} />
        {drift.points.map((p, i) => {
          const t = new Date(p.date + "T00:00:00").getTime();
          const x = pad + ((t - t0) / span) * (w - pad * 2);
          const y = pad + (1 - (p.rpe - minRpe) / range) * (h - pad * 2);
          return <circle key={i} cx={x} cy={y} r={1.8} fill="var(--cp-text)" />;
        })}
        <line x1={pad} y1={trendY0} x2={w - pad} y2={trendY1} stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
      </svg>
      <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
        {drift.points.length} session{drift.points.length === 1 ? "" : "s"} · slope{" "}
        {drift.slopePerDay >= 0 ? "+" : ""}
        {(drift.slopePerDay * 7).toFixed(2)} sRPE/week
      </div>
    </div>
  );
}

const GROUP_LABELS = {
  upper: "Upper body",
  core: "Core / trunk",
  lower: "Lower body",
} as const;

function RegionGroup({ title, rows }: { title: string; rows: FreshnessRow[] }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
        {title}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {rows.map((r) => {
            const pct = Math.round(r.freshness * 100);
            return (
              <tr key={r.region} style={{ borderTop: "1px solid var(--cp-border)" }}>
                <td style={{ padding: "10px 8px 10px 0", fontSize: 13, fontWeight: 500 }}>{r.label}</td>
                <td style={{ padding: "10px 8px", minWidth: 90 }}>
                  <div style={{ height: 8, borderRadius: 999, background: "var(--cp-surface-soft)", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: tone(r.freshness),
                        transition: "width .3s",
                      }}
                    />
                  </div>
                </td>
                <td className="mono" style={{ padding: "10px 8px", width: 44, textAlign: "right", fontSize: 12, color: "var(--cp-text-muted)" }}>
                  {pct}%
                </td>
                <td style={{ padding: "10px 0 10px 8px", fontSize: 12, color: "var(--cp-text-muted)", textAlign: "right", whiteSpace: "nowrap" }}>
                  {statusFor(r.freshness, r.lastLoadDate)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ceilingTone(band: string): string {
  if (band === "under") return "var(--cp-link)";
  if (band === "on-budget") return "var(--cp-success)";
  if (band === "at-line") return "var(--cp-warning)";
  return "var(--cp-danger)";
}

function CeilingRow({
  label,
  actual,
  prescribed,
  pct,
  bandLabel,
  tone,
  unit,
}: {
  label: string;
  actual: number;
  prescribed: number;
  pct: number;
  bandLabel: string;
  tone: string;
  unit: string;
}) {
  const widthPct = Math.min(150, pct * 100);
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface)",
        display: "grid",
        gap: 6,
      }}
      title={`${label}: ${actual} ${unit} vs ${prescribed} prescribed = ${(pct * 100).toFixed(0)}%`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
            {actual} / {prescribed} {unit}
          </span>
          <span style={{ fontSize: 12, color: tone, fontWeight: 600 }}>{bandLabel}</span>
        </div>
      </div>
      <div style={{ position: "relative", height: 6, borderRadius: 999, background: "var(--cp-surface-soft)", overflow: "hidden" }}>
        {/* 100% reference tick */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "66.67%",
            top: 0,
            bottom: 0,
            width: 1,
            background: "var(--cp-border-strong)",
          }}
        />
        <div
          style={{
            width: `${(widthPct / 150) * 100}%`,
            height: "100%",
            background: tone,
            transition: "width .3s",
          }}
        />
      </div>
    </div>
  );
}
