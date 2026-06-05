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
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { formatDate, type ProfileForFormat } from "@/lib/format/datetime";
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
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricHelp } from "@/components/ui/MetricHelp";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function EnginePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, time_format, date_format")
    .eq("id", user.id)
    .maybeSingle();
  const tz = profile?.timezone ?? (await getUserTimezone(user.id));
  const formatProfile: ProfileForFormat = profile
    ? {
        timezone: profile.timezone ?? null,
        time_format: profile.time_format ?? null,
        date_format: profile.date_format ?? null,
      }
    : null;

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
      <PageHeader
        back={{ href: "/app/stats", label: "Stats" }}
        title="How the planner sees you"
        titleTestId="stats-engine-header"
        subtitle="Plain-language explanation of why today's session is what it is."
      />

      <DecisionTraceCard trace={trace} />
      <RegionFreshnessCard regions={regions} />
      <BucketPressureCard buckets={buckets} />
      <CeilingExplainerCard ceiling={ceiling} />
      <UserTierCard tier={tier} />
      <RecentOverridesCard overrides={overrides.events} notTracked={overrides.notTracked} formatProfile={formatProfile} />
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
        Decision trace
        <MetricHelp term="decision_trace" />
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
            <span>{r.text}</span>
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
            productive, below MRV = overstrained.
          </span>
        </span>
      </h2>
      <p style={{ margin: "4px 0 16px", color: "var(--cp-text-muted)", fontSize: 13 }}>
        Per-region freshness over the last 14 days, with MV / MEV / MAV /
        MRV reference lines.
      </p>
      {empty ? (
        <EmptyState
          variant="inline"
          title="No region load yet"
          body="Log a completed session — strength or cardio — and per-region freshness materialises here with MV / MEV / MAV / MRV bands."
        />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {regions.map((r) => (
            <RegionRow key={r.region} row={r} />
          ))}
        </div>
      )}
      {!empty && (
        <p
          data-testid="stats-engine-regions-footnote"
          style={{
            margin: "12px 0 0",
            fontSize: 11,
            color: "var(--cp-text-muted)",
          }}
        >
          Updated daily at 03:00 UTC · today&apos;s value is live
        </p>
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
            Six global stress buckets. Each bucket&apos;s current 7-day
            EWMA is compared to its 28-day chronic norm — the closer to
            100% of ceiling, the less headroom you have.
          </span>
        </span>
      </h2>
      <p style={{ margin: "4px 0 16px", color: "var(--cp-text-muted)", fontSize: 13 }}>
        Where the load is concentrated, and how close each bucket is to its
        own ceiling. Different from regions — regions are anatomy; buckets
        are the type of stress.
      </p>
      {!hasData ? (
        <EmptyState
          variant="inline"
          title="No stress data yet"
          body="Log a few sessions and bucket pressure (chronic vs acute, by stress type) materialises here."
        />
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
  const formulaCopy: Record<typeof ceiling.formula, string> = {
    median_of_recovered: "Median of your last 3 recovered weeks",
    cold_start_partial: "Median of your available recovered weeks (cold start)",
    cold_start_conservative: "Conservative floor — no recovered weeks yet (cold start)",
  };
  const recoveredOk = ceiling.formula === "median_of_recovered";
  const recoveredCount = ceiling.inputs.recoveredWeeksCount;
  return (
    <section
      className="cp-card"
      data-testid="stats-engine-ceiling"
      data-formula={ceiling.formula}
      style={{ padding: 20 }}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>
        Your ceiling this week
        <span className="cp-info" tabIndex={0} aria-label="How the ceiling is computed">
          i
          <span
            className="pop"
            data-testid="stats-engine-ceiling-why-pop"
            style={{ width: 320 }}
          >
            Final ceiling = base × GRM × confidence. Base = median
            weekly tonnage across your last 3 recovered weeks. A week
            qualifies as recovered when every planned session was
            logged, no session sRPE exceeded 9, and pre-session fatigue
            + soreness both averaged below 4. When fewer than 3 qualify
            we walk down a cold-start ladder so the engine projects
            conservatively.
          </span>
        </span>
      </h2>
      <p style={{ margin: "4px 0 16px", color: "var(--cp-text-muted)", fontSize: 13 }}>
        Plain-language render of the engine&apos;s ceiling equation —
        inputs you can see, output the engine actually uses.
      </p>

      {/* "Why this many?" recovered-weeks badge */}
      <div
        data-testid="stats-engine-ceiling-recovered-badge"
        data-tone={recoveredOk ? "ok" : recoveredCount > 0 ? "warning" : "danger"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 999,
          background: recoveredOk
            ? "var(--cp-success-soft, var(--cp-accent-soft))"
            : "var(--cp-warning-soft, var(--cp-surface-soft))",
          color: recoveredOk ? "var(--cp-success, var(--cp-accent))" : "var(--cp-warning, var(--cp-text))",
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 12,
        }}
      >
        {recoveredOk
          ? `${recoveredCount} recovered weeks ✓`
          : recoveredCount > 0
            ? `Only ${recoveredCount} recovered week${recoveredCount === 1 ? "" : "s"} — cold start`
            : "0 recovered weeks — cold start"}
        <MetricHelp term="recovered_week" />
      </div>

      {/* Recovered-week basis table */}
      {ceiling.basisWeeks.length > 0 ? (
        <div
          data-testid="stats-engine-ceiling-basis"
          style={{
            marginBottom: 12,
            borderRadius: 10,
            border: "1px solid var(--cp-border)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              background: "var(--cp-surface-soft)",
              fontSize: 11,
              color: "var(--cp-text-muted)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{formulaCopy[ceiling.formula]}</span>
            <span
              className="cp-info"
              tabIndex={0}
              aria-label="Why these weeks?"
              data-testid="stats-engine-ceiling-why-weeks"
            >
              ?
              <span className="pop" style={{ width: 260 }}>
                A week is &quot;recovered&quot; when every planned
                session was logged, no session sRPE exceeded 9, and avg
                pre-session fatigue + soreness both stayed below 4
                (1–5 scale). Cold-start weeks shown for context only.
              </span>
            </span>
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {ceiling.basisWeeks.map((b) => (
              <li
                key={b.weekStart}
                data-testid="stats-engine-ceiling-basis-row"
                data-included={b.included ? "true" : "false"}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "6px 12px",
                  fontSize: 12,
                  borderTop: "1px solid var(--cp-border)",
                  opacity: b.included ? 1 : 0.55,
                }}
              >
                <span className="mono">
                  {b.included ? "✓" : "·"} {b.weekStart}
                </span>
                <span className="mono">
                  {b.volume.toLocaleString()} kg
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
          value={Math.round(ceiling.baseCeiling).toLocaleString()}
          unit="kg/wk"
          cite="ceiling-base"
          help={formulaCopy[ceiling.formula]}
          helpTerm="ceiling"
        />
        <CeilingInputRow
          label="Confidence bias"
          value={ceiling.confidenceBias.toFixed(2)}
          unit="×"
          cite="ceiling-confidence"
          help={
            ceiling.formula === "median_of_recovered"
              ? "Full data — 3+ recovered weeks."
              : "Sparse data — confidence collapses to 0.80× until 3 recovered weeks land."
          }
          helpTerm="confidence_bias"
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
            ≈ {Math.round(ceiling.finalCeiling).toLocaleString()} kg
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
        <li style={{ marginTop: 4, fontStyle: "italic" }}>
          A week qualifies as recovered when every planned session was
          logged, no session sRPE exceeded 9, and pre-session fatigue
          + soreness both averaged below 4.
        </li>
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
  helpTerm,
}: {
  label: string;
  value: string;
  unit: string;
  cite: string;
  help: string;
  helpTerm?: string;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
      <div data-cite={cite}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {label}
          {helpTerm != null && <MetricHelp term={helpTerm} />}
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
  const confidenceLabel: Record<UserTierState["confidence"], string> = {
    high: "High confidence",
    moderate: "Moderate confidence",
    low: "Low confidence",
  };
  return (
    <section
      className="cp-card"
      data-testid="stats-engine-tier"
      data-tier={tier.tier}
      data-inferred={tier.inferred}
      data-confidence={tier.confidence}
      data-mismatch={tier.mismatch ? "true" : "false"}
      style={{ padding: 20 }}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>
        Your tier
        <span className="cp-info" tabIndex={0} aria-label="How tier is computed">
          i
          <span className="pop" style={{ width: 300 }}>
            Tier stays behavioural — inferred from per-lift e1RM
            relative to bodyweight, 12-week anchor adherence, schedule
            regularity, and recovery check-in fill rate, combined with
            your declared experience from onboarding. Any
            declared-vs-observed mismatch surfaces as a soft warning,
            never a silent overrule.
          </span>
        </span>
      </h2>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          margin: "10px 0 4px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
            You&apos;re at
          </div>
          <div
            data-testid="stats-engine-tier-label"
            style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.01em" }}
          >
            {tier.tierLabel}
            {tier.declaredYearsLabel && (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  color: "var(--cp-text-muted)",
                  marginLeft: 8,
                }}
              >
                · {tier.declaredYearsLabel}
              </span>
            )}
          </div>
        </div>
        <div
          data-testid="stats-engine-tier-confidence"
          className="mono"
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            whiteSpace: "nowrap",
          }}
        >
          {confidenceLabel[tier.confidence]} ·{" "}
          {tier.contributorCount} observed contributor
          {tier.contributorCount === 1 ? "" : "s"}
          {tier.isColdStart && " · cold-start"}
        </div>
      </div>

      {tier.description && (
        <div style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: "4px 0 8px" }}>
          {tier.description}
        </div>
      )}

      {tier.mismatch && (
        <div
          data-testid="stats-engine-tier-mismatch"
          role="note"
          style={{
            fontSize: 12,
            margin: "8px 0",
            padding: "8px 10px",
            borderRadius: 6,
            background: "var(--cp-warn-bg, rgba(255, 196, 0, 0.08))",
            border: "1px solid var(--cp-warn-border, rgba(255, 196, 0, 0.32))",
            color: "var(--cp-text)",
          }}
        >
          You declared <strong>{tier.declaredLabel}</strong>, observed signals
          lean toward <strong>{tier.inferredLabel}</strong>. The app keeps your
          declaration; this is a soft note, not a block.
        </div>
      )}

      {tier.sessionsUntilNextTier != null && (
        <div
          data-testid="stats-engine-tier-next-gate"
          style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: "6px 0" }}
        >
          Sessions until next tier: ~{tier.sessionsUntilNextTier}
          {tier.nextTierGateNote && (
            <span style={{ marginLeft: 6 }}>· {tier.nextTierGateNote}</span>
          )}
        </div>
      )}
      {tier.sessionsUntilNextTier == null && tier.nextTierGateNote && (
        <div style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: "6px 0" }}>
          {tier.nextTierGateNote}
        </div>
      )}

      {tier.contributors.length > 0 && (
        <details
          data-testid="stats-engine-tier-contributors"
          style={{ marginTop: 10, fontSize: 12, color: "var(--cp-text-muted)" }}
        >
          <summary style={{ cursor: "pointer", color: "var(--cp-text)" }}>
            How is this computed?
          </summary>
          <ul
            style={{
              margin: "8px 0 0",
              padding: 0,
              listStyle: "none",
              display: "grid",
              gap: 4,
            }}
          >
            {tier.contributors.map((c, i) => (
              <li
                key={`${c.name}-${i}`}
                data-testid="stats-engine-tier-contributor-row"
                data-points-toward={c.pointsToward}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                <span>{c.name}</span>
                <span>
                  {formatContributorValue(c.value)} · w {c.weight.toFixed(2)} →{" "}
                  {c.pointsToward}
                </span>
              </li>
            ))}
          </ul>
          <p style={{ margin: "10px 0 0", lineHeight: 1.5 }}>{tier.explanation}</p>
        </details>
      )}
    </section>
  );
}

function formatContributorValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v < 10) return v.toFixed(2);
  return Math.round(v).toString();
}

// ─── F · Recent overrides ──────────────────────────────────────────

function RecentOverridesCard({
  overrides,
  notTracked,
  formatProfile,
}: {
  overrides: OverrideEvent[];
  notTracked: boolean;
  formatProfile: ProfileForFormat;
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
            Every time you skip a planned session, swap a movement, or
            end a block early, the engine writes a row to the override
            audit log. Last 10 surfaced here, newest first.
          </span>
        </span>
      </h2>
      <p style={{ margin: "4px 0 12px", color: "var(--cp-text-muted)", fontSize: 13 }}>
        Last 10 cases where you took a different action than the engine
        recommended.
      </p>
      {notTracked ? (
        <EmptyState
          variant="inline"
          title="No overrides yet"
          body="When you skip a planned session, swap a movement, or end a block early, the engine logs it here. Quiet means the engine's calls are sticking."
        />
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
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  <span aria-hidden style={{ marginRight: 6 }}>
                    {overrideIcon(o.kind)}
                  </span>
                  {o.what}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
                >
                  {formatRelativeDate(o.occurredAt, formatProfile)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                {o.did}
              </div>
              {o.note && (
                <blockquote
                  data-testid="stats-engine-override-note"
                  style={{
                    margin: "4px 0 0",
                    padding: "6px 10px",
                    borderLeft: "3px solid var(--cp-border)",
                    background: "var(--cp-surface-soft)",
                    color: "var(--cp-text)",
                    fontSize: 12,
                    fontStyle: "italic",
                    borderRadius: 4,
                  }}
                >
                  “{o.note}”
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatRelativeDate(iso: string, profile: ProfileForFormat): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatDate(d, profile);
}

function overrideIcon(kind: OverrideEvent["kind"]): string {
  switch (kind) {
    case "skip":
      return "⤳";
    case "movement_swap":
      return "↔";
    case "manual_end":
      return "■";
    default:
      return "•";
  }
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
