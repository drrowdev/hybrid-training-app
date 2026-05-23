/**
 * /app/stats/engine — Phase 6 refresh.
 *
 * "How the planner sees you." Seven sections, mobile-first stack, all
 * read-only views over the engine's live state:
 *
 *   A · Header + decision trace (DC-K4 transparency)
 *   B · Region freshness expanded with MV/MEV/MAV/MRV bands (DC-C14, DC-M1)
 *   C · Bucket pressure meters (DC-C2)
 *   D · Ceiling equation explainer (DC-C11, DC-C13)
 *   E · User tier (DC-G1..G6)
 *   F · Recent overrides (DC-K4 audit trail)
 *   G · Engine internals — version + last computation timestamp
 *
 * No new engine logic; this surface only reads from helpers in
 * `lib/stats/engine.ts` and the existing region/bucket ledgers.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import {
  getDecisionTrace,
  getRegionFreshnessDetail,
  getBucketPressure,
  getCeilingExplain,
  getUserTier,
  getRecentOverrides,
  getEngineInternals,
  FRESHNESS_THRESHOLD_LABELS,
  type DecisionTrace,
  type RegionFreshnessDetail,
  type BucketPressureRow,
  type CeilingExplain,
  type UserTierState,
  type OverrideEvent,
  type EngineInternals,
} from "@/lib/stats/engine";
import { MiniLine } from "@/components/stats/charts/MiniLine";
import { PressureMeter, pressureTone } from "@/components/stats/charts/PressureMeter";

export const dynamic = "force-dynamic";

export default async function EnginePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const tz = profile?.timezone ?? (await getUserTimezone(user.id));

  const [trace, regions, buckets, ceiling, tier, overrides, internals] = await Promise.all([
    getDecisionTrace(supabase, user.id, tz),
    getRegionFreshnessDetail(supabase, user.id, tz),
    getBucketPressure(supabase, user.id, tz),
    getCeilingExplain(supabase, user.id),
    getUserTier(supabase, user.id),
    getRecentOverrides(supabase, user.id, 10),
    getEngineInternals(supabase, user.id),
  ]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header data-testid="stats-engine-header">
        <Link
          href="/app/stats"
          data-testid="stats-engine-back"
          style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
        >
          ← stats
        </Link>
        <h1 style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          How the planner sees you
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          Plain-language explanation of why today&apos;s session is what it is.
        </p>
      </header>

      <DecisionTraceCard trace={trace} />
      <RegionFreshnessCard regions={regions} />
      <BucketPressureCard buckets={buckets} />
      <CeilingExplainerCard ceiling={ceiling} />
      <UserTierCard tier={tier} />
      <RecentOverridesCard overrides={overrides.events} notTracked={overrides.notTracked} />
      <EngineInternalsCard internals={internals} />
    </div>
  );
}

// ─── A · Decision trace ────────────────────────────────────────────

function DecisionTraceCard({ trace }: { trace: DecisionTrace }) {
  return (
    <section
      className="cp-card"
      data-testid="stats-engine-decision-trace"
      style={{
        padding: 20,
        background: "var(--cp-surface-raised)",
        borderColor: "var(--cp-accent)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--cp-accent)",
          fontWeight: 600,
        }}
      >
        Decision trace · DC-K4
      </div>
      <h2
        data-testid="stats-engine-decision-headline"
        style={{ fontSize: 20, margin: "6px 0 12px", letterSpacing: "-0.01em" }}
      >
        {trace.headline}
      </h2>
      {trace.reasons.length > 0 && (
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Chosen because:
        </div>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        {trace.reasons.map((r, i) => (
          <li
            key={i}
            data-testid="stats-engine-decision-reason"
            style={{
              fontSize: 14,
              lineHeight: 1.5,
              paddingLeft: 18,
              position: "relative",
              color: "var(--cp-text)",
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: 0,
                top: 8,
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--cp-accent)",
              }}
            />
            {r.text}
            {r.cite && (
              <span
                className="mono"
                style={{ marginLeft: 6, fontSize: 11, color: "var(--cp-text-muted)" }}
              >
                ({r.cite})
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── B · Region freshness ──────────────────────────────────────────

function RegionFreshnessCard({ regions }: { regions: RegionFreshnessDetail[] }) {
  const empty = regions.length === 0;
  return (
    <section
      className="cp-card"
      data-testid="stats-engine-regions"
      data-empty={empty ? "true" : "false"}
      style={{ padding: 20 }}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>
        Region freshness
        <span
          className="cp-info"
          tabIndex={0}
          aria-label="How region freshness is computed"
        >
          i
          <span className="pop" style={{ width: 280 }}>
            <strong>MEV</strong> = minimum effective volume ·{" "}
            <strong>MAV</strong> = maximum adaptive volume ·{" "}
            <strong>MRV</strong> = maximum recoverable volume (Israetel /
            Schoenfeld). Bands shown on a freshness axis: above MEV =
            productive, below MRV = overstrained. DC-C14 / DC-M1.
          </span>
        </span>
      </h2>
      <p style={{ margin: "4px 0 16px", color: "var(--cp-text-muted)", fontSize: 13 }}>
        Per-region freshness over the last 14 days, with MV / MEV / MAV /
        MRV reference lines.
      </p>
      {empty ? (
        <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
          No region load yet. Log a completed session and freshness will
          materialise here.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {regions.map((r) => (
            <RegionRow key={r.region} row={r} />
          ))}
        </div>
      )}
    </section>
  );
}

function computeDaysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso + "T00:00:00").getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function RegionRow({ row }: { row: RegionFreshnessDetail }) {
  const pct = Math.round(row.currentFreshness * 100);
  const tone =
    row.currentFreshness >= 0.7
      ? "var(--cp-success)"
      : row.currentFreshness >= 0.4
        ? "var(--cp-warning)"
        : "var(--cp-danger)";
  const daysSinceLast = computeDaysSince(row.lastLoadDate);
  return (
    <div
      data-testid="stats-engine-region-row"
      data-region={row.region}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface)",
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{row.label}</div>
        <span
          className="mono"
          style={{ fontSize: 12, color: tone, fontWeight: 600 }}
        >
          {pct}% fresh
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "var(--cp-surface-soft)", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: tone,
            transition: "width .3s",
          }}
        />
      </div>
      <div style={{ overflowX: "auto" }}>
        <MiniLine
          values={row.history}
          height={60}
          accent="accent"
          thresholds={FRESHNESS_THRESHOLD_LABELS.map((t) => ({
            value: t.value,
            label: t.label,
          }))}
          ariaLabel={`14-day freshness history for ${row.label}`}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          fontSize: 11,
          color: "var(--cp-text-muted)",
        }}
      >
        <span>
          Last hit:{" "}
          {daysSinceLast == null
            ? "—"
            : daysSinceLast === 0
              ? "today"
              : `${daysSinceLast}d ago`}
        </span>
        <span>
          Loaded days · 7d {row.setCounts.d7} / 14d {row.setCounts.d14} / 28d{" "}
          {row.setCounts.d28}
        </span>
      </div>
    </div>
  );
}

// ─── C · Bucket pressure ───────────────────────────────────────────

function BucketPressureCard({ buckets }: { buckets: BucketPressureRow[] }) {
  const hasData = buckets.some((b) => b.atl > 0 || b.ctl > 0);
  return (
    <section
      className="cp-card"
      data-testid="stats-engine-buckets"
      data-empty={hasData ? "false" : "true"}
      style={{ padding: 20 }}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>
        Stress budget
        <span className="cp-info" tabIndex={0} aria-label="How bucket pressure is computed">
          i
          <span className="pop" style={{ width: 280 }}>
            Six global stress buckets per DC-A3. Each bucket&apos;s current
            7-day EWMA is compared to its 28-day chronic norm — the closer
            to 100% of ceiling, the less headroom you have. DC-C2.
          </span>
        </span>
      </h2>
      <p style={{ margin: "4px 0 16px", color: "var(--cp-text-muted)", fontSize: 13 }}>
        Where the load is concentrated, and how close each bucket is to its
        own ceiling. Different from regions — regions are anatomy; buckets
        are the type of stress.
      </p>
      {!hasData ? (
        <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
          Log a few sessions and bucket pressure will materialise here.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          {buckets.map((b) => (
            <BucketRow key={b.bucket} row={b} />
          ))}
        </ul>
      )}
    </section>
  );
}

function BucketRow({ row }: { row: BucketPressureRow }) {
  const tone = pressureTone(row.percentOfCeiling);
  const toneColor =
    tone === "ok"
      ? "var(--cp-success)"
      : tone === "danger"
        ? "var(--cp-danger)"
        : "var(--cp-warning)";
  const label =
    row.percentOfCeiling < 0.7
      ? "Low pressure"
      : row.percentOfCeiling < 0.9
        ? "Approaching ceiling"
        : row.percentOfCeiling < 1.1
          ? "At the line"
          : "Over ceiling";
  return (
    <li
      data-testid="stats-engine-bucket-row"
      data-bucket={row.bucket}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface)",
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {row.label}
          <span
            className="cp-info"
            tabIndex={0}
            aria-label={`Why: ${row.label}`}
            data-testid="stats-engine-bucket-why"
          >
            ?
            <span className="pop" style={{ width: 280 }} data-testid="stats-engine-bucket-why-pop">
              {row.why}
            </span>
          </span>
        </div>
        <span
          className="mono"
          style={{ fontSize: 12, color: toneColor, fontWeight: 600 }}
        >
          {Math.round(row.percentOfCeiling * 100)}% · {label}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>{row.description}</div>
      <PressureMeter
        value={row.percentOfCeiling}
        marks={[
          { at: 0.7, label: "70% — leaving the safe zone" },
          { at: 0.9, label: "90% — approaching ceiling" },
          { at: 1.0, label: "Ceiling" },
        ]}
        ariaLabel={`${row.label} pressure: ${Math.round(row.percentOfCeiling * 100)}% of ceiling`}
      />
    </li>
  );
}

// ─── D · Ceiling explainer ─────────────────────────────────────────

function CeilingExplainerCard({ ceiling }: { ceiling: CeilingExplain }) {
  return (
    <section
      className="cp-card"
      data-testid="stats-engine-ceiling"
      style={{ padding: 20 }}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>
        Your ceiling this week
        <span className="cp-info" tabIndex={0} aria-label="How the ceiling is computed">
          i
          <span className="pop" style={{ width: 280 }}>
            Final ceiling = base × GRM × confidence (DC-C11 simplified).
            Base = median of your last 3 recovered weeks (DC-C9). Confidence
            bias compresses the ceiling when data is sparse (DC-C13) so the
            engine projects conservatively instead of pretending you&apos;re
            fresh.
          </span>
        </span>
      </h2>
      <p style={{ margin: "4px 0 16px", color: "var(--cp-text-muted)", fontSize: 13 }}>
        Plain-language render of the engine&apos;s ceiling equation —
        inputs you can see, output the engine actually uses.
      </p>

      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "var(--cp-surface-soft)",
          border: "1px solid var(--cp-border)",
          display: "grid",
          gap: 8,
          fontSize: 13,
        }}
      >
        <CeilingInputRow
          label="Base ceiling"
          value={ceiling.baseCeiling.toFixed(1)}
          unit="sessions/wk"
          cite="DC-C9"
          help="Median dose of your last recovered weeks."
        />
        <CeilingInputRow
          label="Recovery multiplier (GRM)"
          value={ceiling.recoveryMultiplier.toFixed(2)}
          unit="×"
          cite="DC-C5"
          help="Compresses the ceiling when wellness signals dip. MVP = 1.0 until DC-P2/DC-P3 inputs land."
        />
        <CeilingInputRow
          label="Confidence bias"
          value={ceiling.confidenceBias.toFixed(2)}
          unit="×"
          cite="DC-C13"
          help={`Data completeness ${(ceiling.inputs.dataCompleteness * 100).toFixed(0)}% over the last 28 days.`}
        />
        <div
          style={{
            borderTop: "1px dashed var(--cp-border)",
            marginTop: 4,
            paddingTop: 8,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <span style={{ fontWeight: 600 }}>This week&apos;s ceiling</span>
          <span
            className="mono"
            data-testid="stats-engine-ceiling-final"
            style={{ fontWeight: 700, color: "var(--cp-accent)", fontSize: 18 }}
          >
            ≈ {ceiling.finalCeiling.toFixed(1)} hard sessions
          </span>
        </div>
      </div>

      <ul
        style={{
          margin: "12px 0 0",
          padding: 0,
          listStyle: "none",
          display: "grid",
          gap: 4,
          fontSize: 11,
          color: "var(--cp-text-muted)",
        }}
      >
        {ceiling.inputs.notes.map((n, i) => (
          <li key={i}>· {n}</li>
        ))}
      </ul>
    </section>
  );
}

function CeilingInputRow({
  label,
  value,
  unit,
  cite,
  help,
}: {
  label: string;
  value: string;
  unit: string;
  cite: string;
  help: string;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {label}{" "}
          <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
            ({cite})
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>{help}</div>
      </div>
      <div
        className="mono"
        style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}
      >
        {value} {unit}
      </div>
    </div>
  );
}

// ─── E · User tier ─────────────────────────────────────────────────

function UserTierCard({ tier }: { tier: UserTierState }) {
  return (
    <section
      className="cp-card"
      data-testid="stats-engine-tier"
      data-tier={tier.tier}
      style={{ padding: 20 }}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>
        Your tier
        <span className="cp-info" tabIndex={0} aria-label="How tier is computed">
          i
          <span className="pop" style={{ width: 280 }}>
            DC-G1: tier is behavioural, not declared. Inferred from anchor
            compliance, session completion, schedule regularity, and
            recovery-input consistency over the last 56 days. DC-G3
            thresholds: consumer 0–49, intermediate 50–74, high-performance
            75–100.
          </span>
        </span>
      </h2>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, margin: "8px 0" }}>
        <div>
          <div
            data-testid="stats-engine-tier-label"
            style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}
          >
            {tier.tierLabel}
          </div>
          <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
            {tier.description}
          </div>
        </div>
        <div
          className="mono"
          style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
        >
          BTS {tier.bts}/100
          {tier.isColdStart && " · cold-start default (DC-G5)"}
        </div>
      </div>
      {tier.sessionsUntilNextTier != null && (
        <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
          Sessions until next tier: ~{tier.sessionsUntilNextTier} (volume +
          completion thresholds, DC-G3).
        </div>
      )}
      <details
        style={{
          marginTop: 10,
          fontSize: 12,
          color: "var(--cp-text-muted)",
        }}
      >
        <summary style={{ cursor: "pointer", color: "var(--cp-text)" }}>
          How is this computed?
        </summary>
        <p style={{ margin: "8px 0 0", lineHeight: 1.5 }}>{tier.explanation}</p>
      </details>
    </section>
  );
}

// ─── F · Recent overrides ──────────────────────────────────────────

function RecentOverridesCard({
  overrides,
  notTracked,
}: {
  overrides: OverrideEvent[];
  notTracked: boolean;
}) {
  return (
    <section
      className="cp-card"
      data-testid="stats-engine-overrides"
      data-empty={notTracked ? "true" : "false"}
      style={{ padding: 20 }}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>
        Recent overrides
        <span className="cp-info" tabIndex={0} aria-label="What counts as an override">
          i
          <span className="pop" style={{ width: 280 }}>
            DC-K4 — when you override an engine recommendation, the engine
            records it and surfaces it here. Today this captures skips and
            movement swaps. A dedicated override-audit table is deferred to
            a later phase.
          </span>
        </span>
      </h2>
      <p style={{ margin: "4px 0 12px", color: "var(--cp-text-muted)", fontSize: 13 }}>
        Last 10 cases where you took a different action than the engine
        recommended.
      </p>
      {notTracked ? (
        <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
          No overrides logged yet. Skips and movement swaps will appear here
          as you use the planner.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {overrides.map((o, i) => (
            <li
              key={i}
              data-testid="stats-engine-override-row"
              data-kind={o.kind}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--cp-border)",
                background: "var(--cp-surface)",
                display: "grid",
                gap: 4,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{o.what}</span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
                >
                  {formatRelativeDate(o.occurredAt)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                {o.did}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toISOString().slice(0, 10);
}

// ─── G · Engine internals ──────────────────────────────────────────

function EngineInternalsCard({ internals }: { internals: EngineInternals }) {
  return (
    <section
      className="cp-card"
      data-testid="stats-engine-internals"
      style={{
        padding: 16,
        background: "var(--cp-surface-soft)",
        fontSize: 12,
        color: "var(--cp-text-muted)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        Engine internals
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
        <li>
          Engine package version:{" "}
          <span className="mono" data-testid="stats-engine-internals-version">
            {internals.engineVersion}
          </span>
        </li>
        <li>
          Region state regions tracked:{" "}
          <span className="mono">{internals.regionsTracked}</span>
        </li>
        <li>
          Last region-ledger computation:{" "}
          <span className="mono">
            {internals.lastRegionStateAt
              ? internals.lastRegionStateAt.replace("T", " ").slice(0, 19)
              : "never"}
          </span>
        </li>
      </ul>
    </section>
  );
}
