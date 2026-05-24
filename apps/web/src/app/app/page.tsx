import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
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
import { getRegionFreshness, type FreshnessConflict } from "@/lib/stats/region-freshness-queries";
import { getMuscleFreshness } from "@/lib/muscle/muscle-freshness";
import { findHeavyOnRecoveringConflictWithMuscles } from "@/lib/muscle/muscle-conflict";
import { StravaStaleSyncTrigger } from "@/components/StravaStaleSyncTrigger";
import { BodyweightOnlyBanner } from "@/components/banners/BodyweightOnlyBanner";
import {
  hasLoadableMainLift,
  resolveEquipment,
} from "@/lib/settings/equipment-presets";
import { computeTaperRecommendation, type TaperRecommendation } from "@/lib/planner/taper";
import { EmptyState } from "@/components/ui/EmptyState";
import { TmSuggestionBanner, type TmSuggestionView } from "@/components/today/TmSuggestionBanner";
import {
  acceptTmSuggestion,
  dismissTmSuggestion,
} from "@/lib/training-maxes/actions";
import type { TmFormula, TmSource } from "@hta/db";
import { listTrainingMaxes } from "@/lib/training-maxes/queries";
import { mondayOfYmd, addDaysToYmd, isoWeekdayYmd } from "@/lib/dates";

const DOW_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS_UPPER = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Eyebrow-style short date — "SUN 24 MAY". */
function eyebrowDate(d = new Date()) {
  return `${DOW_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_UPPER[d.getMonth()]}`;
}

/**
 * Per-day cell used by the inline week strip. Mirrors the legacy
 * WeekDotsCard shape so the existing fetcher can stay unchanged.
 */
type WeekDayCell = {
  strengthDone: boolean;
  cardioDone: boolean;
  planned: boolean;
  isToday: boolean;
};

/** Coarse "N days/weeks ago" string used by the e1RM hero annotation. */
function relativeFromIso(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "recently";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "recently";
  const days = Math.round((now.getTime() - then) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, timezone, am_window_start, pm_window_start, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg",
    )
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
  // Provenance map keyed by movement_id, used to annotate the hero topline
  // when the underlying TM came from a derived e1RM rather than a deliberate
  // entry. Includes the original session timestamp for the relative-date
  // suffix ("AMRAP 2 weeks ago").
  type TmHeroMeta = {
    source: TmSource;
    formula: TmFormula | null;
    derivedAt: string | null;
    derivedFromSessionId: string | null;
    derivedFromSessionPerformedAt: string | null;
  };
  const tmMetaByMovementId: Record<string, TmHeroMeta> = {};
  const derivedSessionIds = Array.from(
    new Set(
      tmRows
        .filter((r) => r.source !== "entered" && r.derivedFromSessionId)
        .map((r) => r.derivedFromSessionId!),
    ),
  );
  const sessionPerformedAt = new Map<string, string>();
  if (derivedSessionIds.length > 0) {
    const { data: derivedSessions } = await supabase
      .from("sessions")
      .select("id, performed_at")
      .in("id", derivedSessionIds);
    for (const s of derivedSessions ?? []) {
      sessionPerformedAt.set(s.id, s.performed_at);
    }
  }
  for (const r of tmRows) {
    tmMetaByMovementId[r.movementId] = {
      source: r.source,
      formula: r.derivedFormula,
      derivedAt: r.derivedAt,
      derivedFromSessionId: r.derivedFromSessionId,
      derivedFromSessionPerformedAt: r.derivedFromSessionId
        ? sessionPerformedAt.get(r.derivedFromSessionId) ?? null
        : null,
    };
  }

  // Pending TM suggestions — surfaced as a banner above the hero. Joined
  // with movements + the source set/session so the banner can show "from
  // your AMRAP X kg × N on Mar 14".
  const { data: pendingSuggestionsRaw } = await supabase
    .from("tm_suggestions")
    .select(
      "id, movement_id, current_tm_kg, suggested_tm_kg, derived_formula, derived_from_set_log_id, derived_from_session_id, created_at",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  let pendingSuggestions: TmSuggestionView[] = [];
  if (pendingSuggestionsRaw && pendingSuggestionsRaw.length > 0) {
    const movIds = Array.from(new Set(pendingSuggestionsRaw.map((s) => s.movement_id)));
    const setIds = Array.from(
      new Set(
        pendingSuggestionsRaw
          .map((s) => s.derived_from_set_log_id)
          .filter((id): id is string => !!id),
      ),
    );
    const sessIds = Array.from(
      new Set(
        pendingSuggestionsRaw
          .map((s) => s.derived_from_session_id)
          .filter((id): id is string => !!id),
      ),
    );
    const [{ data: movRows }, { data: setRows }, { data: sessRows }] = await Promise.all([
      supabase.from("movements").select("id, display_name").in("id", movIds),
      setIds.length > 0
        ? supabase.from("set_logs").select("id, weight_kg, reps").in("id", setIds)
        : Promise.resolve({ data: [] as { id: string; weight_kg: unknown; reps: unknown }[] }),
      sessIds.length > 0
        ? supabase.from("sessions").select("id, performed_at").in("id", sessIds)
        : Promise.resolve({ data: [] as { id: string; performed_at: string }[] }),
    ]);
    const movName = new Map((movRows ?? []).map((m) => [m.id, m.display_name as string]));
    const setMap = new Map(
      (setRows ?? []).map((s) => [
        s.id as string,
        {
          weightKg: s.weight_kg == null ? null : Number(s.weight_kg),
          reps: s.reps == null ? null : Number(s.reps),
        },
      ]),
    );
    const sessMap = new Map((sessRows ?? []).map((s) => [s.id as string, s.performed_at as string]));
    pendingSuggestions = pendingSuggestionsRaw.map((s) => {
      const set = s.derived_from_set_log_id ? setMap.get(s.derived_from_set_log_id) : undefined;
      const formulaRaw = s.derived_formula as string | null;
      const formula: TmFormula | null =
        formulaRaw === "epley" || formulaRaw === "brzycki" || formulaRaw === "rpe_zourdos"
          ? formulaRaw
          : null;
      return {
        id: s.id,
        movementName: movName.get(s.movement_id) ?? "Lift",
        currentTmKg: s.current_tm_kg == null ? null : Number(s.current_tm_kg),
        suggestedTmKg: Number(s.suggested_tm_kg),
        formula,
        setWeightKg: set?.weightKg ?? null,
        setReps: set?.reps ?? null,
        sessionPerformedAt: s.derived_from_session_id
          ? sessMap.get(s.derived_from_session_id) ?? null
          : null,
      };
    });
  }

  // Strava integration state: do we have a connection (drives the
  // background stale-sync trigger).
  const { data: stravaConn } = await supabase
    .from("strava_connections")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  const hasStravaConnection = Boolean(stravaConn);

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

  // Today is a single-column layout — the right rail (Training Maxes
  // summary) was retired with the shell refresh; TM details live on
  // /app/profile and /app/settings/training-maxes now.
  const isRestDay = plannedToday.length === 0 && !openSession;
  const todayDate = new Date();
  const eyebrowLine = (() => {
    const datePart = eyebrowDate(todayDate);
    if (!activeBlock || !archetypeName) return datePart;
    const week = (computedWeekIndex ?? 0) + 1;
    return `${archetypeName.toUpperCase()} · WEEK ${week} · ${datePart}`;
  })();

  return (
    <div
      style={{ display: "grid", gap: 18, minWidth: 0 }}
      className={`today-shell${isRestDay ? " is-rest" : ""}`}
    >
      <header>
          <div
            data-testid="today-eyebrow"
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            {activeBlock && archetypeName ? (
              <>
                <span style={{ color: "var(--cp-accent)" }}>
                  {archetypeName.toUpperCase()}
                </span>
                <span style={{ margin: "0 8px", opacity: 0.5 }}>·</span>
                WEEK {(computedWeekIndex ?? 0) + 1}
                <span style={{ margin: "0 8px", opacity: 0.5 }}>·</span>
                {eyebrowDate(todayDate)}
              </>
            ) : (
              eyebrowLine
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
        </header>

        {taper && <TaperCard taper={taper} />}

        {!hasLoadableMainLift(resolveEquipment(profile)) && tmRows.length === 0 && (
          <BodyweightOnlyBanner />
        )}

        <TmSuggestionBanner
          suggestions={pendingSuggestions}
          acceptAction={acceptTmSuggestion}
          dismissAction={dismissTmSuggestion}
        />

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
          tmMetaByMovementId={tmMetaByMovementId}
          nextUpcoming={upcoming[0] ?? null}
        />

        <WeekStrip days={weekDays} doneCount={doneCount} isRestDay={isRestDay} />

        {hasStravaConnection && <StravaStaleSyncTrigger />}

        <ActivitySection sessions={recent ?? []} todayIso={todayIso} />
    </div>
  );
}

/**
 * Compressed week strip — single row with day dots + a summary on the
 * right. Pulls from the same week-aggregation data the right-rail
 * WeekDotsCard used; rendered inline on Today between the hero and
 * Recent activity. Mon-anchored to match the existing convention.
 */
function WeekStrip({
  days,
  doneCount,
  isRestDay,
}: {
  days: WeekDayCell[];
  doneCount: number;
  isRestDay: boolean;
}) {
  const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
  const todayCell = days.find((d) => d.isToday);
  const plannedToday = todayCell?.planned ?? false;
  const summary = isRestDay
    ? `${doneCount} done · rest today`
    : `${doneCount} done · today ${plannedToday ? "planned" : "—"}`;
  return (
    <div
      data-testid="today-week-strip"
      aria-label="This week"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 16px",
        background: "var(--cp-surface)",
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        fontSize: 12,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          color: "var(--cp-text-muted)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        This week
      </span>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {days.map((d, i) => (
          <WeekStripDot key={i} label={DAY_LABELS[i]!} cell={d} />
        ))}
      </div>
      <span style={{ color: "var(--cp-text-muted)", marginLeft: "auto" }}>{summary}</span>
    </div>
  );
}

function WeekStripDot({ label, cell }: { label: string; cell: WeekDayCell }) {
  const base: React.CSSProperties = {
    width: 22,
    height: 22,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    fontWeight: 600,
    border: "1px solid var(--cp-border)",
    color: "var(--cp-text-muted)",
  };
  if (cell.isToday) {
    base.borderColor = "var(--cp-accent)";
    base.color = "var(--cp-text)";
  }
  if (cell.strengthDone) {
    return (
      <span
        title="Strength done"
        style={{
          ...base,
          background: "var(--cp-accent)",
          color: "var(--cp-accent-fg, #0a0a0a)",
          borderColor: "var(--cp-accent)",
          fontWeight: 700,
        }}
      >
        {label}
      </span>
    );
  }
  if (cell.cardioDone) {
    return (
      <span
        title="Cardio done"
        style={{
          ...base,
          background: "var(--cp-link)",
          color: "#001028",
          borderColor: "var(--cp-link)",
          fontWeight: 700,
        }}
      >
        {label}
      </span>
    );
  }
  if (cell.planned) {
    return (
      <span title="Planned" style={{ ...base, borderStyle: "dashed" }}>
        {label}
      </span>
    );
  }
  return <span style={base}>{label}</span>;
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
  tmMetaByMovementId,
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
  tmMetaByMovementId: Record<string, {
    source: TmSource;
    formula: TmFormula | null;
    derivedAt: string | null;
    derivedFromSessionId: string | null;
    derivedFromSessionPerformedAt: string | null;
  }>;
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
    // Compact 1-row rest banner. Replaces the older Why-rest-day card.
    // The next-session preview pulls top-set numbers from the same
    // prescription + TM math the hero uses so the line reads identically.
    const nextTopLine = nextUpcoming ? topSetLine(nextUpcoming, tmById) : null;
    return (
      <section
        data-testid="today-rest"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          padding: "14px 18px",
          background: "var(--cp-surface)",
          border: "1px solid var(--cp-border)",
          borderRadius: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span aria-hidden style={{ fontSize: 18 }}>☕</span>
          <div style={{ fontSize: 13, color: "var(--cp-text-muted)", minWidth: 0 }}>
            <strong style={{ color: "var(--cp-text)", fontSize: 14, fontWeight: 600, marginRight: 6 }}>
              Rest day.
            </strong>
            {nextUpcoming ? (
              <span data-testid="rest-tomorrow">
                Next session:{" "}
                <strong style={{ color: "var(--cp-text)", fontWeight: 600 }}>
                  {formatUpcomingDay(nextUpcoming.date)} · {nextUpcoming.title}
                </strong>
                {nextTopLine && (
                  <span style={{ color: "var(--cp-text-muted)" }}> · {nextTopLine}</span>
                )}
              </span>
            ) : (
              <span>Nothing on the schedule.</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <Link
            href="/app/sessions/new"
            style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
          >
            Log freestyle
          </Link>
          <Link
            href="/app/plan"
            style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
          >
            View plan →
          </Link>
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
                tmMetaByMovementId={tmMetaByMovementId}
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
  tmMetaByMovementId,
}: {
  planned: PlannedDay;
  isTwoADay: boolean;
  timeOfDay: string | null;
  conflict: FreshnessConflict | null;
  archetypeName: string | null;
  weekIndex: number | null;
  tmById: Record<string, number>;
  tmMetaByMovementId: Record<string, {
    source: TmSource;
    formula: TmFormula | null;
    derivedAt: string | null;
    derivedFromSessionId: string | null;
    derivedFromSessionPerformedAt: string | null;
  }>;
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

  // When the underlying TM is a derived e1RM (AMRAP or RPE), tag the
  // topline so the user can see the number isn't carved in stone. The
  // relative-date suffix uses the source session's performed_at so the
  // hint stays accurate as time passes.
  const topMeta = topItem ? tmMetaByMovementId[topItem.movementId] : undefined;
  const topLineAnnotation = (() => {
    if (!topMeta || topMeta.source === "entered" || !topLine) return null;
    const when = relativeFromIso(
      topMeta.derivedFromSessionPerformedAt ?? topMeta.derivedAt,
    );
    const kind = topMeta.source === "derived_amrap" ? "AMRAP" : "RPE set";
    return `based on e1RM (${kind} ${when})`;
  })();

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
          {topLineAnnotation && (
            <span
              data-testid="hero-topline-e1rm-annotation"
              style={{
                color: "var(--cp-text-muted)",
                fontWeight: 500,
                fontStyle: "italic",
              }}
            >
              · {topLineAnnotation}
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
            color: "var(--cp-text-muted)",
            textDecoration: "none",
            padding: "10px 6px",
          }}
        >
          Preview plan
        </Link>
      </div>
    </section>
  );
}

/**
 * Top-set summary line for a planned day. Mirrors the hero topline
 * computation in PlannedSessionCard — extracted so the rest-day banner
 * can render the same "102 kg × 5" string for the next upcoming session.
 */
function topSetLine(
  planned: PlannedDay,
  tmById: Record<string, number>,
): string | null {
  const mainItems = planned.prescription.items.filter(
    (i) => i.kind === "main" || i.kind === "back_off",
  );
  const topItem =
    mainItems
      .slice()
      .sort((a, b) => (b.percentTm ?? 0) - (a.percentTm ?? 0))[0] ?? mainItems[0];
  if (!topItem) return null;
  const topTm = tmById[topItem.movementId];
  const topWeight =
    typeof topItem.percentTm === "number" && topTm
      ? roundToPlate(topTm * (topItem.percentTm / 100))
      : null;
  if (topWeight && topItem.reps != null) {
    return `top set ${topWeight} kg × ${topItem.reps}`;
  }
  if (topItem.percentTm && topItem.reps) {
    return `top set ${topItem.percentTm}% TM × ${topItem.reps}`;
  }
  return null;
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
