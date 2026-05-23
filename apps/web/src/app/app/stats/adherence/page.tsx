/**
 * /app/stats/adherence — Phase 4 adherence dashboard.
 *
 * Five sections, mobile-first stack:
 *
 *   A1 Weekly completion — stacked bars per ISO week (logged / skipped /
 *      missed). Headline chart. Subtitle pins the methodology rule that
 *      "skipped counts as missed" for the running % we surface to the
 *      right of each bar.
 *   A2 Weekday breakdown — 7 columns Mon-Sun, each showing the weekday
 *      completion % (color-coded ≥80 / 50-79 / <50) and a stacked mini
 *      bar in absolute counts.
 *   A3 Per-archetype completion — sorted by block count desc.
 *   A4 Skip notes — last 10 skipped sessions surfaced with the planned
 *      title (`planned_sessions` has no per-skip note column today so
 *      we render the "without notes" fallback the brief calls out).
 *   A5 Streaks — current + longest, computed by `computeStreaks`.
 *
 * Range toggle differs from Phase 1-3 on purpose: adherence buckets are
 * more natural in weeks (12w / 26w / all). The parser
 * (`parseAdherenceRange`) lives next to the data helpers so the
 * convention stays local to this surface.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import {
  ADHERENCE_RANGE_LABEL,
  DEFAULT_ADHERENCE_RANGE,
  getAdherenceDashboard,
  parseAdherenceRange,
  type AdherenceRange,
  type ArchetypeBucket,
  type SkippedNote,
  type Streaks,
  type WeekBucket,
  type WeekdayBucket,
  type WeekdayBuckets,
} from "@/lib/stats/adherence-detail";
import type { WeekdayOverrideSummary } from "@/lib/engine/overrides";
import { StackedBars } from "@/components/stats/charts/StackedBars";
import { RunPlanAdherenceCard } from "@/components/cardio/RunPlanAdherenceCard";
import { HrZonesCard } from "@/components/cardio/HrZonesCard";
import { PacePRsCard } from "@/components/cardio/PacePRsCard";
import { getRunPlanAdherence } from "@/lib/stats/run-plan-adherence";
import { getHrZones } from "@/lib/stats/hr-zones";
import { getPacePrs } from "@/lib/stats/pace-prs";

export const dynamic = "force-dynamic";

export default async function StatsAdherencePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const params = await searchParams;
  const range = parseAdherenceRange(params.range);

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

  const [dashboard, runPlan, hrZones, pacePrs] = await Promise.all([
    getAdherenceDashboard(supabase, user.id, tz, range),
    getRunPlanAdherence(supabase, user.id, tz),
    getHrZones(supabase, user.id, tz),
    getPacePrs(supabase, user.id, tz),
  ]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <Link
          href="/app/stats"
          data-testid="stats-adherence-back"
          style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
        >
          ← stats
        </Link>
        <h1 style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          Adherence
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          Sessions completed vs planned, the weekdays you train best, and
          how skipped sessions accumulate. Skipped counts as missed for
          every % we report.
        </p>
      </header>

      <RangeToggle current={range} />

      <RunPlanAdherenceCard
        weeks={runPlan.weeks}
        hasPlan={runPlan.hasPlan}
        hasStravaConnection={runPlan.hasStravaConnection}
      />

      <HrZonesCard state={hrZones} />

      <PacePRsCard state={pacePrs} />

      <WeeklyCard weeks={dashboard.weekly} range={range} />

      <div
        data-testid="stats-adherence-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        <WeekdayCard
          weekday={dashboard.weekday}
          overrides={dashboard.overridesByWeekday}
        />
        <ArchetypeCard rows={dashboard.archetypes} />
        <StreaksCard streaks={dashboard.streaks} totalPlanned={dashboard.totalPlanned} />
      </div>

      <SkipNotesCard rows={dashboard.skipped} />

      <footer
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 4,
        }}
      >
        <Link
          href="/app/stats"
          data-testid="stats-adherence-overview-link"
          style={{ color: "var(--cp-text-muted)", fontSize: 13, textDecoration: "none" }}
        >
          ← Stats overview
        </Link>
        <Link
          href="/app/stats/blocks"
          data-testid="stats-adherence-blocks-link"
          style={{ color: "var(--cp-accent)", fontSize: 13, textDecoration: "none" }}
        >
          View block outcomes →
        </Link>
      </footer>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Range toggle
// ──────────────────────────────────────────────────────────────────────

function RangeToggle({ current }: { current: AdherenceRange }) {
  const opts: AdherenceRange[] = ["12w", "26w", "all"];
  return (
    <nav
      data-testid="stats-adherence-range-toggle"
      aria-label="Range"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 3,
        borderRadius: 999,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface)",
        width: "fit-content",
      }}
    >
      {opts.map((opt) => {
        const active = opt === current;
        const href =
          opt === DEFAULT_ADHERENCE_RANGE
            ? "/app/stats/adherence"
            : `/app/stats/adherence?range=${opt}`;
        return (
          <Link
            key={opt}
            href={href}
            data-testid="stats-adherence-range-option"
            data-range={opt}
            data-active={active ? "true" : "false"}
            scroll={false}
            style={{
              fontSize: 12,
              padding: "5px 12px",
              borderRadius: 999,
              textDecoration: "none",
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: active ? "var(--cp-accent)" : "var(--cp-text-muted)",
              background: active ? "var(--cp-accent-soft)" : "transparent",
            }}
          >
            {ADHERENCE_RANGE_LABEL[opt]}
          </Link>
        );
      })}
    </nav>
  );
}

// ──────────────────────────────────────────────────────────────────────
// A1 — Weekly completion
// ──────────────────────────────────────────────────────────────────────

function WeeklyCard({ weeks, range }: { weeks: WeekBucket[]; range: AdherenceRange }) {
  const wide = true;
  if (weeks.length === 0) {
    return (
      <Card testId="stats-adherence-weekly" empty wide={wide}>
        <CardTitle
          title="Sessions completed vs planned"
          subtitle="Skipped sessions count as missed"
        />
        <EmptyText>Build a block to see adherence trends</EmptyText>
      </Card>
    );
  }
  const totals = weeks.reduce(
    (acc, w) => ({
      logged: acc.logged + w.logged,
      skipped: acc.skipped + w.skipped,
      missed: acc.missed + w.missed,
    }),
    { logged: 0, skipped: 0, missed: 0 },
  );
  const total = totals.logged + totals.skipped + totals.missed;
  const overallPct = total === 0 ? 0 : totals.logged / total;
  const subtitle = `${ADHERENCE_RANGE_LABEL[range]} · ${pctLabel(overallPct)} overall`;

  return (
    <Card testId="stats-adherence-weekly" wide={wide}>
      <CardTitle
        title="Sessions completed vs planned"
        subtitle={subtitle}
        tooltip="Skipped sessions count as missed: the user explicitly chose not to do the planned session, so it's a deviation from the plan — not a neutral 'didn't happen'."
      />
      <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
        <div
          style={{
            flex: "1 1 320px",
            minWidth: 240,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <StackedBars
            bars={weeks.map((w) => ({
              segments: [w.logged, w.skipped, w.missed],
              label: w.weekStart,
            }))}
            segmentColors={["success", "warning", "neutral"]}
            ariaLabel={`weekly stacked bars across ${weeks.length} weeks; segments are logged, skipped, missed`}
            style={{ height: 80 }}
          />
          <ul
            data-testid="stats-adherence-weekly-axis"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${weeks.length}, 1fr)`,
              gap: 2,
              margin: 0,
              padding: 0,
              listStyle: "none",
            }}
          >
            {weeks.map((w) => (
              <li
                key={w.weekStart}
                data-testid="stats-adherence-week-cell"
                data-week-start={w.weekStart}
                title={`Week of ${formatShortDate(w.weekStart)} — ${w.logged} logged / ${w.skipped} skipped / ${w.missed} missed (${pctLabel(w.percentage)})`}
                style={{
                  fontSize: 9,
                  color: "var(--cp-text-muted)",
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <span style={{ display: "block" }}>{formatShortDate(w.weekStart)}</span>
                <span
                  style={{
                    display: "block",
                    fontWeight: 600,
                    color: percentageColor(w.percentage, w.logged + w.skipped + w.missed),
                  }}
                  data-testid="stats-adherence-week-pct"
                >
                  {w.logged + w.skipped + w.missed === 0 ? "—" : pctLabel(w.percentage)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Legend
          items={[
            { label: "Logged", color: "var(--cp-success)" },
            { label: "Skipped", color: "var(--cp-warning)" },
            { label: "Missed", color: "var(--cp-border)" },
          ]}
        />
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// A2 — Weekday breakdown
// ──────────────────────────────────────────────────────────────────────

function WeekdayCard({
  weekday,
  overrides,
}: {
  weekday: WeekdayBuckets;
  overrides: WeekdayOverrideSummary[];
}) {
  const cols: WeekdayBucket[] = [
    weekday.mon,
    weekday.tue,
    weekday.wed,
    weekday.thu,
    weekday.fri,
    weekday.sat,
    weekday.sun,
  ];
  // ISO weekday Mon=1..Sun=7 → align to cols index 0..6.
  const overrideByIndex = new Map<number, WeekdayOverrideSummary>();
  for (const o of overrides) overrideByIndex.set(o.weekday - 1, o);
  if (weekday.totalPlanned === 0 || weekday.rangeWeeks < 4) {
    return (
      <Card testId="stats-adherence-weekday" empty>
        <CardTitle
          title="When you train (vs when you planned to)"
          subtitle="Higher = more reliable"
        />
        <EmptyText>Need at least 4 weeks of planned sessions</EmptyText>
      </Card>
    );
  }
  const maxCount = Math.max(
    1,
    ...cols.map((c) => c.logged + c.skipped + c.missed),
  );
  return (
    <Card testId="stats-adherence-weekday">
      <CardTitle
        title="When you train (vs when you planned to)"
        subtitle="Higher = more reliable"
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
        }}
      >
        {cols.map((col, idx) => {
          const total = col.logged + col.skipped + col.missed;
          const overrideCount = overrideByIndex.get(idx)?.totalCount ?? 0;
          return (
            <div
              key={col.weekdayIndex}
              data-testid="stats-adherence-weekday-cell"
              data-weekday={col.weekdayLabel}
              data-override-count={overrideCount}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span style={{ fontSize: 10, color: "var(--cp-text-muted)" }}>
                {col.weekdayLabel}
              </span>
              <span
                data-testid="stats-adherence-weekday-pct"
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: percentageColor(col.percentage, total),
                }}
              >
                {total === 0 ? "—" : pctLabel(col.percentage)}
              </span>
              <MiniStackVertical
                logged={col.logged}
                skipped={col.skipped}
                missed={col.missed}
                max={maxCount}
              />
              <span style={{ fontSize: 9, color: "var(--cp-text-muted)" }}>
                {col.logged}/{total}
              </span>
              {overrideCount > 0 && (
                <span
                  style={{ fontSize: 9, color: "var(--cp-text-muted)" }}
                  title={`${overrideCount} override event${overrideCount === 1 ? "" : "s"} on ${col.weekdayLabel} in this range`}
                  data-testid="stats-adherence-weekday-overrides"
                >
                  · {overrideCount}↯
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function MiniStackVertical({
  logged,
  skipped,
  missed,
  max,
}: {
  logged: number;
  skipped: number;
  missed: number;
  max: number;
}) {
  const total = logged + skipped + missed;
  const H = 32;
  const W = 18;
  if (total === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H }}>
        <line x1={1} x2={W - 1} y1={H - 1} y2={H - 1} stroke="var(--cp-border)" />
      </svg>
    );
  }
  const fullH = Math.max(2, (total / max) * (H - 2));
  const loggedH = (logged / total) * fullH;
  const skippedH = (skipped / total) * fullH;
  const missedH = (missed / total) * fullH;
  const bottom = H - 1;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: W, height: H }}
      data-testid="stats-adherence-weekday-stack"
    >
      <rect
        x={2}
        y={bottom - missedH}
        width={W - 4}
        height={missedH}
        fill="var(--cp-border)"
      />
      <rect
        x={2}
        y={bottom - missedH - skippedH}
        width={W - 4}
        height={skippedH}
        fill="var(--cp-warning)"
      />
      <rect
        x={2}
        y={bottom - missedH - skippedH - loggedH}
        width={W - 4}
        height={loggedH}
        fill="var(--cp-success)"
      />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────
// A3 — Per-archetype
// ──────────────────────────────────────────────────────────────────────

function ArchetypeCard({ rows }: { rows: ArchetypeBucket[] }) {
  if (rows.length === 0) {
    return (
      <Card testId="stats-adherence-archetype" empty>
        <CardTitle title="By block type" subtitle="Sorted by most used" />
        <EmptyText>Need at least 1 completed block</EmptyText>
      </Card>
    );
  }
  return (
    <Card testId="stats-adherence-archetype">
      <CardTitle title="By block type" subtitle="Sorted by most used" />
      <ul
        style={{
          display: "grid",
          gap: 10,
          margin: 0,
          padding: 0,
          listStyle: "none",
        }}
      >
        {rows.map((r) => {
          const total = r.logged + r.skipped + r.missed;
          return (
            <li
              key={r.archetypeId}
              data-testid="stats-adherence-archetype-row"
              data-archetype={r.archetypeId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 6,
                alignItems: "center",
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {r.displayName}
                </span>
                <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                  {r.blockCount} block{r.blockCount === 1 ? "" : "s"} ·{" "}
                  {r.logged}/{total} logged
                </span>
                <InlineStack
                  logged={r.logged}
                  skipped={r.skipped}
                  missed={r.missed}
                />
              </div>
              <span
                data-testid="stats-adherence-archetype-pct"
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: percentageColor(r.percentage, total),
                }}
              >
                {total === 0 ? "—" : pctLabel(r.percentage)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function InlineStack({
  logged,
  skipped,
  missed,
}: {
  logged: number;
  skipped: number;
  missed: number;
}) {
  const total = logged + skipped + missed;
  if (total === 0) {
    return (
      <div
        style={{
          height: 4,
          background: "var(--cp-border)",
          borderRadius: 2,
        }}
      />
    );
  }
  const loggedPct = (logged / total) * 100;
  const skippedPct = (skipped / total) * 100;
  const missedPct = (missed / total) * 100;
  return (
    <div
      style={{
        display: "flex",
        height: 6,
        borderRadius: 3,
        overflow: "hidden",
        background: "var(--cp-border)",
      }}
    >
      <span
        style={{
          width: `${loggedPct}%`,
          background: "var(--cp-success)",
        }}
      />
      <span
        style={{
          width: `${skippedPct}%`,
          background: "var(--cp-warning)",
        }}
      />
      <span
        style={{
          width: `${missedPct}%`,
          background: "var(--cp-border)",
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// A4 — Skip notes
// ──────────────────────────────────────────────────────────────────────

function SkipNotesCard({ rows }: { rows: SkippedNote[] }) {
  if (rows.length === 0) {
    return (
      <Card testId="stats-adherence-skipped" empty wide>
        <CardTitle
          title="When you skipped, what did you write?"
          subtitle="Last 10 skipped sessions"
        />
        <EmptyText>No skipped sessions in this range — nice</EmptyText>
      </Card>
    );
  }
  const anyNotes = rows.some((r) => r.note && r.note.trim().length > 0);
  return (
    <Card testId="stats-adherence-skipped" wide>
      <CardTitle
        title={
          anyNotes
            ? "When you skipped, what did you write?"
            : "Sessions you skipped (without notes)"
        }
        subtitle={`Last ${rows.length} skipped session${rows.length === 1 ? "" : "s"}`}
      />
      <ul style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
        {rows.map((r) => (
          <li
            key={r.plannedId}
            data-testid="stats-adherence-skipped-row"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 8,
              padding: "6px 0",
              borderBottom: "1px solid var(--cp-border)",
            }}
          >
            <div style={{ display: "grid", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</span>
              <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                {formatLongDate(r.date)} · {r.archetypeDisplayName}
              </span>
              {r.note && r.note.trim().length > 0 && (
                <span style={{ fontSize: 12, color: "var(--cp-text)" }}>
                  {truncate(r.note, 80)}
                </span>
              )}
            </div>
            <Link
              href={`/app/stats/blocks/${r.blockId}`}
              data-testid="stats-adherence-skipped-link"
              style={{
                fontSize: 12,
                color: "var(--cp-accent)",
                textDecoration: "none",
                whiteSpace: "nowrap",
                alignSelf: "center",
              }}
            >
              View →
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// A5 — Streaks
// ──────────────────────────────────────────────────────────────────────

function StreaksCard({
  streaks,
  totalPlanned,
}: {
  streaks: Streaks;
  totalPlanned: number;
}) {
  if (totalPlanned === 0 && streaks.currentDays === 0 && streaks.longestDays === 0) {
    return (
      <Card testId="stats-adherence-streaks" empty>
        <CardTitle title="Streaks" subtitle="Logged + rest days count" />
        <EmptyText>Start logging to build a streak</EmptyText>
      </Card>
    );
  }
  return (
    <Card testId="stats-adherence-streaks">
      <CardTitle
        title="Streaks"
        subtitle="Logged sessions and rest days count. Skips break the streak."
      />
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <span
            data-testid="stats-adherence-streak-current"
            style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" }}
          >
            {streaks.currentDays}{" "}
            <span style={{ fontSize: 13, color: "var(--cp-text-muted)", fontWeight: 400 }}>
              day{streaks.currentDays === 1 ? "" : "s"}
            </span>
          </span>
          <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
            Current streak
          </span>
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          <span
            data-testid="stats-adherence-streak-longest"
            style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" }}
          >
            {streaks.longestDays}{" "}
            <span style={{ fontSize: 13, color: "var(--cp-text-muted)", fontWeight: 400 }}>
              day{streaks.longestDays === 1 ? "" : "s"}
            </span>
          </span>
          <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
            Longest in range
          </span>
        </div>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Shared bits
// ──────────────────────────────────────────────────────────────────────

function Card({
  testId,
  empty,
  wide,
  children,
}: {
  testId: string;
  empty?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className="cp-card"
      data-testid={testId}
      data-empty={empty ? "true" : "false"}
      style={{
        padding: 16,
        display: "grid",
        gap: 8,
        gridColumn: wide ? "1 / -1" : undefined,
      }}
    >
      {children}
    </section>
  );
}

function CardTitle({
  title,
  subtitle,
  tooltip,
}: {
  title: string;
  subtitle?: string;
  tooltip?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {title}
      </div>
      {subtitle && (
        <div
          style={{
            fontSize: 11,
            color: "var(--cp-text-muted)",
            marginTop: 2,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {subtitle}
          {tooltip && (
            <span
              data-testid="stats-adherence-tooltip"
              title={tooltip}
              aria-label={tooltip}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: "1px solid var(--cp-border)",
                fontSize: 9,
                color: "var(--cp-text-muted)",
                cursor: "help",
              }}
            >
              i
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>{children}</p>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul
      data-testid="stats-adherence-weekly-legend"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        margin: 0,
        padding: 0,
        listStyle: "none",
        alignSelf: "center",
      }}
    >
      {items.map((it) => (
        <li
          key={it.label}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}
        >
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 2,
              background: it.color,
            }}
          />
          <span style={{ color: "var(--cp-text-muted)" }}>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

function pctLabel(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function percentageColor(ratio: number, total: number): string {
  if (total === 0) return "var(--cp-text-muted)";
  if (ratio >= 0.8) return "var(--cp-success)";
  if (ratio >= 0.5) return "var(--cp-warning)";
  return "var(--cp-danger)";
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatShortDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map((s) => Number.parseInt(s, 10));
  return `${MONTHS[m - 1]} ${d}`;
}

function formatLongDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((s) => Number.parseInt(s, 10));
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
