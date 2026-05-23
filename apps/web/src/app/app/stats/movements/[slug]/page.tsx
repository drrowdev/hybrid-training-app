/**
 * /app/stats/movements/[slug] — Phase 5 per-movement deep dive.
 *
 * Eight sections, mobile-first vertical stack:
 *
 *   A header              — current e1RM, best ever, current TM, range toggle
 *   B e1RM trend          — tall `<MiniLine>` with PR dots + linear-regression
 *                           overlay; subtitle surfaces the slope as kg/week
 *   C top sets            — last 20 sessions, click-through to session detail
 *   D volume trend        — tall `<MiniBars>` of per-session tonnage
 *   E RPE + creep warning — tall `<MiniLine>` + 28-day-window creep detector
 *   F swap history        — every prescription-item swap touching this movement
 *   G last 5 sessions     — quick "what did I do recently" cards
 *   H sister movements    — peers by `pattern` (or `functional_roles[]` fallback)
 *
 * All time-bounded sections honour the `?range=30d|90d|all` toggle (Phase 2).
 * Replaces the Phase-1 e1RM / weekly-volume / RPE-histogram / recent-sets
 * stack while keeping the Phase-1 TM history strip (it's the only place that
 * surfaces tm_history).
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  detectRpeCreep,
  filterSeriesToRange,
  formatSlopePerWeek,
  getBestEverE1rmFromSeries,
  getCurrentE1rmFromSeries,
  getCurrentTm,
  getMovementBySlug,
  getMovementMeta,
  getMovementSwapHistory,
  getSisterMovements,
  getWorkingSetsForMovement,
  linearRegressionSlopePerDay,
  rollupRpePerSession,
  rollupTopSetsPerSession,
  rollupVolumePerSession,
  type RpePoint,
  type TopSetPoint,
  type VolumePoint,
  type SwapEvent,
  type SisterMovement,
} from "@/lib/stats/movement";
import {
  DEFAULT_RANGE,
  RANGE_LABEL,
  parseRange,
  type Range,
} from "@/lib/stats/range";
import { displayWeight, weightUnitLabel, type WeightUnit } from "@/lib/stats/units";
import { MiniLine, type MiniLineMarker } from "@/components/stats/charts/MiniLine";
import { MiniBars } from "@/components/stats/charts/MiniBars";
import type { TmChangeReason } from "@hta/db";

export const dynamic = "force-dynamic";

export default async function MovementDeepDivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const { slug } = await params;
  const { range: rawRange } = await searchParams;
  const range = parseRange(rawRange);

  const movement = await getMovementBySlug(slug);
  if (!movement) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("units")
    .eq("id", user.id)
    .maybeSingle();
  const units: WeightUnit = profile?.units === "imperial" ? "imperial" : "metric";
  const uLabel = weightUnitLabel(units);
  const w = (kg: number) => Math.round(displayWeight(kg, units) * 10) / 10;

  // Pull the pattern + functional_roles first so the sister lookup
  // (which depends on them) can run in parallel with the rest.
  const meta = await getMovementMeta(supabase, movement.id);

  const [workingSets, tmKg, swapEvents, sisters, tmHistoryRowsRes] = await Promise.all([
    getWorkingSetsForMovement(supabase, user.id, movement.id),
    getCurrentTm(supabase, user.id, movement.id),
    getMovementSwapHistory(supabase, user.id, movement.id),
    getSisterMovements(
      supabase,
      user.id,
      {
        id: movement.id,
        pattern: meta?.pattern ?? null,
        functionalRoles: meta?.functionalRoles ?? [],
      },
      6,
    ),
    supabase
      .from("tm_history")
      .select("id, old_tm_kg, new_tm_kg, reason, changed_at")
      .eq("user_id", user.id)
      .eq("movement_id", movement.id)
      .order("changed_at", { ascending: true }),
  ]);

  const topSetsAll = rollupTopSetsPerSession(workingSets);
  const volumeAll = rollupVolumePerSession(workingSets);
  const rpeAll = rollupRpePerSession(workingSets);

  const topSetsInRange = filterSeriesToRange(topSetsAll, range);
  const volumeInRange = filterSeriesToRange(volumeAll, range);
  const rpeInRange = filterSeriesToRange(rpeAll, range);

  const currentE1rm = getCurrentE1rmFromSeries(topSetsAll);
  const bestEver = getBestEverE1rmFromSeries(topSetsAll);
  const creep = detectRpeCreep(rpeInRange);

  const tmHistoryRows = tmHistoryRowsRes.data ?? [];

  return (
    <div style={{ display: "grid", gap: 18 }} data-testid="stats-movement-page">
      {/* ── A · Header ────────────────────────────────────────────── */}
      <header data-testid="stats-movement-header">
        <Link
          href="/app/stats"
          style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
        >
          ← all stats
        </Link>
        <h1
          style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}
          data-testid="stats-movement-title"
        >
          {movement.display_name}
        </h1>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 4 }}>
          {movement.primary_region.replace(/_/g, " ")}
          {meta?.pattern ? ` · ${meta.pattern.replace(/_/g, " ")}` : ""}
          {movement.is_compound ? " · compound" : " · isolation"}
        </div>

        <div
          style={{
            marginTop: 14,
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                color: "var(--cp-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Estimated 1RM
            </div>
            <div
              className="mono"
              style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.01em" }}
              data-testid="stats-movement-current-e1rm"
            >
              {currentE1rm != null ? `${w(currentE1rm)} ${uLabel}` : "—"}
            </div>
          </div>
        </div>
        <div
          style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 6 }}
          data-testid="stats-movement-best-ever"
        >
          {bestEver
            ? `Best ever: ${w(bestEver.e1rm)} ${uLabel} on ${formatDate(bestEver.performedAt)}`
            : "No working sets yet"}
          {tmKg != null && (
            <>
              {" · "}TM: <span className="mono">{w(tmKg)} {uLabel}</span>
            </>
          )}
        </div>

        <RangeToggle slug={movement.slug} active={range} />
      </header>

      {/* ── B · e1RM trend ───────────────────────────────────────── */}
      <E1rmTrendCard
        series={topSetsInRange}
        units={units}
        rangeLabel={RANGE_LABEL[range]}
      />

      {/* ── C · Top sets table ───────────────────────────────────── */}
      <TopSetsCard
        rows={topSetsInRange.slice(-20).reverse()}
        units={units}
      />

      {/* ── D · Volume trend ─────────────────────────────────────── */}
      <VolumeTrendCard series={volumeInRange} units={units} />

      {/* ── E · RPE + creep banner ───────────────────────────────── */}
      <RpeTrendCard series={rpeInRange} creep={creep} />

      {/* ── F · Swap history ─────────────────────────────────────── */}
      <SwapHistoryCard events={swapEvents} />

      {/* ── G · Recent 5 sessions ────────────────────────────────── */}
      <RecentSessionsCard rows={topSetsInRange.slice(-5).reverse()} units={units} />

      {/* ── H · Sister movements ─────────────────────────────────── */}
      <SisterMovementsCard sisters={sisters} units={units} />

      {/* TM history (carried forward from Phase 1 — only place this
          surface renders it). Hidden when empty. */}
      {tmHistoryRows.length > 0 && (
        <TmHistoryCard
          rows={tmHistoryRows.map((r) => ({
            id: r.id as string,
            oldTm: r.old_tm_kg != null ? Number(r.old_tm_kg) : null,
            newTm: Number(r.new_tm_kg),
            reason: r.reason as TmChangeReason,
            changedAt: r.changed_at as string,
          }))}
          units={units}
        />
      )}
    </div>
  );
}

// ── Header range toggle ────────────────────────────────────────────

function RangeToggle({ slug, active }: { slug: string; active: Range }) {
  const opts: Range[] = ["30d", "90d", "all"];
  return (
    <nav
      data-testid="stats-movement-range-toggle"
      style={{
        marginTop: 12,
        display: "inline-flex",
        gap: 4,
        padding: 4,
        background: "var(--cp-surface-soft)",
        borderRadius: 8,
      }}
    >
      {opts.map((r) => {
        const isActive = r === active;
        const href =
          r === DEFAULT_RANGE
            ? `/app/stats/movements/${slug}`
            : `/app/stats/movements/${slug}?range=${r}`;
        return (
          <Link
            key={r}
            href={href}
            data-testid="stats-movement-range-option"
            data-active={isActive ? "true" : "false"}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              borderRadius: 6,
              textDecoration: "none",
              background: isActive ? "var(--cp-bg)" : "transparent",
              color: isActive ? "var(--cp-text)" : "var(--cp-text-muted)",
              fontWeight: isActive ? 600 : 400,
            }}
          >
            {RANGE_LABEL[r]}
          </Link>
        );
      })}
    </nav>
  );
}

// ── B · e1RM trend ─────────────────────────────────────────────────

function E1rmTrendCard({
  series,
  units,
  rangeLabel,
}: {
  series: TopSetPoint[];
  units: WeightUnit;
  rangeLabel: string;
}) {
  const uLabel = weightUnitLabel(units);
  const values = series.map((p) => displayWeight(p.e1rm, units));
  const slopePerDay = linearRegressionSlopePerDay(series);
  const slopeText =
    slopePerDay != null
      ? formatSlopePerWeek(displayWeight(slopePerDay, units))
      : null;
  const slopePositive = slopePerDay != null && slopePerDay > 0;

  // Build the dashed-line overlay from the linear regression so the
  // user sees the trend the slope number describes.
  let overlay: number[] | undefined;
  if (slopePerDay != null && series.length >= 2) {
    const t0 = +new Date(series[0]!.performedAt);
    const meanY = values.reduce((a, b) => a + b, 0) / values.length;
    const meanX =
      series.reduce((acc, p) => acc + (+new Date(p.performedAt) - t0) / 86_400_000, 0) /
      series.length;
    const slopeDisp = displayWeight(slopePerDay, units);
    const intercept = meanY - slopeDisp * meanX;
    overlay = series.map(
      (p) => slopeDisp * ((+new Date(p.performedAt) - t0) / 86_400_000) + intercept,
    );
  }

  const markers: MiniLineMarker[] = series
    .map((p, i): MiniLineMarker | null =>
      p.isPR
        ? {
            index: i,
            color: "var(--cp-danger)",
            label: `PR ${Math.round(displayWeight(p.e1rm, units))} ${uLabel} on ${formatDate(
              p.performedAt,
            )}`,
          }
        : null,
    )
    .filter((m): m is MiniLineMarker => m != null);

  return (
    <section
      className="cp-card"
      style={{ padding: 20 }}
      data-testid="stats-movement-e1rm"
      data-empty={series.length === 0 ? "true" : "false"}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Estimated 1-rep max over time</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        One point per session over the last {rangeLabel.toLowerCase()}. PR sessions
        flagged with a red dot.
        {slopeText && (
          <>
            {" "}
            Trend:{" "}
            <span
              style={{
                color: slopePositive ? "var(--cp-success)" : "var(--cp-warning)",
                fontWeight: 600,
              }}
              data-testid="stats-movement-e1rm-slope"
            >
              {slopeText}
            </span>
            .
          </>
        )}
      </p>
      {series.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          Log a few sessions to see the trend.
        </p>
      ) : (
        <MiniLine
          values={values}
          overlay={overlay}
          markers={markers}
          height={200}
          ariaLabel={`estimated 1RM trend, ${series.length} sessions`}
        />
      )}
    </section>
  );
}

// ── C · Top sets table ─────────────────────────────────────────────

function TopSetsCard({ rows, units }: { rows: TopSetPoint[]; units: WeightUnit }) {
  const uLabel = weightUnitLabel(units);
  return (
    <section
      className="cp-card"
      style={{ padding: 20 }}
      data-testid="stats-movement-top-sets"
      data-empty={rows.length === 0 ? "true" : "false"}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Top sets</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        Heaviest set per session, last 20. Tap a row to open that session.
      </p>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          No sessions in this range yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {rows.map((r) => (
            <li key={r.sessionId}>
              <Link
                href={`/app/sessions/${r.sessionId}`}
                data-testid="stats-movement-top-set-row"
                data-pr={r.isPR ? "true" : "false"}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 10,
                  alignItems: "baseline",
                  padding: "10px 12px",
                  background: "var(--cp-surface-soft)",
                  borderRadius: 6,
                  textDecoration: "none",
                  color: "var(--cp-text)",
                  fontSize: 12,
                }}
              >
                <span style={{ color: "var(--cp-text-muted)", minWidth: 84 }}>
                  {formatDate(r.performedAt)}
                </span>
                <span className="mono">
                  {Math.round(displayWeight(r.weight, units) * 10) / 10} {uLabel} × {r.reps}
                  <span style={{ color: "var(--cp-text-muted)", marginLeft: 8 }}>
                    {r.rpe != null ? `@ ${r.rpe}` : ""}
                  </span>
                </span>
                <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}>
                  <span className="mono" style={{ color: "var(--cp-text-muted)" }}>
                    {Math.round(displayWeight(r.e1rm, units))} {uLabel}
                  </span>
                  {r.isPR && (
                    <span
                      data-testid="stats-movement-pr-badge"
                      style={{
                        fontSize: 9,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        background: "var(--cp-danger)",
                        color: "var(--cp-bg)",
                        padding: "2px 6px",
                        borderRadius: 4,
                        fontWeight: 700,
                      }}
                    >
                      PR
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── D · Volume trend ───────────────────────────────────────────────

function VolumeTrendCard({ series, units }: { series: VolumePoint[]; units: WeightUnit }) {
  const uLabel = weightUnitLabel(units);
  const values = series.map((p) => Math.round(displayWeight(p.tonnage, units)));
  return (
    <section
      className="cp-card"
      style={{ padding: 20 }}
      data-testid="stats-movement-volume"
      data-empty={series.length === 0 ? "true" : "false"}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Working volume</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        Total tonnage (∑ weight × reps) across every working set, per session.
      </p>
      {series.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          No sessions in this range yet.
        </p>
      ) : (
        <>
          <MiniBars values={values} accent="accent" height={140} ariaLabel="volume per session" />
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: "var(--cp-text-muted)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>{formatDate(series[0]!.performedAt)}</span>
            <span className="mono">
              max {values.reduce((a, b) => Math.max(a, b), 0).toLocaleString()} {uLabel}
            </span>
            <span>{formatDate(series[series.length - 1]!.performedAt)}</span>
          </div>
        </>
      )}
    </section>
  );
}

// ── E · RPE trend + creep banner ───────────────────────────────────

function RpeTrendCard({
  series,
  creep,
}: {
  series: RpePoint[];
  creep: ReturnType<typeof detectRpeCreep>;
}) {
  const rpeBearing = series.filter((p) => p.rpe != null);
  const values = rpeBearing.map((p) => p.rpe!);
  return (
    <section
      className="cp-card"
      style={{ padding: 20 }}
      data-testid="stats-movement-rpe"
      data-empty={rpeBearing.length === 0 ? "true" : "false"}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Effort over time</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        Mean RPE per session for this movement. Climbing RPE on flat weight is a
        deload signal.
      </p>
      {creep.flagged && (
        <div
          data-testid="stats-movement-rpe-creep"
          style={{
            margin: "0 0 12px",
            padding: "10px 12px",
            border: "1px solid var(--cp-warning)",
            background: "color-mix(in srgb, var(--cp-warning) 12%, transparent)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--cp-text)",
          }}
        >
          <strong>RPE creeping up</strong> — last 28 days averaged{" "}
          {creep.recent?.meanRpe.toFixed(1)} vs {creep.earlier?.meanRpe.toFixed(1)} the
          28 days before, on flat or lower weight. Consider a deload or check
          sleep/stress.
        </div>
      )}
      {rpeBearing.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          Log RPE on top sets to see trends.
        </p>
      ) : (
        <MiniLine
          values={values}
          accent={creep.flagged ? "warning" : "accent"}
          height={140}
          ariaLabel={`mean RPE per session, ${rpeBearing.length} sessions`}
        />
      )}
    </section>
  );
}

// ── F · Swap history ───────────────────────────────────────────────

function SwapHistoryCard({ events }: { events: SwapEvent[] }) {
  return (
    <section
      className="cp-card"
      style={{ padding: 20 }}
      data-testid="stats-movement-swaps"
      data-empty={events.length === 0 ? "true" : "false"}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Swap history</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        Times you swapped this movement in or out of a planned session.
      </p>
      {events.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          No swaps yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {events.map((ev, i) => {
            const verb = ev.direction === "to" ? "Swapped in from" : "Swapped out to";
            const inner = (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: 10,
                  alignItems: "baseline",
                  padding: "10px 12px",
                  background: "var(--cp-surface-soft)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <span style={{ color: "var(--cp-text-muted)", minWidth: 84 }}>
                  {formatDate(ev.swappedAt)}
                </span>
                <span>
                  {verb} <strong>{ev.otherMovementName}</strong>
                </span>
              </div>
            );
            return (
              <li key={`${ev.swappedAt}-${i}`} data-testid="stats-movement-swap-row">
                {ev.completedSessionId ? (
                  <Link
                    href={`/app/sessions/${ev.completedSessionId}`}
                    style={{ textDecoration: "none", color: "var(--cp-text)" }}
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── G · Recent sessions snapshot ───────────────────────────────────

function RecentSessionsCard({
  rows,
  units,
}: {
  rows: TopSetPoint[];
  units: WeightUnit;
}) {
  const uLabel = weightUnitLabel(units);
  const avgWeight =
    rows.length > 0 ? rows.reduce((a, b) => a + b.weight, 0) / rows.length : 0;
  return (
    <section
      className="cp-card"
      style={{ padding: 20 }}
      data-testid="stats-movement-recent"
      data-empty={rows.length === 0 ? "true" : "false"}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Recent sessions</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        Last 5, newest first. Delta is relative to the average top-set weight in
        this range.
      </p>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          No sessions yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {rows.map((r) => {
            const delta = r.weight - avgWeight;
            const deltaDisp = Math.round(displayWeight(delta, units) * 10) / 10;
            const sign = delta > 0 ? "+" : delta < 0 ? "" : "±";
            return (
              <li key={r.sessionId} data-testid="stats-movement-recent-row">
                <Link
                  href={`/app/sessions/${r.sessionId}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 6,
                    padding: "10px 12px",
                    background: "var(--cp-surface-soft)",
                    borderRadius: 6,
                    textDecoration: "none",
                    color: "var(--cp-text)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12 }}>
                      {formatLongDate(r.performedAt)}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                      {Math.round(displayWeight(r.weight, units) * 10) / 10} {uLabel} ×{" "}
                      {r.reps}
                      {r.rpe != null ? ` @ ${r.rpe}` : ""}
                    </div>
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      alignSelf: "center",
                      color:
                        delta > 0
                          ? "var(--cp-success)"
                          : delta < 0
                            ? "var(--cp-warning)"
                            : "var(--cp-text-muted)",
                    }}
                  >
                    {sign}
                    {deltaDisp} {uLabel}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── H · Sister movements ───────────────────────────────────────────

function SisterMovementsCard({
  sisters,
  units,
}: {
  sisters: SisterMovement[];
  units: WeightUnit;
}) {
  const uLabel = weightUnitLabel(units);
  return (
    <section
      className="cp-card"
      style={{ padding: 20 }}
      data-testid="stats-movement-sisters"
      data-empty={sisters.length === 0 ? "true" : "false"}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Movements that train the same role</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        Peers by movement pattern (squat / press / pull / hinge) and overlapping
        functional roles.
      </p>
      {sisters.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          No sister movements in the catalog yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {sisters.map((s) => (
            <li key={s.id} data-testid="stats-movement-sister-row">
              <Link
                href={`/app/stats/movements/${s.slug}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 10,
                  padding: "10px 12px",
                  background: "var(--cp-surface-soft)",
                  borderRadius: 6,
                  textDecoration: "none",
                  color: "var(--cp-text)",
                  fontSize: 12,
                }}
              >
                <span>{s.displayName}</span>
                <span className="mono" style={{ color: "var(--cp-text-muted)" }}>
                  {s.e1rm != null
                    ? `${Math.round(displayWeight(s.e1rm, units) * 10) / 10} ${uLabel}`
                    : "—"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── TM history (carried forward from Phase 1) ──────────────────────

type TmHistoryRow = {
  id: string;
  oldTm: number | null;
  newTm: number;
  reason: TmChangeReason;
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

function TmHistoryCard({ rows, units }: { rows: TmHistoryRow[]; units: WeightUnit }) {
  const uLabel = weightUnitLabel(units);
  const w = (kg: number) => Math.round(displayWeight(kg, units) * 10) / 10;
  return (
    <section className="cp-card" style={{ padding: 20 }} data-testid="stats-movement-tm-history">
      <h2 style={{ margin: 0, fontSize: 16 }}>Training-max history</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        Every TM change, with the trigger that caused it.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
        {[...rows].reverse().slice(0, 8).map((row) => (
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
              {row.oldTm != null ? `${w(row.oldTm)} → ` : ""}
              {w(row.newTm)} {uLabel}
            </span>
            <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
              {formatDate(row.changedAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── helpers ────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  const dow = d.toLocaleDateString(undefined, { weekday: "short" });
  return `${dow} · ${d.toLocaleDateString()}`;
}
