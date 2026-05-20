import { getRegionFreshness, type FreshnessRow } from "@/lib/engine/freshness";

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
  const rows = await getRegionFreshness();
  const hasData = rows.length > 0 && rows.some((r) => r.atl > 0 || r.ctl > 0);

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
          DC-C14 region ledger · updates on session completion.
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

      {/* ── Volume vs landmarks (stub) ───────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          Weekly volume per muscle
          <span className="cp-info" tabIndex={0} aria-label="Landmark scale">
            i
            <span className="pop" style={{ width: 280 }}>
              <strong>MV</strong> — maintenance volume (just enough to maintain).<br />
              <strong>MEV</strong> — minimum effective volume (start growing here).<br />
              <strong>MAV</strong> — maximum adaptive volume (sweet spot).<br />
              <strong>MRV</strong> — maximum recoverable volume (above this, you regress).
            </span>
          </span>
        </h2>
        <p style={{ margin: "4px 0 0", color: "var(--cp-text-muted)", fontSize: 13 }}>
          Per-muscle weekly hard-set counts and landmark dots land in the next sprint. The math is already
          in <code className="mono">@hta/engine</code>; just needs a chart.
        </p>
      </section>
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
