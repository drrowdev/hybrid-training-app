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
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  detectRpeCreep,
  filterSeriesToRange,
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
  type SwapEvent,
  type SisterMovement,
} from "@/lib/stats/movement";
import {
  parseRange,
  type Range,
} from "@/lib/stats/range";
import { displayWeight, weightUnitLabel, type WeightUnit } from "@/lib/stats/units";
import { HrZonesCard } from "@/components/cardio/HrZonesCard";
import { PacePRsCard } from "@/components/cardio/PacePRsCard";
import { getHrZones } from "@/lib/stats/hr-zones";
import { getPacePrs } from "@/lib/stats/pace-prs";
import { getUserTimezone } from "@/lib/planner/queries";
import type { TmChangeReason } from "@hta/db";
import { formatDate as fmtDate } from "@/lib/format/datetime";
import {
  MovementRangeView,
  type MovementByRange,
} from "@/components/stats/MovementRangeView";

type FmtProfile = Parameters<typeof fmtDate>[1];

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
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("units, timezone, time_format, date_format")
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

  // Pre-compute per-range slices + the slope / creep that the client
  // toggle needs so the client comp is purely presentational. The raw
  // working-set series is read once (all-time); slicing happens here.
  // Audit F4 measured the worst regression on this page because every
  // range click also re-ran getSisterMovements (audit F6).
  const RANGES: Range[] = ["30d", "90d", "all"];
  const byRange: MovementByRange = Object.fromEntries(
    RANGES.map((r) => {
      const topSets = filterSeriesToRange(topSetsAll, r);
      const volume = filterSeriesToRange(volumeAll, r);
      const rpe = filterSeriesToRange(rpeAll, r);
      const slopePerDay = linearRegressionSlopePerDay(topSets);
      const slopePerDayDisplay =
        slopePerDay != null ? displayWeight(slopePerDay, units) : null;
      return [
        r,
        {
          topSets,
          volume,
          rpe,
          creep: detectRpeCreep(rpe),
          e1rmSlopePerDayDisplay: slopePerDayDisplay,
        },
      ];
    }),
  ) as MovementByRange;

  const currentE1rm = getCurrentE1rmFromSeries(topSetsAll);
  const bestEver = getBestEverE1rmFromSeries(topSetsAll);

  const tmHistoryRows = tmHistoryRowsRes.data ?? [];

  // Cardio movements get the Strava-gated HR-zones + pace-PR cards on
  // top of the strength deep-dive. Pattern check keeps these off the
  // strength surfaces (where they'd be empty by construction).
  const isCardio = meta?.pattern === "cardio";
  const cardioTz = isCardio ? await getUserTimezone(user.id) : null;
  const [hrZones, pacePrs] = isCardio
    ? await Promise.all([
        getHrZones(supabase, user.id, cardioTz ?? "UTC"),
        getPacePrs(supabase, user.id, cardioTz ?? "UTC"),
      ])
    : [null, null];

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
            ? `Best ever: ${w(bestEver.e1rm)} ${uLabel} on ${formatDate(bestEver.performedAt, profile)}`
            : "No working sets yet"}
          {tmKg != null && (
            <>
              {" · "}TM: <span className="mono">{w(tmKg)} {uLabel}</span>
            </>
          )}
        </div>

        {/* Range toggle + range-dependent cards (B/C/D/E/G) live in
            this client wrapper so flipping range is a state swap, not
            a server round trip + the N+1 sister query (audit F4). */}
        <MovementRangeView
          slug={movement.slug}
          initialRange={range}
          byRange={byRange}
          units={units}
          formatProfile={profile}
        />
      </header>

      {isCardio && hrZones && pacePrs && (
        <>
          <HrZonesCard state={hrZones} />
          <PacePRsCard state={pacePrs} />
        </>
      )}

      {/* ── F · Swap history ─────────────────────────────────────── */}
      <SwapHistoryCard events={swapEvents} formatProfile={profile} />

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
          formatProfile={profile}
        />
      )}
    </div>
  );
}

// ── F · Swap history ───────────────────────────────────────────────

function SwapHistoryCard({ events, formatProfile }: { events: SwapEvent[]; formatProfile: FmtProfile }) {
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
                  {formatDate(ev.swappedAt, formatProfile)}
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

function TmHistoryCard({ rows, units, formatProfile }: { rows: TmHistoryRow[]; units: WeightUnit; formatProfile: FmtProfile }) {
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
              {formatDate(row.changedAt, formatProfile)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── helpers ────────────────────────────────────────────────────────

function formatDate(iso: string, profile: FmtProfile): string {
  return fmtDate(iso, profile);
}
