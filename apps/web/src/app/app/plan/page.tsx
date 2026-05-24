import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { acceptTmBump, declineTmBump } from "@/lib/engine/tm-bump-actions";
import { findBlockCompleteBump } from "@/lib/engine/block-complete";
import {
  endBlock,
  linkPlannedToSession,
  setPlannedTime,
  skipPlannedSession,
  unskipPlannedSession,
  createBlock,
} from "@/lib/planner/actions";
import {
  ARCHETYPES,
  STRENGTH_ROLE_LABELS,
  effectiveDays,
  formatPrescriptionItem,
  summarisePrescription,
} from "@/lib/planner/archetypes";
import { getActiveBlock, getPlannedDays, getRecentBlocks, todayYmd } from "@/lib/planner/queries";
import { cleanPrescriptionNotes } from "@/lib/planner/clean-prescription-notes";
import { getTrainingMaxContext } from "@/lib/training-maxes/queries";
import { effectiveTimeOfDay, gapHoursBetween } from "@/lib/planner/time-of-day";
import { getCurrentWeekTissueStackGaps, type TissueStackGap } from "@/lib/stats/tissue-stack-queries";
import type { Prescription } from "@hta/db";
import { SkipSessionForm } from "@/components/plan/SkipSessionForm";
import { EndBlockForm } from "@/components/plan/EndBlockForm";
import { PlanViews, type ViewMode } from "@/components/plan/PlanViews";
import { GlossaryBadge } from "@/components/ui/GlossaryBadge";
import type { StravaCandidate } from "@/components/plan/MatchUnfulfilledModal";
import {
  PlanNewSwitch,
  type RecentBlockCard,
  type TmReadinessByArchetype,
} from "@/components/planner/BlockWizard";
import {
  buildCalendarItems,
  type CalendarFilter,
  type CalendarItem,
  type RawEventRow,
  type RawPlannedRow,
  type RawSessionRow,
} from "@/lib/plan/calendar-data";
import { addDaysToYmd, ymdInTimezone } from "@/lib/dates";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Six wizard-resolvable archetype ids — must stay in sync with
// `ResolvedArchetype["id"]` in lib/planner/wizard/wizard-mapping.ts.
const WIZARD_ARCHETYPE_IDS = [
  "strength_anchor",
  "endurance_anchor",
  "concurrent_hybrid",
  "hypertrophy_anchor",
  "maintenance",
  "rebuild",
] as const;

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{
    week?: string;
    view?: string;
    filter?: string;
    date?: string;
    match?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const block = await getActiveBlock();

  if (!block) {
    // No active block — render the wizard inline with optional "Run it
    // again" cards above. Previously the user had to:
    //   /app/plan → click "Start a block" → /app/plan/new → click
    //   "Build a new block" → wizard.
    // Four clicks for an empty state. Now the wizard is right here.
    const blockBump = await findBlockCompleteBump(supabase, user.id);

    const [tmCtx, { data: prof }, recent] = await Promise.all([
      getTrainingMaxContext(),
      supabase
        .from("profiles")
        .select("allows_two_a_days, timezone")
        .eq("id", user.id)
        .maybeSingle(),
      getRecentBlocks(3),
    ]);
    const allowsTwoADays = Boolean(prof?.allows_two_a_days ?? false);
    const tz = prof?.timezone ?? "UTC";

    const tmReadinessByArchetype = Object.fromEntries(
      WIZARD_ARCHETYPE_IDS.map((id) => {
        const a = ARCHETYPES[id];
        const pool = effectiveDays(a, allowsTwoADays);
        const missingRoles: string[] = [];
        const rolesSeen = new Map<string, boolean>();
        for (const day of pool) {
          if (day.kind !== "strength") continue;
          const existing = rolesSeen.get(day.role);
          const hasTm = day.candidateSlugs.some((s) => tmCtx.bySlug.has(s));
          if (existing === undefined) rolesSeen.set(day.role, hasTm);
          else if (hasTm) rolesSeen.set(day.role, true);
        }
        for (const [role, ready] of rolesSeen.entries()) {
          if (!ready) {
            missingRoles.push(STRENGTH_ROLE_LABELS[role as keyof typeof STRENGTH_ROLE_LABELS]);
          }
        }
        return [id, { ready: missingRoles.length === 0, missingRoles }];
      }),
    ) as TmReadinessByArchetype;

    const recentBlocks: RecentBlockCard[] = recent.map((b) => ({
      id: b.id,
      archetype: b.archetype,
      archetypeName: b.archetypeName,
      startedOn: b.startedOn,
      daysPerWeek: b.daysPerWeek,
      status: b.status,
      dayIndexOverrides: b.dayIndexOverrides,
    }));

    const firstTime = recentBlocks.length === 0;

    return (
      <div style={{ display: "grid", gap: 20 }}>
        <header>
          <h1 style={{ fontSize: 28, margin: 0, letterSpacing: "-0.01em" }}>Plan</h1>
          <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
            {firstTime
              ? "Let's shape your first block. The engine picks the days, weights, and weekly wave — you log what actually happens."
              : "Start a new block, or run a recent one again."}
          </p>
        </header>
        {blockBump && <BlockCompleteCard bump={blockBump} />}
        <PlanNewSwitch
          recentBlocks={recentBlocks}
          tmReadinessByArchetype={tmReadinessByArchetype}
          allowsTwoADays={allowsTwoADays}
          todayYmd={todayYmd(tz)}
          action={createBlock}
          initialMode={firstTime ? "wizard" : "home"}
          hideBuildCta={firstTime}
        />
        {recentBlocks.length > 0 && (
          <Link
            href="/app/plan/history"
            style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
          >
            View full history →
          </Link>
        )}
      </div>
    );
  }

  const archetype = ARCHETYPES[block.archetype as keyof typeof ARCHETYPES];
  const isCustom = block.archetype === "custom";
  const archetypeName = isCustom
    ? block.notes?.trim() || "Custom block"
    : archetype?.name ?? block.archetype;
  const archetypeKicker = isCustom ? "Custom · " : "";
  const all = await getPlannedDays(block.id, block.startedOn);

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, am_window_start, pm_window_start")
    .eq("id", user.id)
    .maybeSingle();
  const timezone = profile?.timezone ?? "UTC";
  const amWindowStart = profile?.am_window_start ?? "07:00:00";
  const pmWindowStart = profile?.pm_window_start ?? "17:00:00";

  const sp = await searchParams;
  const today = todayYmd(timezone);
  const todayWeek = all.find((d) => d.date === today)?.weekIndex;
  const initialWeek =
    sp?.week != null && !Number.isNaN(Number(sp.week))
      ? Math.max(0, Math.min(block.weeks - 1, Number(sp.week)))
      : todayWeek ?? 0;

  const weekDays = all.filter((d) => d.weekIndex === initialWeek);
  // Stage D: detect two-a-day intent from the FULL planned-days list,
  // not just renderable plans. A session keeps its "pair" context even
  // when its partner is skipped/deleted, so the slot badge logic and
  // the two-a-day banner stay stable across the week's lifecycle.
  const sessionCountByDayKey = new Map<string, number>();
  for (const d of all) {
    const key = `${d.weekIndex}-${d.dayIndex}`;
    sessionCountByDayKey.set(key, (sessionCountByDayKey.get(key) ?? 0) + 1);
  }
  const cells = Array.from({ length: 7 }, (_, dayIndex) => {
    const plans = weekDays
      .filter((d) => d.dayIndex === dayIndex)
      .sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot));
    const isTwoADay = (sessionCountByDayKey.get(`${initialWeek}-${dayIndex}`) ?? 0) >= 2;
    return { dayIndex, plans, isTwoADay };
  });

  const totalPlanned = all.length;
  const completed = all.filter((d) => d.completedSessionId).length;
  const skipped = all.filter((d) => d.skippedAt).length;

  const tissueGaps = await getCurrentWeekTissueStackGaps(supabase, user.id);

  // ── View modes (Month / Timeline / List) ─────────────────────────
  //
  // The view-mode tabs read the same underlying `CalendarItem[]` so
  // filter chips behave uniformly. We fetch the supporting data
  // (logged sessions, cardio_logs, priority_events) inside a wide
  // window around the block so the month grid can navigate without
  // re-querying.
  const viewMode: ViewMode = ((): ViewMode => {
    if (sp?.view === "timeline" || sp?.view === "list" || sp?.view === "month") {
      return sp.view;
    }
    return "month";
  })();
  const filter: CalendarFilter = ((): CalendarFilter => {
    if (sp?.filter === "strength" || sp?.filter === "cardio" || sp?.filter === "all") {
      return sp.filter;
    }
    return "all";
  })();
  const anchor = sp?.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;

  // Window covers everything from 60 days before the earliest planned
  // day to 60 days after the latest — generous enough to navigate one
  // month forward/back without re-querying, and bounded so we don't
  // accidentally scan the whole user history.
  const allPlannedDates = all.map((d) => d.date);
  const windowStart = addDaysToYmd(
    allPlannedDates.length ? minStr(allPlannedDates, today) : today,
    -60,
  );
  const windowEnd = addDaysToYmd(
    allPlannedDates.length ? maxStr(allPlannedDates, today) : today,
    60,
  );

  const [sessionRowsRes, eventsRes] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, performed_at, title, duration_min, strava_activity_id")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .not("completed_at", "is", null)
      .gte("performed_at", `${windowStart}T00:00:00.000Z`)
      .lt("performed_at", `${addDaysToYmd(windowEnd, 1)}T00:00:00.000Z`),
    supabase
      .from("priority_events")
      .select("id, name, event_date, priority, modality")
      .eq("user_id", user.id)
      .gte("event_date", windowStart)
      .lte("event_date", windowEnd),
  ]);
  const sessionRows = (sessionRowsRes.data ?? []) as Array<{
    id: string;
    performed_at: string;
    title: string | null;
    duration_min: number | null;
    strava_activity_id: number | string | null;
  }>;
  const eventRows = (eventsRes.data ?? []) as Array<{
    id: string;
    name: string;
    event_date: string;
    priority: "A" | "B" | "C";
    modality: string | null;
  }>;

  const sessionIds = sessionRows.map((r) => r.id);
  const cardioBySession = new Map<
    string,
    { modality: string | null; duration_sec: number | null; external_source: string | null }
  >();
  const strengthIds = new Set<string>();
  if (sessionIds.length > 0) {
    const [cardioRes, setRes] = await Promise.all([
      supabase
        .from("cardio_logs")
        .select("session_id, modality, duration_sec, external_source")
        .in("session_id", sessionIds),
      supabase.from("set_logs").select("session_id").in("session_id", sessionIds),
    ]);
    for (const c of (cardioRes.data ?? []) as Array<{
      session_id: string;
      modality: string | null;
      duration_sec: number | null;
      external_source: string | null;
    }>) {
      if (!cardioBySession.has(c.session_id)) {
        cardioBySession.set(c.session_id, {
          modality: c.modality ?? null,
          duration_sec: c.duration_sec ?? null,
          external_source: c.external_source ?? null,
        });
      }
    }
    for (const r of (setRes.data ?? []) as Array<{ session_id: string }>) {
      strengthIds.add(r.session_id);
    }
  }

  const plannedRaw: RawPlannedRow[] = all.map((p) => {
    const items = p.prescription?.items ?? [];
    const isCardio =
      items.length > 0 && items.every((i) => (i.kind ?? "").startsWith("cardio_"));
    return {
      id: p.id,
      date: p.date,
      title: p.title,
      isCardio,
      cardioModality: isCardio ? guessCardioModalityFromTitle(p.title) : null,
      completedSessionId: p.completedSessionId,
      skippedAt: p.skippedAt,
      summary: summarisePrescription(p.prescription.items),
      slot: p.slot,
    };
  });
  const sessionRaw: RawSessionRow[] = sessionRows.map((s) => {
    const performedYmd = ymdInTimezone(new Date(s.performed_at), timezone);
    const cardio = cardioBySession.get(s.id);
    const hasCardio = cardio != null;
    const hasStrength = strengthIds.has(s.id);
    return {
      id: s.id,
      performedYmd,
      title: s.title,
      isCardio: hasCardio,
      isStrength: hasCardio ? hasStrength : true,
      modality: cardio?.modality ?? null,
      durationMin: s.duration_min ?? (cardio?.duration_sec ? Math.round(cardio.duration_sec / 60) : null),
      stravaActivityId: s.strava_activity_id ? String(s.strava_activity_id) : null,
    };
  });
  const eventRaw: RawEventRow[] = eventRows.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.event_date,
    priority: e.priority,
    modality: e.modality,
  }));

  const calendarItems: CalendarItem[] = buildCalendarItems({
    today,
    planned: plannedRaw,
    sessions: sessionRaw,
    events: eventRaw,
  });

  // Strava candidates per planned id: same-day Strava-sourced sessions
  // that haven't been linked to any planned row yet.
  const linkedSessionIds = new Set(
    plannedRaw
      .filter((p) => p.completedSessionId)
      .map((p) => p.completedSessionId as string),
  );
  const candidatesByDate = new Map<string, StravaCandidate[]>();
  for (const s of sessionRaw) {
    if (linkedSessionIds.has(s.id)) continue;
    const cardio = cardioBySession.get(s.id);
    if (cardio?.external_source !== "strava" && !s.stravaActivityId) continue;
    const bucket = candidatesByDate.get(s.performedYmd) ?? [];
    bucket.push({
      sessionId: s.id,
      title: s.title?.trim() || (s.modality ?? "Cardio"),
      modality: s.modality ?? null,
      durationMin: s.durationMin ?? null,
      stravaActivityId: s.stravaActivityId ?? null,
    });
    candidatesByDate.set(s.performedYmd, bucket);
  }
  const candidatesByPlannedId: Record<string, StravaCandidate[]> = {};
  const plannedById: Record<string, { id: string; date: string; title: string; summary?: string }> = {};
  for (const p of plannedRaw) {
    if (p.skippedAt || p.completedSessionId) continue;
    if (p.date >= today) continue;
    candidatesByPlannedId[p.id] = candidatesByDate.get(p.date) ?? [];
    plannedById[p.id] = { id: p.id, date: p.date, title: p.title, summary: p.summary };
  }

  const matchPlannedId =
    sp?.match && plannedById[sp.match] ? sp.match : undefined;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {archetypeKicker}{archetypeName} · started {new Date(block.startedOn).toLocaleDateString()}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <h1 style={{ fontSize: 28, margin: "4px 0 0", letterSpacing: "-0.01em" }}>Plan</h1>
          <span className="mono" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
            {completed}/{totalPlanned} done · {skipped} skipped
          </span>
        </div>
        <div style={{ marginTop: 6 }}>
          <Link
            href="/app/plan/history"
            style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
          >
            View history →
          </Link>
        </div>
      </header>

      {tissueGaps.length > 0 && <TissueStackCard gaps={tissueGaps} />}

      <PlanViews
        items={calendarItems}
        view={viewMode}
        filter={filter}
        anchor={anchor}
        today={today}
        defaultLegendOpen={true}
        initialMatchPlannedId={matchPlannedId}
        candidatesByPlannedId={candidatesByPlannedId}
        plannedById={plannedById}
        linkAction={linkPlannedToSession}
        skipAction={skipPlannedSession}
      />

      <BlockCalendar
        all={all}
        weeks={block.weeks}
        currentWeek={initialWeek}
        today={today}
      />

      <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }} aria-label="Block weeks">
        <Link
          href={`/app/plan?week=${Math.max(0, initialWeek - 1)}`}
          className="cp-btn"
          style={{ pointerEvents: initialWeek === 0 ? "none" : undefined, opacity: initialWeek === 0 ? 0.4 : 1 }}
          aria-disabled={initialWeek === 0}
        >
          ← prev
        </Link>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
          {Array.from({ length: block.weeks }, (_, i) => (
            <Link
              key={i}
              href={`/app/plan?week=${i}`}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: i === initialWeek ? 700 : 500,
                background: i === initialWeek ? "var(--cp-accent-soft)" : "transparent",
                color: i === initialWeek ? "var(--cp-accent)" : "var(--cp-text-muted)",
                border: `1px solid ${i === initialWeek ? "var(--cp-accent)" : "var(--cp-border)"}`,
                textDecoration: "none",
              }}
            >
              Week {i + 1}
              {archetype?.weekProfiles[i]?.intensityLabel === "Deload" && (
                <span style={{ fontSize: 9, marginLeft: 4, opacity: 0.7 }}>· deload</span>
              )}
            </Link>
          ))}
        </div>
        <Link
          href={`/app/plan?week=${Math.min(block.weeks - 1, initialWeek + 1)}`}
          className="cp-btn"
          style={{ pointerEvents: initialWeek === block.weeks - 1 ? "none" : undefined, opacity: initialWeek === block.weeks - 1 ? 0.4 : 1 }}
          aria-disabled={initialWeek === block.weeks - 1}
        >
          next →
        </Link>
      </nav>

      <section style={{ display: "grid", gap: 10 }}>
        {cells.map(({ dayIndex, plans, isTwoADay }) => (
          <DayCard
            key={dayIndex}
            dayName={DOW[dayIndex]!}
            plans={plans}
            isTwoADay={isTwoADay}
            today={today}
            timezone={timezone}
            amWindowStart={amWindowStart}
            pmWindowStart={pmWindowStart}
          />
        ))}
      </section>

      <section className="cp-card" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Done with this block?</div>
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
              Archives the schedule. You keep all logged sessions.
            </div>
          </div>
          <EndBlockForm blockId={block.id} action={endBlock} />
        </div>
      </section>
    </div>
  );
}

type PlannedCell = {
  id: string;
  date: string;
  slot: "am" | "pm" | "single";
  plannedAt: string | null;
  title: string;
  role: string;
  prescription: Prescription;
  completedSessionId: string | null;
  skippedAt: string | null;
};

function slotOrder(s: "am" | "pm" | "single"): number {
  if (s === "am") return 0;
  if (s === "single") return 1;
  return 2;
}

function minStr(xs: string[], floor: string): string {
  let m = floor;
  for (const x of xs) if (x < m) m = x;
  return m;
}
function maxStr(xs: string[], ceil: string): string {
  let m = ceil;
  for (const x of xs) if (x > m) m = x;
  return m;
}
function guessCardioModalityFromTitle(title: string): string | null {
  const t = title.toLowerCase();
  for (const m of ["run", "bike", "swim", "row", "ski", "padel"]) {
    if (t.includes(m)) return m;
  }
  return null;
}

function DayCard({
  dayName,
  plans,
  isTwoADay,
  today,
  timezone,
  amWindowStart,
  pmWindowStart,
}: {
  dayName: string;
  plans: PlannedCell[];
  isTwoADay: boolean;
  today: string;
  timezone: string;
  amWindowStart: string;
  pmWindowStart: string;
}) {
  if (plans.length === 0) {
    return (
      <div
        style={{
          padding: "12px 16px",
          border: "1px dashed var(--cp-border)",
          borderRadius: 12,
          color: "var(--cp-text-muted)",
          fontSize: 13,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{dayName}</span>
        <span>rest</span>
      </div>
    );
  }

  const dateStr = plans[0]!.date;
  const isToday = dateStr === today;
  const isPast = dateStr < today;
  // `isTwoADay` is computed upstream from the full planned-days array
  // so it survives a skipped/deleted partner — see Stage D in
  // feat/slot-semantics.

  // Compute the effective time-of-day per slot.
  const slotTimes = new Map<string, string>();
  for (const p of plans) {
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

  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        padding: isToday ? 4 : 0,
        borderRadius: 14,
        background: isToday ? "color-mix(in oklab, var(--cp-accent) 6%, transparent)" : undefined,
        border: isToday ? "1px solid var(--cp-accent)" : undefined,
      }}
    >
      {isTwoADay && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 14px 0", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {dayName} · {new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            {isToday && <span style={{ color: "var(--cp-accent)", marginLeft: 6 }}>· today</span>}
          </div>
          <span className="cp-pill" style={{ color: "var(--cp-accent)", borderColor: "var(--cp-accent)" }}>
            two-a-day{gapH != null ? ` · ${gapH.toFixed(0)}h gap` : ""}
          </span>
        </div>
      )}
      {isTwoADay && (
        <div
          role="note"
          style={{
            margin: "0 14px",
            padding: "8px 10px",
            border: "1px solid var(--cp-border)",
            borderRadius: 8,
            background: "var(--cp-surface-soft)",
            fontSize: 11,
            color: "var(--cp-text-muted)",
            lineHeight: 1.4,
          }}
          title="Robineau 2016 (HIGH) — recovery between concurrent sessions"
        >
          {gapShort ? (
            <strong style={{ color: "var(--cp-text)" }}>
              Sessions are {gapH!.toFixed(1)}h apart
            </strong>
          ) : (
            <strong style={{ color: "var(--cp-text)" }}>≥6 hours between sessions</strong>
          )}{" "}
          {gapShort
            ? "— research suggests ≥6h between AM lift and PM cardio so the strength signal isn't blunted by AMPK from the cardio."
            : "protects the strength signal — AMPK activation from cardio inhibits mTORC1 within shorter windows."}
          <span style={{ display: "block", marginTop: 2, fontStyle: "italic" }}>
            Robineau 2016.
          </span>
        </div>
      )}
      {plans.map((planned) => (
        <DaySessionCard
          key={planned.id}
          dayName={dayName}
          planned={planned}
          isToday={isToday}
          isPast={isPast}
          showHeader={!isTwoADay}
          isTwoADay={isTwoADay}
          timeOfDay={slotTimes.get(planned.slot) ?? null}
          isCustomTime={!!planned.plannedAt}
        />
      ))}
    </div>
  );
}

function DaySessionCard({
  dayName,
  planned,
  isToday,
  isPast,
  showHeader,
  isTwoADay,
  timeOfDay,
  isCustomTime,
}: {
  dayName: string;
  planned: PlannedCell;
  isToday: boolean;
  isPast: boolean;
  showHeader: boolean;
  isTwoADay: boolean;
  timeOfDay: string | null;
  isCustomTime: boolean;
}) {
  const done = !!planned.completedSessionId;
  const skipped = !!planned.skippedAt;
  // Stage C: slot badges only render when the day genuinely pairs two
  // sessions. A `slot` of "am" or "pm" without a partner is treated as
  // a single-session day for display purposes.
  const slotLabel = isTwoADay
    ? planned.slot === "am"
      ? "AM"
      : planned.slot === "pm"
        ? "PM"
        : null
    : null;

  return (
    <div
      className="cp-card"
      style={{
        padding: 16,
        borderColor: isToday && !isTwoADay ? "var(--cp-accent)" : undefined,
        background: isToday && !isTwoADay ? "var(--cp-accent-soft)" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div>
          {showHeader && (
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {dayName} · {new Date(planned.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {isToday && <span style={{ color: "var(--cp-accent)", marginLeft: 6 }}>· today</span>}
            </div>
          )}
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: showHeader ? 2 : 0 }}>
            {slotLabel && (
              <GlossaryBadge
                term="two_a_day"
                testId="day-card-slot-label"
                dataSlot={planned.slot}
                ariaLabel={`${slotLabel} session — explain two-a-day`}
                buttonStyle={{
                  fontSize: 10,
                  color: "var(--cp-accent)",
                  fontWeight: 700,
                  marginRight: 8,
                  letterSpacing: "0.08em",
                }}
              >
                <span className="mono">{slotLabel}</span>
              </GlossaryBadge>
            )}
            {planned.title}
            {timeOfDay && (
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--cp-text-muted)",
                  fontWeight: 500,
                  marginLeft: 8,
                }}
                title={isCustomTime ? "Custom time" : "Default from your AM/PM window"}
              >
                {timeOfDay}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 4 }}>
            {summarisePrescription(planned.prescription.items)}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          {done && <span className="cp-pill" style={{ color: "var(--cp-success)", borderColor: "var(--cp-success)" }}>✓ done</span>}
          {skipped && <span className="cp-pill" style={{ color: "var(--cp-warning)", borderColor: "var(--cp-warning)" }}>skipped</span>}
          {!done && !skipped && isPast && <span className="cp-pill" style={{ color: "var(--cp-text-muted)" }}>missed</span>}
        </div>
      </div>

      {planned.prescription.items.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 4 }}>
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
                {(() => {
                  const cleanedNote = cleanPrescriptionNotes(item.notes);
                  return cleanedNote ? (
                    <span style={{ color: "var(--cp-accent)", fontWeight: 600, marginLeft: 4 }}>· {cleanedNote}</span>
                  ) : null;
                })()}
              </span>
              <span className="mono" style={{ fontWeight: 600 }}>
                {formatPrescriptionItem(item)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!done && !skipped && isTwoADay && planned.slot !== "single" && (
        <form
          action={setPlannedTime}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 10,
            fontSize: 11,
            color: "var(--cp-text-muted)",
          }}
        >
          <input type="hidden" name="id" value={planned.id} />
          <label htmlFor={`time-${planned.id}`} style={{ flexShrink: 0 }}>
            {planned.slot === "am" ? "AM time" : "PM time"}
          </label>
          <input
            id={`time-${planned.id}`}
            type="time"
            name="hhmm"
            defaultValue={timeOfDay ?? ""}
            step={300}
            className="mono"
            style={{
              padding: "4px 8px",
              fontSize: 12,
              border: "1px solid var(--cp-border)",
              borderRadius: 6,
              background: "var(--cp-surface)",
              color: "var(--cp-text)",
              width: 100,
            }}
          />
          <button
            type="submit"
            className="cp-btn ghost"
            style={{ fontSize: 11, padding: "4px 10px" }}
          >
            Save
          </button>
          {isCustomTime && (
            <span style={{ fontStyle: "italic", marginLeft: 4 }}>· overrides default window</span>
          )}
        </form>
      )}

      {!done && !skipped && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Link
            href={`/app/sessions/start/${planned.id}`}
            className="cp-btn primary"
            style={{ flex: 1, textAlign: "center" }}
            data-testid={`start-${planned.id}`}
          >
            {isToday ? "⚡ Start now" : "Start session"}
          </Link>
          <SkipSessionForm
            plannedId={planned.id}
            title={planned.title}
            action={skipPlannedSession}
          />
        </div>
      )}

      {done && planned.completedSessionId && (
        <div style={{ marginTop: 12 }}>
          <Link href={`/app/sessions/${planned.completedSessionId}`} className="cp-btn" style={{ width: "100%" }}>
            View logged session →
          </Link>
        </div>
      )}

      {skipped && (
        <div style={{ marginTop: 12 }}>
          <form action={unskipPlannedSession}>
            <input type="hidden" name="id" value={planned.id} />
            <button type="submit" className="cp-btn ghost" style={{ width: "100%" }}>
              Un-skip
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function BlockCompleteCard({
  bump,
}: {
  bump: Awaited<ReturnType<typeof findBlockCompleteBump>>;
}) {
  if (!bump) return null;
  return (
    <section
      className="cp-card"
      style={{
        padding: 20,
        display: "grid",
        gap: 12,
        borderColor: "var(--cp-success)",
        background: "color-mix(in oklab, var(--cp-success) 6%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">✓</div>
        <div style={{ display: "grid", gap: 4, flex: 1 }}>
          <div style={{ fontSize: 11, color: "var(--cp-success)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
            Last block ended clean
          </div>
          <h2 style={{ fontSize: 18, margin: 0, letterSpacing: "-0.01em" }}>
            Bump your TMs before the next block?
          </h2>
          <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 13, lineHeight: 1.5 }}>
            Standard small-progression defaults: <strong>+5 kg</strong> on squat / deadlift,{" "}
            <strong>+2.5 kg</strong> on bench / overhead. Accept any subset; the rest stay where
            they are.
          </p>
        </div>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {bump.lifts.map((lift) => (
          <li
            key={lift.movementId}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 12px",
              background: "var(--cp-surface)",
              border: "1px solid var(--cp-border)",
              borderRadius: 10,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "grid", gap: 2, flex: 1, minWidth: 180 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{lift.movementDisplayName}</span>
              <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                <span className="mono">{lift.currentTm.toFixed(1)} kg</span>{" "}
                →{" "}
                <span className="mono" style={{ color: "var(--cp-success)" }}>
                  {lift.proposedTm.toFixed(1)} kg
                </span>{" "}
                <span style={{ marginLeft: 4 }}>(+{lift.increment} kg)</span>
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <form action={acceptTmBump}>
                <input type="hidden" name="movementId" value={lift.movementId} />
                <input type="hidden" name="newTmKg" value={String(lift.proposedTm)} />
                <input type="hidden" name="reason" value="block_complete" />
                <input type="hidden" name="triggerKey" value={lift.triggerKey} />
                <button type="submit" className="cp-btn primary" style={{ fontSize: 12 }}>
                  Accept
                </button>
              </form>
              <form action={declineTmBump}>
                <input type="hidden" name="movementId" value={lift.movementId} />
                <input type="hidden" name="triggerKey" value={lift.triggerKey} />
                <button type="submit" className="cp-btn ghost" style={{ fontSize: 12 }}>
                  Skip
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BlockCalendar({
  all,
  weeks,
  currentWeek,
  today,
}: {
  all: { weekIndex: number; dayIndex: number; date: string; completedSessionId: string | null; skippedAt: string | null }[];
  weeks: number;
  currentWeek: number;
  today: string;
}) {
  // Index by (week, day) for O(1) lookup.
  const byCell = new Map<string, { hasPlan: boolean; completed: boolean; skipped: boolean; date: string }>();
  for (const d of all) {
    const k = `${d.weekIndex}:${d.dayIndex}`;
    const prev = byCell.get(k) ?? { hasPlan: false, completed: false, skipped: false, date: d.date };
    byCell.set(k, {
      hasPlan: true,
      completed: prev.completed || !!d.completedSessionId,
      skipped: prev.skipped || !!d.skippedAt,
      date: d.date,
    });
  }
  return (
    <section className="cp-card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>Block overview</h2>
        <div style={{ display: "flex", gap: 10, fontSize: 10, color: "var(--cp-text-muted)", flexWrap: "wrap" }}>
          <Legend color="var(--cp-success)" label="Done" />
          <Legend color="var(--cp-text-muted)" label="Skipped" />
          <Legend color="var(--cp-accent)" label="Planned" />
          <Legend color="var(--cp-surface-soft)" label="Rest" />
        </div>
      </div>
      <div
        role="grid"
        aria-label="Block calendar"
        style={{
          display: "grid",
          gridTemplateColumns: `40px repeat(7, 1fr)`,
          gap: 4,
        }}
      >
        <div />
        {DOW.map((d) => (
          <div key={d} style={{ fontSize: 10, color: "var(--cp-text-muted)", textAlign: "center", fontWeight: 600 }}>
            {d[0]}
          </div>
        ))}
        {Array.from({ length: weeks }, (_, w) => (
          <CalendarWeekRow
            key={w}
            weekIndex={w}
            isCurrent={w === currentWeek}
            byCell={byCell}
            today={today}
          />
        ))}
      </div>
    </section>
  );
}

function CalendarWeekRow({
  weekIndex,
  isCurrent,
  byCell,
  today,
}: {
  weekIndex: number;
  isCurrent: boolean;
  byCell: Map<string, { hasPlan: boolean; completed: boolean; skipped: boolean; date: string }>;
  today: string;
}) {
  return (
    <>
      <Link
        href={`/app/plan?week=${weekIndex}`}
        style={{
          fontSize: 10,
          color: isCurrent ? "var(--cp-accent)" : "var(--cp-text-muted)",
          fontWeight: isCurrent ? 700 : 500,
          textDecoration: "none",
          alignSelf: "center",
        }}
      >
        Wk{weekIndex + 1}
      </Link>
      {Array.from({ length: 7 }, (_, dayIndex) => {
        const cell = byCell.get(`${weekIndex}:${dayIndex}`);
        const isToday = cell?.date === today;
        const bg = !cell
          ? "var(--cp-surface-soft)"
          : cell.completed
            ? "var(--cp-success)"
            : cell.skipped
              ? "var(--cp-text-muted)"
              : "var(--cp-accent-soft)";
        return (
          <div
            key={dayIndex}
            title={cell ? `Wk${weekIndex + 1} ${DOW[dayIndex]} (${cell.date})` : `Wk${weekIndex + 1} ${DOW[dayIndex]} — rest`}
            style={{
              height: 18,
              borderRadius: 4,
              background: bg,
              border: isToday ? "1.5px solid var(--cp-accent)" : "1px solid transparent",
              opacity: cell?.completed ? 1 : cell?.skipped ? 0.5 : 1,
            }}
          />
        );
      })}
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      <span>{label}</span>
    </span>
  );
}

function TissueStackCard({ gaps }: { gaps: TissueStackGap[] }) {
  return (
    <section
      className="cp-card"
      role="alert"
      style={{
        padding: "14px 18px",
        display: "grid",
        gap: 6,
        borderColor: "var(--cp-warning)",
        background: "color-mix(in oklab, var(--cp-warning) 6%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 11, color: "var(--cp-warning)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
          Tissue-stack deficit
        </div>
        <span style={{ fontSize: 10, color: "var(--cp-text-muted)" }} title="Baar 2017 HIGH; Magnusson & Kjaer 2019 HIGH">
          DC-O4
        </span>
      </div>
      <div style={{ fontSize: 13, color: "var(--cp-text)" }}>
        This week is missing tendon / connective-tissue work the research
        treats as a floor, not optional:
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--cp-text-muted)" }}>
        {gaps.map((g) => (
          <li key={g.role}>
            <strong style={{ color: "var(--cp-text)" }}>{g.label}</strong>
            {" "}— logged {g.actual}/{g.required} this week
          </li>
        ))}
      </ul>
    </section>
  );
}
