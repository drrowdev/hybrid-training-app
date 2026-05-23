import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  formatPrescriptionItem,
  summarisePrescription,
  roundToPlate,
} from "@/lib/planner/archetypes";
import {
  archetypeDisplayName,
  getActiveBlock,
  getTodayPlannedSessions,
  getUpcomingPlannedSessions,
  type PlannedDay,
} from "@/lib/planner/queries";
import { getTrainingMaxDict } from "@/lib/training-maxes/queries";
import { todayYmd } from "@/lib/dates";
import { effectiveTimeOfDay, gapHoursBetween } from "@/lib/planner/time-of-day";
import { getRegionFreshness, type RegionFreshnessRow, type FreshnessConflict } from "@/lib/stats/region-freshness-queries";
import { getMuscleFreshness } from "@/lib/muscle/muscle-freshness";
import { findHeavyOnRecoveringConflictWithMuscles } from "@/lib/muscle/muscle-conflict";
import { StravaStaleSyncTrigger } from "@/components/StravaStaleSyncTrigger";
import { StravaPoweredBadge } from "@/components/StravaPoweredBadge";
import { computeTaperRecommendation, type TaperRecommendation } from "@/lib/planner/taper";
import { BodyweightNudge } from "@/components/today/BodyweightNudge";
import { HowRecoveredCard } from "@/components/today/HowRecoveredCard";
import { DataRail } from "@/components/today/DataRail";
import { EmptyState } from "@/components/ui/EmptyState";
import type { WeekDayCell } from "@/components/today/WeekDotsCard";
import { recordDailyCheckIn } from "@/lib/wellness/actions";
import { listTrainingMaxes } from "@/lib/training-maxes/queries";
import { mondayOfYmd, addDaysToYmd, isoWeekdayYmd } from "@/lib/dates";

const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function todayLabel(d = new Date()) {
  return `${DOW_LONG[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, timezone, am_window_start, pm_window_start")
    .eq("id", userId)
    .maybeSingle();

  const todayIso = todayYmd(profile?.timezone ?? "UTC");

  const [{ data: todaySessions }, { data: recent }, plannedToday, upcoming, freshness, activeBlock, tmDict, tmRows] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, title, slot, completed_at, performed_at")
      .is("deleted_at", null)
      .gte("performed_at", `${todayIso}T00:00:00`)
      .lt("performed_at", `${todayIso}T23:59:59`)
      .order("performed_at", { ascending: false }),
    supabase
      .from("sessions")
      .select("id, title, performed_at, completed_at, session_rpe, duration_min")
      .is("deleted_at", null)
      .not("completed_at", "is", null)
      .order("performed_at", { ascending: false })
      .limit(8),
    getTodayPlannedSessions(),
    getUpcomingPlannedSessions(5),
    getRegionFreshness(supabase, userId),
    getActiveBlock(),
    getTrainingMaxDict(),
    listTrainingMaxes(),
  ]);

  const archetypeName = activeBlock
    ? archetypeDisplayName(activeBlock.archetype, activeBlock.notes)
    : null;
  const tmById: Record<string, number> = Object.fromEntries(
    Array.from(tmDict.byMovementId.entries()),
  );

  // Strava integration state: do we have a connection (drives the
  // background stale-sync trigger) and have we ever imported anything
  // (drives the attribution badge)?
  const [{ data: stravaConn }, { count: stravaCardioCount }] = await Promise.all([
    supabase
      .from("strava_connections")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("cardio_logs")
      .select("id", { count: "exact", head: true })
      .eq("external_source", "strava"),
  ]);
  const hasStravaConnection = Boolean(stravaConn);
  const hasStravaData = (stravaCardioCount ?? 0) > 0;

  // Phase 3 A2 — bodyweight nudge: only render the card if the user
  // hasn't logged a bodyweight in the past 7 days. RLS scopes the
  // query to the current user automatically.
  const sevenDaysAgoIso = (() => {
    const d = new Date(todayIso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  })();
  const { data: recentBodyweight } = await supabase
    .from("wellness")
    .select("date")
    .not("bodyweight_kg", "is", null)
    .gte("date", sevenDaysAgoIso)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const showBodyweightNudge = !recentBodyweight;

  // Phase 2: next priority event + taper recommendation.
  const { data: nextEvent } = await supabase
    .from("priority_events")
    .select("name, event_date, priority")
    .eq("user_id", userId)
    .gte("event_date", todayIso)
    .order("event_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  const taper = computeTaperRecommendation(
    nextEvent
      ? { name: nextEvent.name, date: nextEvent.event_date, priority: nextEvent.priority }
      : null,
  );

  // DC-V2 soft warning: fetch the regions of the movements planned today
  // so we can flag heavy work on a clearly recovering region. The PR
  // feat/muscle-grid-16 also adds muscle-level resolution when the
  // movement has a known slug fanout.
  const plannedMovementIds = Array.from(
    new Set(plannedToday.flatMap((p) => p.prescription.items.map((i) => i.movementId))),
  );
  const movementRegionById = new Map<string, { primaryRegion: string; name: string }>();
  const movementSlugById = new Map<string, string | null>();
  if (plannedMovementIds.length > 0) {
    const { data: movs } = await supabase
      .from("movements")
      .select("id, name, slug, primary_region")
      .in("id", plannedMovementIds);
    for (const m of movs ?? []) {
      movementRegionById.set(m.id, {
        primaryRegion: m.primary_region as string,
        name: m.name as string,
      });
      movementSlugById.set(m.id, (m.slug as string | null) ?? null);
    }
  }
  const freshnessByRegion = new Map(
    freshness.map((r) => [r.region, { freshness: r.freshness, regionLabel: r.regionLabel }]),
  );
  // Muscle-level freshness (PR feat/muscle-grid-16). Cheap when cached
  // by the 03:00 UTC cron; otherwise computed live in parallel above
  // is not yet wired — fetch here.
  const muscleFreshnessRows = await getMuscleFreshness(supabase, userId, {
    tz: profile?.timezone ?? "UTC",
  });
  const conflictsBySlot = new Map<string, FreshnessConflict>();
  for (const p of plannedToday) {
    const itemsWithSlug = p.prescription.items.map((i) => ({
      ...i,
      movementSlug: movementSlugById.get(i.movementId) ?? null,
    }));
    const c = findHeavyOnRecoveringConflictWithMuscles(
      itemsWithSlug,
      movementRegionById,
      freshnessByRegion,
      muscleFreshnessRows,
    );
    if (c) conflictsBySlot.set(p.id, c);
  }

  const openSession = (todaySessions ?? []).find((s) => !s.completed_at) ?? null;
  const completedToday = (todaySessions ?? []).filter((s) => s.completed_at);
  const isTwoADay = plannedToday.length > 1;
  const timezone = profile?.timezone ?? "UTC";
  const amWindowStart = profile?.am_window_start ?? "07:00:00";
  const pmWindowStart = profile?.pm_window_start ?? "17:00:00";

  // Compute the current ISO week's day cells for the right-rail
  // WeekDotsCard. Mon=0..Sun=6. We bucket completed sessions into
  // strength vs cardio by checking cardio_logs membership, and overlay
  // planned days from the active block.
  const monday = mondayOfYmd(todayIso);
  const sunday = addDaysToYmd(monday, 6);
  const todayDow = isoWeekdayYmd(todayIso); // 0=Mon..6=Sun

  const [{ data: weekSessions }, { data: weekCardioRows }, { data: weekPlannedRows }] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, performed_at")
      .is("deleted_at", null)
      .not("completed_at", "is", null)
      .gte("performed_at", `${monday}T00:00:00`)
      .lt("performed_at", `${addDaysToYmd(sunday, 1)}T00:00:00`),
    supabase
      .from("cardio_logs")
      .select("session_id, sessions!inner(performed_at, deleted_at, completed_at)")
      .gte("sessions.performed_at", `${monday}T00:00:00`)
      .lt("sessions.performed_at", `${addDaysToYmd(sunday, 1)}T00:00:00`)
      .is("sessions.deleted_at", null)
      .not("sessions.completed_at", "is", null),
    activeBlock
      ? supabase
          .from("planned_sessions")
          .select("week_index, day_index, completed_session_id")
          .eq("block_id", activeBlock.id)
      : Promise.resolve({ data: [] as Array<{ week_index: number; day_index: number; completed_session_id: string | null }> }),
  ]);

  const cardioSessionIds = new Set<string>(
    ((weekCardioRows ?? []) as Array<{ session_id: string }>).map((r) => r.session_id),
  );
  const weekStrengthDows = new Set<number>();
  const weekCardioDows = new Set<number>();
  for (const s of (weekSessions ?? []) as Array<{ id: string; performed_at: string }>) {
    const ymd = s.performed_at.slice(0, 10);
    // Only count days that actually fall in [monday..sunday]; the gte/lt
    // above scope by absolute instant so a session right after midnight
    // in a forward-shifted tz could land outside the calendar week.
    const dow = isoWeekdayYmd(ymd);
    if (dow < 0 || dow > 6) continue;
    if (cardioSessionIds.has(s.id)) weekCardioDows.add(dow);
    else weekStrengthDows.add(dow);
  }

  // Planned days for the current ISO week from the active block.
  const weekPlannedDows = new Set<number>();
  if (activeBlock) {
    const startMonday = mondayOfYmd(activeBlock.startedOn);
    for (const p of (weekPlannedRows ?? []) as Array<{
      week_index: number;
      day_index: number;
      completed_session_id: string | null;
    }>) {
      const dayYmd = addDaysToYmd(startMonday, p.week_index * 7 + p.day_index);
      if (dayYmd >= monday && dayYmd <= sunday && !p.completed_session_id) {
        weekPlannedDows.add(isoWeekdayYmd(dayYmd));
      }
    }
  }

  const weekDays: WeekDayCell[] = Array.from({ length: 7 }, (_, i) => ({
    strengthDone: weekStrengthDows.has(i),
    cardioDone: weekCardioDows.has(i),
    planned: weekPlannedDows.has(i),
    isToday: i === todayDow,
  }));
  const doneCount = weekDays.filter((d) => d.strengthDone || d.cardioDone).length;

  // Today's wellness row drives HowRecoveredCard's initial state.
  const { data: todayWellness } = await supabase
    .from("wellness")
    .select("fatigue, soreness")
    .eq("date", todayIso)
    .maybeSingle();
  const initialFatigue = (todayWellness?.fatigue ?? null) as number | null;
  const initialSoreness = (todayWellness?.soreness ?? null) as number | null;

  const computedWeekIndex = activeBlock
    ? Math.max(
        0,
        Math.floor(
          (Date.parse(todayIso) - Date.parse(activeBlock.startedOn)) /
            86_400_000 /
            7,
        ),
      )
    : null;

  const subtitleParts: string[] = [];
  if (archetypeName) subtitleParts.push(archetypeName);
  if (activeBlock) subtitleParts.push(`Week ${(computedWeekIndex ?? 0) + 1} of ${activeBlock.weeks}`);
  subtitleParts.push(todayLabel().split(" · ")[0]!); // long weekday

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: 24,
      }}
      className="today-shell"
    >
      {/* Two-column layout above 1100px — see <style> block below. */}
      <style>{`
        @media (min-width: 1100px) {
          .today-shell { grid-template-columns: minmax(0, 1fr) 280px !important; align-items: start; }
        }
      `}</style>

      <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
        <header>
          <div
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontWeight: 600,
            }}
          >
            {todayLabel()}
            {archetypeName && computedWeekIndex != null && (
              <>
                <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
                {archetypeName}
                <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
                Week {computedWeekIndex + 1}
              </>
            )}
          </div>
          <h1
            style={{
              fontSize: 36,
              margin: "4px 0 0",
              letterSpacing: "-0.02em",
              fontWeight: 700,
            }}
          >
            Today
          </h1>
          {activeBlock && (
            <div
              style={{
                fontSize: 13,
                color: "var(--cp-text-muted)",
                marginTop: 4,
              }}
            >
              {subtitleParts.join(" · ")}
            </div>
          )}
        </header>

        {taper && <TaperCard taper={taper} />}

        <TodaySessionCard
          openSession={openSession}
          completedToday={completedToday}
          plannedToday={plannedToday}
          isTwoADay={isTwoADay}
          timezone={timezone}
          amWindowStart={amWindowStart}
          pmWindowStart={pmWindowStart}
          conflictsBySlot={conflictsBySlot}
          archetypeName={archetypeName}
          weekIndex={computedWeekIndex}
          tmById={tmById}
          nextUpcoming={upcoming[0] ?? null}
        />

        <HowRecoveredCard
          todayYmd={todayIso}
          initialFatigue={initialFatigue}
          initialSoreness={initialSoreness}
          recordDailyCheckIn={recordDailyCheckIn}
        />

        <RegionFreshnessCard rows={freshness} hasStravaData={hasStravaData} />
        {hasStravaConnection && <StravaStaleSyncTrigger />}

        <section className="cp-card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Up next this week</h2>
            <Link href="/app/plan" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>full plan →</Link>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState
              variant="inline"
              title="No plan yet"
              body="Start a block and your upcoming sessions appear here. Pick an archetype that matches your current goal."
              action={{ label: "Start a block →", href: "/app/plan" }}
            />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(140px, 1fr))`, gap: 8 }}>
              {upcoming.map((u) => (
                <Link
                  key={u.id}
                  href={`/app/plan?week=${u.weekIndex}`}
                  style={{
                    border: "1px solid var(--cp-border)",
                    borderRadius: 12,
                    padding: 10,
                    textDecoration: "none",
                    color: "inherit",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    minHeight: 96,
                  }}
                >
                  <div style={{ fontSize: 10, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {new Date(u.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })} ·{" "}
                    <span style={{ color: "var(--cp-text)" }}>
                      {new Date(u.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                    {u.slot !== "single" && (
                      <span
                        data-testid={`upcoming-slot-${u.id}`}
                        className="mono"
                        style={{ marginLeft: 6, color: "var(--cp-accent)", fontWeight: 700 }}
                      >
                        · {u.slot.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>{u.title}</div>
                  <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: "auto" }}>
                    {summarisePrescription(u.prescription.items)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {showBodyweightNudge && (
          <BodyweightNudge
            todayYmd={todayIso}
            recordDailyCheckIn={recordDailyCheckIn}
          />
        )}

        <ActivitySection sessions={recent ?? []} todayIso={todayIso} />
      </div>

      <DataRail weekDays={weekDays} doneCount={doneCount} tmRows={tmRows} />
    </div>
  );
}

/**
 * Recent activity grouped by Today / Yesterday / Earlier. Replaces the
 * original flat list — same row structure, just bucketed.
 */
function ActivitySection({
  sessions,
  todayIso,
}: {
  sessions: Array<{
    id: string;
    title: string | null;
    performed_at: string;
    completed_at: string | null;
    session_rpe: number | null;
    duration_min: number | null;
  }>;
  todayIso: string;
}) {
  if (sessions.length === 0) {
    return (
      <section className="cp-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Recent activity</h2>
          <Link href="/app/sessions" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>View all →</Link>
        </div>
        <EmptyState
          variant="inline"
          title="No sessions yet"
          body="Sessions you log or import from Strava appear here, grouped by date."
        />
      </section>
    );
  }

  const yesterdayIso = addDaysToYmd(todayIso, -1);
  const groups: Array<{ key: "today" | "yesterday" | "earlier"; label: string; items: typeof sessions }> = [
    { key: "today", label: "Today", items: [] },
    { key: "yesterday", label: "Yesterday", items: [] },
    { key: "earlier", label: "Earlier", items: [] },
  ];
  for (const s of sessions) {
    const ymd = s.performed_at.slice(0, 10);
    if (ymd === todayIso) groups[0]!.items.push(s);
    else if (ymd === yesterdayIso) groups[1]!.items.push(s);
    else groups[2]!.items.push(s);
  }

  return (
    <section style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 4 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Recent activity</h2>
        <Link href="/app/sessions" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>View all →</Link>
      </div>
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.key} style={{ display: "grid", gap: 6 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.1em",
                color: "var(--cp-text-muted)",
                textTransform: "uppercase",
                fontWeight: 600,
                marginTop: 8,
              }}
            >
              {g.label}
            </div>
            {g.items.map((s) => (
              <Link
                key={s.id}
                href={`/app/sessions/${s.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "var(--cp-surface)",
                  border: "1px solid var(--cp-border)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.title ?? "Untitled session"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 2 }}>
                    {s.completed_at ? "✓ complete" : "in progress"}
                    {s.session_rpe ? ` · sRPE ${s.session_rpe}` : ""}
                    {s.duration_min ? ` · ${s.duration_min} min` : ""}
                  </div>
                </div>
                <span style={{ color: "var(--cp-text-muted)", fontSize: 16 }} aria-hidden>›</span>
              </Link>
            ))}
          </div>
        ))}
    </section>
  );
}

function TodaySessionCard({
  openSession,
  completedToday,
  plannedToday,
  isTwoADay,
  timezone,
  amWindowStart,
  pmWindowStart,
  conflictsBySlot,
  archetypeName,
  weekIndex,
  tmById,
  nextUpcoming,
}: {
  openSession: { id: string; title: string | null } | null;
  completedToday: { id: string; title: string | null }[];
  plannedToday: PlannedDay[];
  isTwoADay: boolean;
  timezone: string;
  amWindowStart: string;
  pmWindowStart: string;
  conflictsBySlot: Map<string, FreshnessConflict>;
  archetypeName: string | null;
  weekIndex: number | null;
  tmById: Record<string, number>;
  nextUpcoming: PlannedDay | null;
}) {
  if (openSession) {
    return (
      <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Resume today&apos;s session
        </div>
        <h2 style={{ fontSize: 22, margin: 0 }}>{openSession.title ?? "In-progress session"}</h2>
        <p style={{ color: "var(--cp-text-muted)", margin: 0, fontSize: 14 }}>
          You started this earlier today. Pick up where you left off.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href={`/app/sessions/${openSession.id}`} className="cp-btn primary big">
            ⚡ Resume session
          </Link>
          <Link href={`/app/sessions/${openSession.id}/complete`} className="cp-btn">
            Wrap up
          </Link>
        </div>
      </section>
    );
  }

  if (completedToday.length > 0 && plannedToday.length <= completedToday.length) {
    // All planned slots for today are logged.
    return (
      <section
        className="cp-card"
        data-testid="today-logged"
        style={{ padding: 20, display: "grid", gap: 12 }}
      >
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Today, so far
        </div>
        <h2 style={{ fontSize: 22, margin: 0 }}>
          {completedToday.length === 1 ? "Session logged ✓" : `${completedToday.length} sessions logged ✓`}
        </h2>
        <p style={{ color: "var(--cp-text-muted)", margin: 0, fontSize: 14 }}>
          {completedToday[0]?.title ?? "Untitled session"} — rest and recover. Tomorrow is in the plan.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/app/sessions/new" className="cp-btn">Add another session</Link>
          <Link href="/app/plan" className="cp-btn">See tomorrow →</Link>
        </div>
      </section>
    );
  }

  if (plannedToday.length === 0) {
    return (
      <section
        className="cp-card"
        data-testid="today-rest"
        style={{ padding: 24, display: "grid", gap: 14, minHeight: 220 }}
      >
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
          {archetypeName && weekIndex != null
            ? `${archetypeName} · Week ${weekIndex + 1}`
            : "Today"}
        </div>
        <h2 style={{ fontSize: 26, margin: 0, letterSpacing: "-0.01em" }}>
          Rest day · take it easy
        </h2>
        <p style={{ color: "var(--cp-text-muted)", margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          Nothing on the schedule today.{" "}
          <span className="cp-info" tabIndex={0} aria-label="Why a rest day?">
            i
            <span className="pop" style={{ width: 280 }}>
              <strong>Why a rest day?</strong>
              <br />
              Recovery is where adaptation happens. Tendons rebuild on a 24–72h
              window after heavy work; the central nervous system needs
              off-days to re-sensitise. Walk, sleep, eat — that&apos;s today&apos;s
              workout.
            </span>
          </span>
        </p>
        {nextUpcoming && (
          <div
            data-testid="rest-tomorrow"
            style={{
              fontSize: 13,
              color: "var(--cp-text-muted)",
              padding: "10px 12px",
              borderRadius: 10,
              background: "var(--cp-surface-soft)",
              border: "1px solid var(--cp-border)",
            }}
          >
            Up next:{" "}
            <span style={{ color: "var(--cp-text)", fontWeight: 600 }}>
              {formatUpcomingDay(nextUpcoming.date)}
            </span>{" "}
            · {nextUpcoming.title}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/app/sessions/new" className="cp-btn">
            Log a freestyle session
          </Link>
          <Link href="/app/plan" className="cp-btn">View plan</Link>
        </div>
      </section>
    );
  }

  // 1 or 2 planned sessions today.
  // Compute effective times for AM and PM, then derive the actual gap for
  // the DC-D1 warning so it shows the real value, not a static reminder.
  const slotTimes = new Map<string, string>();
  for (const p of plannedToday) {
    const t = effectiveTimeOfDay({
      slot: p.slot,
      plannedAt: p.plannedAt,
      amWindowStart,
      pmWindowStart,
      timezone,
    });
    if (t) slotTimes.set(p.slot, t);
  }
  const amTime = slotTimes.get("am");
  const pmTime = slotTimes.get("pm");
  const gapH = isTwoADay && amTime && pmTime ? gapHoursBetween(amTime, pmTime) : null;
  const gapShort = gapH != null && gapH < 6;

  // Phase 2 B2 — when one slot of a two-a-day is already complete, lead
  // with the still-open slot. Incomplete cards come first; completed
  // cards drop to the bottom (de-emphasised but still visible).
  const orderedPlannedToday = isTwoADay
    ? [...plannedToday].sort((a, b) => {
        const aDone = a.completedSessionId ? 1 : 0;
        const bDone = b.completedSessionId ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        // Within same completion bucket: AM before PM.
        const slotOrder = (s: string) => (s === "am" ? 0 : s === "pm" ? 1 : 2);
        return slotOrder(a.slot) - slotOrder(b.slot);
      })
    : plannedToday;

  // PM-next hint (B2). When the AM slot is logged and PM remains, show
  // a ~Xh count-down above the PM card. Computed from the PM slot time
  // minus now-in-user-timezone — falls back to "PM session next" when
  // we can't resolve a clock time.
  const completedAmSlot = isTwoADay
    ? plannedToday.find((p) => p.slot === "am" && p.completedSessionId)
    : null;
  const openPmSlot = completedAmSlot
    ? plannedToday.find((p) => p.slot === "pm" && !p.completedSessionId)
    : null;
  const pmHoursFromNow = (() => {
    if (!openPmSlot) return null;
    const pmClock = slotTimes.get("pm");
    if (!pmClock) return null;
    const [hh, mm] = pmClock.split(":").map((n) => parseInt(n, 10));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    // Approximate: assume the user's clock matches "now" — this is a
    // rough hours-from-now display, not a precise countdown.
    const now = new Date();
    const target = new Date(now);
    target.setHours(hh!, mm!, 0, 0);
    const diffH = (target.getTime() - now.getTime()) / 3_600_000;
    return diffH;
  })();

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {isTwoADay && (
        <div
          role="note"
          className="cp-card"
          style={{
            padding: "10px 14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            background: "color-mix(in oklab, var(--cp-accent) 4%, transparent)",
            borderColor: "var(--cp-accent)",
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--cp-text)" }}>
            <strong>
              Two-a-day{gapH != null ? ` · ${gapH.toFixed(0)}h gap` : ""}.
            </strong>
            <span style={{ color: "var(--cp-text-muted)", marginLeft: 4 }}>
              {gapShort
                ? `Sessions are ${gapH!.toFixed(1)}h apart — research recommends ≥6h between AM lift and PM cardio to protect the strength signal.`
                : "AM lift + PM cardio with at least 6 hours between protects the strength signal."}
            </span>
          </span>
          <span
            className="mono"
            title="Robineau 2016 (HIGH) — recovery between concurrent sessions"
            style={{ fontSize: 10, color: "var(--cp-text-muted)", flexShrink: 0 }}
          >
            Robineau 2016
          </span>
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isTwoADay ? "repeat(auto-fit, minmax(300px, 1fr))" : "1fr",
          gap: 12,
        }}
      >
        {orderedPlannedToday.map((p) => {
          const isOpenPm = openPmSlot?.id === p.id;
          return (
            <div key={p.id} style={{ display: "grid", gap: 6 }}>
              {isOpenPm && (
                <div
                  data-testid="pm-next-hint"
                  style={{
                    fontSize: 12,
                    color: "var(--cp-accent)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    fontWeight: 700,
                  }}
                >
                  PM session{" "}
                  {pmHoursFromNow != null && pmHoursFromNow > 0
                    ? `in ~${Math.max(1, Math.round(pmHoursFromNow))}h`
                    : "next"}
                </div>
              )}
              <PlannedSessionCard
                planned={p}
                isTwoADay={isTwoADay}
                timeOfDay={slotTimes.get(p.slot) ?? null}
                conflict={conflictsBySlot.get(p.id) ?? null}
                archetypeName={archetypeName}
                weekIndex={weekIndex}
                tmById={tmById}
              />
            </div>
          );
        })}
      </div>
      {nextUpcoming && plannedToday.length === 1 && (
        <div
          data-testid="up-next-strip"
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            padding: "8px 12px",
            background: "var(--cp-surface-soft)",
            borderRadius: 8,
            border: "1px solid var(--cp-border)",
          }}
        >
          Up next:{" "}
          <span style={{ color: "var(--cp-text)", fontWeight: 600 }}>
            {formatUpcomingDay(nextUpcoming.date)}
          </span>{" "}
          · {nextUpcoming.title}
          {(() => {
            const summary = summarisePrescription(nextUpcoming.prescription.items);
            return summary ? ` · ${summary}` : "";
          })()}
        </div>
      )}
    </div>
  );
}

function PlannedSessionCard({
  planned,
  isTwoADay,
  timeOfDay,
  conflict,
  archetypeName,
  weekIndex,
  tmById,
}: {
  planned: PlannedDay;
  isTwoADay: boolean;
  timeOfDay: string | null;
  conflict: FreshnessConflict | null;
  archetypeName: string | null;
  weekIndex: number | null;
  tmById: Record<string, number>;
}) {
  const slotLabel =
    planned.slot === "am" ? "Morning" : planned.slot === "pm" ? "Evening" : "Today's session";

  // Phase 1 A1 — resolve the top set numbers from the prescription + TM
  // dict. The "top set" is the main item with the highest %TM. Falls
  // back to the first main item when nothing carries a percentTm.
  const mainItems = planned.prescription.items.filter(
    (i) => i.kind === "main" || i.kind === "back_off",
  );
  const topItem =
    mainItems
      .slice()
      .sort((a, b) => (b.percentTm ?? 0) - (a.percentTm ?? 0))[0] ?? mainItems[0];
  const topTm = topItem ? tmById[topItem.movementId] : undefined;
  const topWeight =
    topItem && typeof topItem.percentTm === "number" && topTm
      ? roundToPlate(topTm * (topItem.percentTm / 100))
      : null;
  const topLine =
    topItem && topWeight && topItem.reps != null
      ? `Top set ${topWeight} kg × ${topItem.reps}`
      : topItem && topItem.percentTm && topItem.reps
        ? `Top set ${topItem.percentTm}% TM × ${topItem.reps}`
        : null;

  // Estimated session minutes — sum of strength sets × ~3 min and
  // cardio durationMin. Coarse on purpose; the Today hero only needs a
  // rough orientation number.
  const estMin = planned.prescription.items.reduce((acc, i) => {
    if (i.kind.startsWith("cardio_")) return acc + (i.durationMin ?? 0);
    const sets = i.sets ?? 1;
    return acc + sets * (i.kind === "main" ? 4 : i.kind === "back_off" ? 3 : 2);
  }, 0);

  // Movement-name chips for the hero — only main + back-off items,
  // deduped, capped at 3, with "+ N assistance" for the rest.
  const mainNames: string[] = [];
  const seenNames = new Set<string>();
  let assistanceCount = 0;
  for (const item of planned.prescription.items) {
    const name = (item as { movementName?: string }).movementName?.trim();
    if (item.kind === "main" || item.kind === "back_off") {
      if (name && !seenNames.has(name)) {
        seenNames.add(name);
        mainNames.push(name);
      }
    } else {
      assistanceCount += 1;
    }
  }
  const chipNames = mainNames.slice(0, 3);

  return (
    <section
      className="cp-card"
      data-testid={`today-card-${planned.id}`}
      data-hero="planned"
      style={{
        padding: 18,
        display: "grid",
        gap: 12,
        borderColor: "var(--cp-border)",
        minHeight: isTwoADay ? 200 : 280,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--cp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
        {isTwoADay && planned.slot !== "single" ? (
          <>
            <span data-testid={`slot-label-${planned.slot}`}>{slotLabel}</span>
            {archetypeName && weekIndex != null && (
              <span style={{ color: "var(--cp-text-muted)", fontWeight: 600, marginLeft: 8 }}>
                · {archetypeName} · Week {weekIndex + 1}
              </span>
            )}
            {timeOfDay && (
              <span className="mono" style={{ color: "var(--cp-text-muted)", marginLeft: 8 }}>
                {timeOfDay}
              </span>
            )}
          </>
        ) : (
          <>
            {archetypeName && weekIndex != null
              ? `${archetypeName} · Week ${weekIndex + 1}`
              : slotLabel}
          </>
        )}
        {planned.completedSessionId && (
          <span
            data-testid="slot-complete-badge"
            style={{
              marginLeft: 10,
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 999,
              background: "color-mix(in oklab, var(--cp-success) 18%, transparent)",
              color: "var(--cp-success)",
              fontWeight: 700,
              letterSpacing: "0.06em",
            }}
          >
            ✓ logged
          </span>
        )}
      </div>
      <h2 style={{ fontSize: 24, margin: 0, letterSpacing: "-0.01em", fontWeight: 700 }}>{planned.title}</h2>
      {(chipNames.length > 0 || assistanceCount > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chipNames.map((n) => (
            <span
              key={n}
              style={{
                background: "var(--cp-surface-soft)",
                border: "1px solid var(--cp-border)",
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {n}
            </span>
          ))}
          {assistanceCount > 0 && (
            <span
              style={{
                background: "transparent",
                borderRadius: 8,
                padding: "4px 8px",
                fontSize: 12,
                color: "var(--cp-text-muted)",
                fontStyle: "italic",
              }}
            >
              + {assistanceCount} assistance
            </span>
          )}
        </div>
      )}
      {(topLine || estMin > 0) && (
        <div
          data-testid="hero-topline"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            fontSize: 13,
            color: "var(--cp-text)",
          }}
        >
          {estMin > 0 && (
            <span>
              <span style={{ color: "var(--cp-text-muted)" }}>~</span>
              <span className="mono" style={{ fontWeight: 700 }}>
                {estMin}
              </span>
              <span style={{ color: "var(--cp-text-muted)" }}> min</span>
            </span>
          )}
          {topLine && (
            <span style={{ fontWeight: 600 }} className="mono">
              {topLine}
            </span>
          )}
        </div>
      )}
      {conflict && (
        <div
          role="note"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 10,
            background: "color-mix(in oklab, var(--cp-warning) 12%, transparent)",
            border: "1px solid var(--cp-warning)",
            fontSize: 12,
            color: "var(--cp-text)",
            lineHeight: 1.4,
          }}
          title={`${conflict.regionLabel} freshness ${(conflict.freshness * 100).toFixed(0)}% — Gabbett 2016 (acute-to-chronic load injury risk)`}
        >
          <span aria-hidden style={{ fontSize: 14 }}>⚠</span>
          <span>
            <strong>{conflict.regionLabel}</strong> still recovering. Heavy {conflict.movementName} may need a lighter top set or a substitution.
          </span>
        </div>
      )}
      <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
        {summarisePrescription(planned.prescription.items)}
      </div>
      {planned.prescription.items.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
          {planned.prescription.items.map((item, i) => (
            <li
              key={i}
              style={{
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 10px",
                background: "var(--cp-surface-soft)",
                borderRadius: 6,
              }}
            >
              <span>
                Set {i + 1}
                {item.notes ? (
                  <span style={{ color: "var(--cp-accent)", fontWeight: 600, marginLeft: 4 }}>· {item.notes}</span>
                ) : null}
              </span>
              <span className="mono" style={{ fontWeight: 600 }}>{formatPrescriptionItem(item, tmById[item.movementId])}</span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: "auto" }}>
        {planned.completedSessionId ? (
          <Link
            href={`/app/sessions/${planned.completedSessionId}`}
            className="cp-btn primary big"
            data-testid="today-cta"
            style={{ flex: "1 1 auto", minHeight: 56 }}
          >
            Continue session →
          </Link>
        ) : (
          <Link
            href={`/app/sessions/start/${planned.id}`}
            className="cp-btn primary big"
            data-testid="today-cta"
            style={{ flex: "1 1 auto", minHeight: 56 }}
          >
            Start session →
          </Link>
        )}
        <Link
          href="/app/plan"
          style={{
            fontSize: 13,
            color: "var(--cp-link)",
            textDecoration: "underline",
            padding: "10px 6px",
          }}
        >
          Preview
        </Link>
      </div>
    </section>
  );
}

function formatUpcomingDay(iso: string): string {
  const target = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return iso;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 1) return "tomorrow";
  if (diffDays >= 2 && diffDays <= 6) {
    return target.toLocaleDateString(undefined, { weekday: "long" });
  }
  return target.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function freshnessColor(tone: "ok" | "caution" | "warn") {
  if (tone === "ok") return "var(--cp-success)";
  if (tone === "caution") return "var(--cp-warning)";
  return "var(--cp-danger)";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function RegionFreshnessCard({ rows, hasStravaData }: { rows: RegionFreshnessRow[]; hasStravaData: boolean }) {
  return (
    <section className="cp-card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>How recovered you are</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {hasStravaData && <StravaPoweredBadge variant="compact" />}
          <Link href="/app/stats/engine" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>details →</Link>
        </div>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
          Log a session to start tracking how each region recovers.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r) => (
            <div
              key={r.region}
              title={`Freshness ${(r.freshness * 100).toFixed(0)}% · last load ${timeAgo(r.lastLoadDate) || "—"}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                border: "1px solid var(--cp-border)",
                borderRadius: 10,
                background: "var(--cp-surface)",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 500 }}>{r.regionLabel}</span>
              <span
                style={{
                  fontSize: 12,
                  color: freshnessColor(r.tone),
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: freshnessColor(r.tone),
                    display: "inline-block",
                  }}
                />
                {r.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TaperCard({ taper }: { taper: TaperRecommendation }) {
  const color = taper.phase === "polish" || taper.phase === "event_day" ? "var(--cp-danger)" : taper.phase === "deep" ? "var(--cp-warning)" : "var(--cp-link)";
  return (
    <section
      className="cp-card"
      style={{
        padding: "14px 18px",
        display: "grid",
        gap: 6,
        borderColor: color,
        background: `color-mix(in oklab, ${color} 6%, transparent)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 11, color, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
          Taper · {taper.eventName}
        </div>
        <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          {taper.daysOut === 0 ? "today" : `${taper.daysOut}d`}
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{taper.headline}</div>
      <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>{taper.detail}</div>
    </section>
  );
}
