/**
 * /app/stats/blocks/[id] — Phase 2 per-block deep dive.
 *
 * Six sections + an optional comparison view:
 *
 *   B1 header           — archetype, dates, status
 *   B2 main lifts       — start → end e1RM per role, mini line, best PR
 *   B3 adherence        — completed / skipped / weekday breakdown
 *   B4 RPE creep        — per-week avg RPE per role, "creep" flag
 *   B5 power emphasis   — only when the block had power_emphasis=true
 *   B6 wellness         — sleep / motivation / fatigue / soreness
 *   B7 comparison       — `?compare=<id>` renders side-by-side
 *
 * Every read fans out via `getBlockSummary` / `compareBlocks` which run
 * their internal queries in parallel — the page itself wires the two
 * top-level reads through one `Promise.all`.
 */
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import type { ReactElement } from "react";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { todayYmd } from "@/lib/dates";
import {
  compareBlocks,
  getBlockSummary,
  MAIN_LIFT_LABEL,
  type BlockSummary,
  type BlockMainLift,
  type BlockAdherence,
  type BlockRpeCreepRow,
  type BlockPowerOutcome,
  type BlockWellnessAverages,
} from "@/lib/stats/blocks";
import { displayWeight, weightUnitLabel, type WeightUnit } from "@/lib/stats/units";
import { StatusBadge } from "@/components/blocks/StatusBadge";
import { MiniLine } from "@/components/stats/charts/MiniLine";
import { MiniBars } from "@/components/stats/charts/MiniBars";
import { Sparkline } from "@/components/stats/charts/Sparkline";

export const dynamic = "force-dynamic";

export default async function StatsBlockDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ compare?: string | string[] }>;
}) {
  const { id } = await params;
  const { compare } = await searchParams;
  const compareId = Array.isArray(compare) ? compare[0] : compare;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("units, timezone")
    .eq("id", user.id)
    .maybeSingle();
  const units: WeightUnit = profile?.units === "imperial" ? "imperial" : "metric";
  const tz = profile?.timezone ?? (await getUserTimezone(user.id));
  const today = todayYmd(tz);

  // Read the primary block + (optional) comparison block in parallel.
  // When `compare` is set, `compareBlocks` already fetches both — but
  // we still want the picker even when the comparison isn't set, so we
  // also pull the index of other blocks.
  const [summary, comparison, pickerBlocks] = await Promise.all([
    compareId ? Promise.resolve(null) : getBlockSummary(supabase, id, user.id, today),
    compareId ? compareBlocks(supabase, id, compareId, user.id, today) : Promise.resolve(null),
    listOtherBlocks(supabase, user.id, id),
  ]);

  const primary = comparison?.a ?? summary;
  if (!primary) notFound();

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <BackLink />
      {comparison ? (
        <ComparisonView comparison={comparison} units={units} pickerBlocks={pickerBlocks} primaryId={id} />
      ) : (
        <SoloView summary={primary} units={units} pickerBlocks={pickerBlocks} primaryId={id} />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Solo view (sections B1–B6)
// ──────────────────────────────────────────────────────────────────────

function SoloView({
  summary,
  units,
  pickerBlocks,
  primaryId,
}: {
  summary: BlockSummary;
  units: WeightUnit;
  pickerBlocks: PickerBlock[];
  primaryId: string;
}): ReactElement {
  return (
    <>
      <Header summary={summary} />
      <ComparePicker primaryId={primaryId} blocks={pickerBlocks} />
      <MainLiftsGrid lifts={summary.mainLifts} units={units} />
      <AdherenceSection adherence={summary.adherence} />
      <RpeCreepSection rows={summary.rpeCreep} />
      {summary.powerOutcome && <PowerOutcomeSection outcome={summary.powerOutcome} />}
      <WellnessSection wellness={summary.wellness} />
    </>
  );
}

function BackLink(): ReactElement {
  return (
    <Link
      href="/app/stats/blocks"
      data-testid="stats-block-back-link"
      style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
    >
      ← all blocks
    </Link>
  );
}

// ── B1 header ─────────────────────────────────────────────────────────

function Header({ summary }: { summary: BlockSummary }): ReactElement {
  const { block } = summary;
  const dateRange = `${formatYmd(block.startedOn)} – ${
    block.endedOn ? formatYmd(block.endedOn.slice(0, 10)) : "ongoing"
  }`;
  const statusWord =
    block.status === "completed"
      ? "✓ Completed"
      : block.status === "archived"
      ? "Ended"
      : "Active";
  return (
    <header data-testid="stats-block-header" style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: "-0.01em" }}>{block.archetypeName}</h1>
        <StatusBadge status={block.status} />
      </div>
      <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 14 }}>
        {block.archetypeName} · {block.weeks} {block.weeks === 1 ? "week" : "weeks"} · {dateRange} ·{" "}
        {statusWord}
      </p>
    </header>
  );
}

// ── B2 main lifts ─────────────────────────────────────────────────────

function MainLiftsGrid({
  lifts,
  units,
}: {
  lifts: BlockMainLift[];
  units: WeightUnit;
}): ReactElement {
  if (lifts.length === 0) {
    return (
      <section data-testid="stats-block-mainlifts-empty" className="cp-card" style={{ padding: 18 }}>
        <SectionTitle title="Main lifts" />
        <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 13 }}>
          No main-lift sets were logged in this block. Once a session captures one, the
          progression cards will populate.
        </p>
      </section>
    );
  }
  return (
    <section data-testid="stats-block-mainlifts" style={{ display: "grid", gap: 10 }}>
      <SectionTitle title="Main lift progression" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 10,
        }}
      >
        {lifts.map((l) => (
          <MainLiftCard key={l.role} lift={l} units={units} />
        ))}
      </div>
    </section>
  );
}

function MainLiftCard({
  lift,
  units,
}: {
  lift: BlockMainLift;
  units: WeightUnit;
}): ReactElement {
  const unit = weightUnitLabel(units);
  const startDisplay = lift.startE1rm == null ? null : displayWeight(lift.startE1rm, units);
  const endDisplay = lift.endE1rm == null ? null : displayWeight(lift.endE1rm, units);
  const deltaKgDisplay = lift.deltaKg == null ? null : displayWeight(lift.deltaKg, units);
  const accent: "success" | "danger" | "accent" =
    lift.deltaPct == null
      ? "accent"
      : lift.deltaPct > 0
      ? "success"
      : lift.deltaPct < 0
      ? "danger"
      : "accent";
  const weekRange =
    lift.weeksAppeared.length === 0
      ? "no logged weeks"
      : `weeks ${lift.weeksAppeared[0]}–${lift.weeksAppeared[lift.weeksAppeared.length - 1]}`;
  return (
    <article
      className="cp-card"
      data-testid="stats-block-mainlift-card"
      data-role={lift.role}
      style={{ padding: 14, display: "grid", gap: 8 }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{MAIN_LIFT_LABEL[lift.role]}</div>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          {lift.movementDisplayName} · {weekRange}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          {startDisplay == null ? "—" : `${round1(startDisplay)} ${unit}`} →
        </span>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {endDisplay == null ? "—" : `${round1(endDisplay)} ${unit}`}
        </span>
      </div>
      <div
        data-testid="stats-block-mainlift-delta"
        style={{ fontSize: 13, color: `var(--cp-${accent})`, fontWeight: 600 }}
      >
        {lift.deltaKg == null || lift.deltaPct == null || deltaKgDisplay == null
          ? "—"
          : `${lift.deltaKg > 0 ? "+" : ""}${round1(deltaKgDisplay)} ${unit} · ${
              lift.deltaPct > 0 ? "+" : ""
            }${lift.deltaPct.toFixed(1)}%`}
      </div>
      {lift.bestPr && (
        <div
          data-testid="stats-block-mainlift-pr"
          style={{
            fontSize: 11,
            color: "var(--cp-success)",
            padding: "4px 8px",
            background: "rgba(34, 197, 94, 0.08)",
            borderRadius: 6,
            border: "1px solid rgba(34, 197, 94, 0.25)",
            display: "inline-block",
          }}
        >
          PR · {round1(displayWeight(lift.bestPr.hit.value, units))} {unit} est. · {formatYmd(lift.bestPr.date)}
        </div>
      )}
      <MiniLine
        values={lift.trend.map((t) => displayWeight(t.e1rm, units))}
        accent={accent}
        ariaLabel={`${MAIN_LIFT_LABEL[lift.role]} e1RM trend across the block`}
      />
    </article>
  );
}

// ── B3 adherence ──────────────────────────────────────────────────────

function AdherenceSection({ adherence }: { adherence: BlockAdherence }): ReactElement {
  return (
    <section
      className="cp-card"
      data-testid="stats-block-adherence"
      style={{ padding: 16, display: "grid", gap: 10 }}
    >
      <SectionTitle title="Adherence" />
      <div style={{ fontSize: 14 }}>
        <strong data-testid="stats-block-adherence-summary">
          {adherence.completed} of {adherence.scheduled} sessions logged
        </strong>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--cp-text-muted)" }}>
        <span data-testid="stats-block-adherence-skipped">
          {adherence.skipped} session{adherence.skipped === 1 ? "" : "s"} skipped
        </span>
        <span data-testid="stats-block-adherence-not-logged">
          {adherence.notYetLogged} not yet logged
        </span>
      </div>
      {adherence.skippedDetail.length > 0 && (
        <details
          data-testid="stats-block-adherence-skipped-detail"
          style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
        >
          <summary style={{ cursor: "pointer" }}>Show skipped sessions</summary>
          <ul style={{ listStyle: "none", padding: 0, marginTop: 6, display: "grid", gap: 4 }}>
            {adherence.skippedDetail.map((s) => (
              <li key={s.plannedId}>
                <span>{formatYmd(s.date)}</span> · <span>{s.title}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div data-testid="stats-block-adherence-weekday">
        <div
          style={{
            fontSize: 10,
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          Per-weekday completion
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 4,
          }}
        >
          {adherence.weekday.map((w) => {
            const pct = Math.round(w.ratio * 100);
            const accent =
              w.scheduled === 0
                ? "var(--cp-text-muted)"
                : w.ratio >= 0.8
                ? "var(--cp-success)"
                : w.ratio >= 0.5
                ? "var(--cp-warning)"
                : "var(--cp-danger)";
            return (
              <div
                key={w.weekdayIndex}
                data-testid="stats-block-adherence-weekday-cell"
                data-weekday={w.weekdayLabel}
                style={{
                  padding: "6px 4px",
                  textAlign: "center",
                  background: "var(--cp-surface-soft)",
                  borderRadius: 6,
                  border: "1px solid var(--cp-border)",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--cp-text-muted)" }}>{w.weekdayLabel}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: accent }}>
                  {w.scheduled === 0 ? "—" : `${pct}%`}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── B4 RPE creep ──────────────────────────────────────────────────────

function RpeCreepSection({ rows }: { rows: BlockRpeCreepRow[] }): ReactElement {
  if (rows.length === 0) {
    return (
      <section className="cp-card" data-testid="stats-block-rpe-creep-empty" style={{ padding: 16 }}>
        <SectionTitle title="RPE creep" />
        <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 13 }}>
          Log RPE on your main sets to see how your perceived effort evolved across the block.
        </p>
      </section>
    );
  }
  return (
    <section
      className="cp-card"
      data-testid="stats-block-rpe-creep"
      style={{ padding: 16, display: "grid", gap: 10 }}
    >
      <SectionTitle title="RPE creep" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
        }}
      >
        {rows.map((r) => (
          <div
            key={r.role}
            data-testid="stats-block-rpe-creep-card"
            data-role={r.role}
            data-creep={r.creepFlag ? "true" : "false"}
            style={{
              padding: 12,
              background: "var(--cp-surface-soft)",
              borderRadius: 8,
              border: "1px solid var(--cp-border)",
              display: "grid",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{MAIN_LIFT_LABEL[r.role]}</span>
              {r.creepFlag && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "var(--cp-danger)",
                    background: "rgba(239, 68, 68, 0.1)",
                    padding: "1px 6px",
                    borderRadius: 999,
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                  }}
                >
                  creeping fatigue
                </span>
              )}
            </div>
            <MiniBars
              values={r.weeklyAvgRpe.map((v) => v ?? 0)}
              max={10}
              accent={r.creepFlag ? "danger" : "accent"}
              ariaLabel={`avg RPE per week for ${MAIN_LIFT_LABEL[r.role]}`}
            />
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
              {summariseRpeSeries(r.weeklyAvgRpe)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function summariseRpeSeries(weekly: Array<number | null>): string {
  const logged = weekly.filter((v): v is number => v != null);
  if (logged.length === 0) return "no RPE logged";
  return logged.map((v) => v.toFixed(1)).join(" → ");
}

// ── B5 power emphasis ─────────────────────────────────────────────────

function PowerOutcomeSection({ outcome }: { outcome: BlockPowerOutcome }): ReactElement {
  return (
    <section
      className="cp-card"
      data-testid="stats-block-power-outcome"
      style={{ padding: 16, display: "grid", gap: 10 }}
    >
      <SectionTitle title="Power emphasis outcome" />
      <div style={{ fontSize: 13 }}>
        <strong data-testid="stats-block-power-counts">
          {outcome.totalPowerAccessoriesPerformed} of {outcome.totalPowerAccessoriesPrescribed}
        </strong>{" "}
        power-tagged accessories logged
        <span style={{ color: "var(--cp-text-muted)" }}>
          {" "}
          ({outcome.totalAccessoriesPrescribed} accessories prescribed total)
        </span>
      </div>
      <div style={{ fontSize: 13 }} data-testid="stats-block-power-pr-count">
        <strong>{outcome.powerPrSet.length}</strong> PR
        {outcome.powerPrSet.length === 1 ? "" : "s"} on power-tagged movements
      </div>
      {outcome.powerPrSet.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
          {outcome.powerPrSet.slice(0, 5).map((p) => (
            <li
              key={`${p.movementSlug}-${p.date}`}
              style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
            >
              {p.movementDisplayName} · {formatYmd(p.date)} · {round1(p.hit.value)} kg est.
            </li>
          ))}
        </ul>
      )}
      {outcome.comparisonBlock && (
        <div
          data-testid="stats-block-power-compare"
          style={{
            marginTop: 6,
            padding: 10,
            background: "var(--cp-surface-soft)",
            borderRadius: 8,
            border: "1px solid var(--cp-border)",
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            vs prior {outcome.comparisonBlock.archetypeName} (power off)
          </div>
          <div style={{ color: "var(--cp-text-muted)" }}>
            That block: {outcome.comparisonBlock.prCount} PRs ·{" "}
            {outcome.comparisonBlock.avgE1RmDeltaPct == null
              ? "no e1RM data"
              : `${outcome.comparisonBlock.avgE1RmDeltaPct > 0 ? "+" : ""}${outcome.comparisonBlock.avgE1RmDeltaPct.toFixed(1)}% avg e1RM delta`}
          </div>
        </div>
      )}
    </section>
  );
}

// ── B6 wellness ───────────────────────────────────────────────────────

function WellnessSection({
  wellness,
}: {
  wellness: BlockWellnessAverages;
}): ReactElement {
  return (
    <section
      className="cp-card"
      data-testid="stats-block-wellness"
      style={{ padding: 16, display: "grid", gap: 10 }}
    >
      <SectionTitle title="Sleep & wellness during the block" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 8,
        }}
      >
        <WellnessTile
          testid="stats-block-wellness-sleep"
          label="Avg sleep"
          value={wellness.sleepHoursAvg == null ? "—" : `${wellness.sleepHoursAvg.toFixed(1)}h`}
          series={wellness.sleepSeries}
        />
        <WellnessTile
          testid="stats-block-wellness-motivation"
          label="Avg motivation"
          value={wellness.motivationAvg == null ? "—" : `${wellness.motivationAvg.toFixed(1)} / 5`}
          series={wellness.motivationSeries}
        />
        <WellnessTile
          testid="stats-block-wellness-fatigue"
          label="Avg fatigue"
          value={wellness.fatigueAvg == null ? "—" : `${wellness.fatigueAvg.toFixed(1)} / 5`}
          series={wellness.fatigueSeries}
        />
        <WellnessTile
          testid="stats-block-wellness-soreness"
          label="Avg soreness"
          value={wellness.sorenessAvg == null ? "—" : `${wellness.sorenessAvg.toFixed(1)} / 5`}
          series={wellness.sorenessSeries}
        />
      </div>
    </section>
  );
}

function WellnessTile({
  testid,
  label,
  value,
  series,
}: {
  testid: string;
  label: string;
  value: string;
  series: Array<number | null>;
}): ReactElement {
  return (
    <div
      data-testid={testid}
      style={{
        padding: 10,
        background: "var(--cp-surface-soft)",
        borderRadius: 8,
        border: "1px solid var(--cp-border)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{value}</div>
      <Sparkline
        values={series.map((v) => v ?? 0)}
        accent="accent"
        ariaLabel={`${label} per week`}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// B7 comparison view + picker
// ──────────────────────────────────────────────────────────────────────

type PickerBlock = {
  id: string;
  archetypeName: string;
  startedOn: string;
};

async function listOtherBlocks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  excludeId: string,
): Promise<PickerBlock[]> {
  const { data } = await supabase
    .from("training_blocks")
    .select("id, archetype, started_on, notes")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .neq("id", excludeId)
    .order("started_on", { ascending: false })
    .limit(20);
  if (!data) return [];
  const { archetypeDisplayName } = await import("@/lib/planner/queries");
  return data.map((b) => ({
    id: b.id,
    archetypeName: archetypeDisplayName(b.archetype, (b.notes as string | null) ?? null),
    startedOn: b.started_on,
  }));
}

function ComparePicker({
  primaryId,
  blocks,
}: {
  primaryId: string;
  blocks: PickerBlock[];
}): ReactElement | null {
  if (blocks.length === 0) return null;
  return (
    <section
      data-testid="stats-block-compare-picker"
      style={{
        padding: 12,
        background: "var(--cp-surface-soft)",
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600 }}>Compare this block to another →</div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {blocks.map((b) => (
          <li key={b.id}>
            <Link
              href={`/app/stats/blocks/${primaryId}?compare=${b.id}`}
              data-testid="stats-block-compare-option"
              data-target-id={b.id}
              scroll={false}
              style={{
                fontSize: 12,
                padding: "5px 10px",
                borderRadius: 999,
                background: "var(--cp-surface)",
                border: "1px solid var(--cp-border)",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              {b.archetypeName} · {formatYmd(b.startedOn)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ComparisonView({
  comparison,
  units,
  pickerBlocks,
  primaryId,
}: {
  comparison: NonNullable<Awaited<ReturnType<typeof compareBlocks>>>;
  units: WeightUnit;
  pickerBlocks: PickerBlock[];
  primaryId: string;
}): ReactElement {
  const { a, b } = comparison;
  const unit = weightUnitLabel(units);
  return (
    <>
      <Header summary={a} />
      <section
        data-testid="stats-block-compare-banner"
        style={{
          padding: 10,
          background: "var(--cp-accent-soft)",
          borderRadius: 8,
          border: "1px solid var(--cp-accent)",
          fontSize: 13,
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span>
          Comparing <strong>{a.block.archetypeName}</strong> vs{" "}
          <strong>{b.block.archetypeName}</strong>
          {!comparison.sameArchetype && (
            <span style={{ marginLeft: 8, color: "var(--cp-warning)" }}>
              · different archetypes
            </span>
          )}
        </span>
        <Link
          href={`/app/stats/blocks/${primaryId}`}
          data-testid="stats-block-compare-clear"
          style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
        >
          ✕ clear comparison
        </Link>
      </section>

      {/* Per-lift side-by-side */}
      <section data-testid="stats-block-compare-mainlifts" style={{ display: "grid", gap: 10 }}>
        <SectionTitle title="Main lifts" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 10,
          }}
        >
          {a.mainLifts.map((liftA) => {
            const liftB = b.mainLifts.find((l) => l.role === liftA.role);
            return (
              <article
                key={liftA.role}
                className="cp-card"
                style={{ padding: 14, display: "grid", gap: 6 }}
                data-testid="stats-block-compare-mainlift-card"
                data-role={liftA.role}
              >
                <div style={{ fontSize: 14, fontWeight: 600 }}>{MAIN_LIFT_LABEL[liftA.role]}</div>
                <CompareRow
                  label="this block"
                  primary
                  valueDeltaPct={liftA.deltaPct}
                  valueDeltaKg={liftA.deltaKg}
                  units={units}
                />
                <CompareRow
                  label="other block"
                  primary={false}
                  valueDeltaPct={liftB?.deltaPct ?? null}
                  valueDeltaKg={liftB?.deltaKg ?? null}
                  units={units}
                />
              </article>
            );
          })}
        </div>
      </section>

      {/* Adherence side-by-side */}
      <section
        className="cp-card"
        data-testid="stats-block-compare-adherence"
        style={{ padding: 16, display: "grid", gap: 8 }}
      >
        <SectionTitle title="Adherence" />
        <CompareScalar
          aLabel={a.block.archetypeName}
          aValue={`${a.adherence.completed} / ${a.adherence.scheduled}`}
          bLabel={b.block.archetypeName}
          bValue={`${b.adherence.completed} / ${b.adherence.scheduled}`}
          aBetter={
            a.adherence.scheduled > 0 &&
            b.adherence.scheduled > 0 &&
            a.adherence.completed / a.adherence.scheduled >
              b.adherence.completed / b.adherence.scheduled
          }
        />
      </section>

      {/* PR count side-by-side */}
      <section
        className="cp-card"
        data-testid="stats-block-compare-prs"
        style={{ padding: 16, display: "grid", gap: 8 }}
      >
        <SectionTitle title="PRs" />
        <CompareScalar
          aLabel={a.block.archetypeName}
          aValue={`${a.prCount} PRs`}
          bLabel={b.block.archetypeName}
          bValue={`${b.prCount} PRs`}
          aBetter={a.prCount > b.prCount}
        />
      </section>

      {/* Sleep avg side-by-side */}
      <section
        className="cp-card"
        data-testid="stats-block-compare-sleep"
        style={{ padding: 16, display: "grid", gap: 8 }}
      >
        <SectionTitle title="Avg sleep" />
        <CompareScalar
          aLabel={a.block.archetypeName}
          aValue={a.wellness.sleepHoursAvg == null ? "—" : `${a.wellness.sleepHoursAvg.toFixed(1)}h`}
          bLabel={b.block.archetypeName}
          bValue={b.wellness.sleepHoursAvg == null ? "—" : `${b.wellness.sleepHoursAvg.toFixed(1)}h`}
          aBetter={
            a.wellness.sleepHoursAvg != null &&
            b.wellness.sleepHoursAvg != null &&
            a.wellness.sleepHoursAvg > b.wellness.sleepHoursAvg
          }
        />
      </section>

      <ComparePicker primaryId={primaryId} blocks={pickerBlocks} />
      {/* keep the unit reference compiled-in so eslint doesn't flag it */}
      <span style={{ display: "none" }}>{unit}</span>
    </>
  );
}

function CompareRow({
  label,
  primary,
  valueDeltaPct,
  valueDeltaKg,
  units,
}: {
  label: string;
  primary: boolean;
  valueDeltaPct: number | null;
  valueDeltaKg: number | null;
  units: WeightUnit;
}): ReactElement {
  const unit = weightUnitLabel(units);
  const accent =
    valueDeltaPct == null
      ? "var(--cp-text-muted)"
      : valueDeltaPct > 0
      ? "var(--cp-success)"
      : valueDeltaPct < 0
      ? "var(--cp-danger)"
      : "var(--cp-text-muted)";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        padding: "4px 0",
        borderTop: primary ? "none" : "1px dashed var(--cp-border)",
      }}
    >
      <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: accent }}>
        {valueDeltaPct == null || valueDeltaKg == null
          ? "—"
          : `${valueDeltaPct > 0 ? "+" : ""}${valueDeltaPct.toFixed(1)}% · ${
              valueDeltaKg > 0 ? "+" : ""
            }${round1(displayWeight(valueDeltaKg, units))} ${unit}`}
      </span>
    </div>
  );
}

function CompareScalar({
  aLabel,
  aValue,
  bLabel,
  bValue,
  aBetter,
}: {
  aLabel: string;
  aValue: string;
  bLabel: string;
  bValue: string;
  aBetter: boolean;
}): ReactElement {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <Side label={aLabel} value={aValue} better={aBetter} />
      <Side label={bLabel} value={bValue} better={!aBetter} />
    </div>
  );
}

function Side({
  label,
  value,
  better,
}: {
  label: string;
  value: string;
  better: boolean;
}): ReactElement {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        background: better ? "rgba(34, 197, 94, 0.08)" : "var(--cp-surface-soft)",
        border: `1px solid ${better ? "rgba(34, 197, 94, 0.25)" : "var(--cp-border)"}`,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>{label}</div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: better ? "var(--cp-success)" : "inherit",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Shared bits
// ──────────────────────────────────────────────────────────────────────

function SectionTitle({ title }: { title: string }): ReactElement {
  return (
    <div
      style={{
        fontSize: 11,
        color: "var(--cp-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontWeight: 600,
      }}
    >
      {title}
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatYmd(ymd: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const y = ymd.slice(0, 4);
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  return `${months[m - 1]} ${d}, ${y}`;
}
