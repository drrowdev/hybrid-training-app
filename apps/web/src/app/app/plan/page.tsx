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
import type { Prescription, PrescriptionItem } from "@hta/db";
import { SkipSessionForm } from "@/components/plan/SkipSessionForm";
import { EndBlockForm } from "@/components/plan/EndBlockForm";
import { PlanViews, type ViewMode } from "@/components/plan/PlanViews";
import { UpNextHero, type WeekOnePreviewItem } from "@/components/plan/UpNextHero";
import { UpNextRail } from "@/components/plan/UpNextRail";
import { BlockHeatmapStrip } from "@/components/plan/BlockHeatmapStrip";
import { selectUpNext } from "@/lib/plan/up-next";
import { selectBlockState } from "@/lib/plan/block-state";
import { GlossaryBadge } from "@/components/ui/GlossaryBadge";
import { formatDate, resolveDateFormat, type ProfileForFormat } from "@/lib/format/datetime";
import { BodyweightOnlyBanner } from "@/components/banners/BodyweightOnlyBanner";
import {
  hasLoadableMainLift,
  resolveEquipment,
} from "@/lib/settings/equipment-presets";
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
import {
  groupByMovementThenKind,
  describeRowExternalLoad,
  type PlanSetRow,
  type PrescriptionMovementRow,
  type MovementPrescriptionSection,
} from "@/lib/plan/prescription-grouping";
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
        .select(
          "allows_two_a_days, timezone, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, bodyweight_kg",
        )
        .eq("id", user.id)
        .maybeSingle(),
      getRecentBlocks(3),
    ]);
    const allowsTwoADays = Boolean(prof?.allows_two_a_days ?? false);
    const tz = prof?.timezone ?? "UTC";
    const planEquipment = resolveEquipment(prof ?? null);

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
          equipmentPreset={planEquipment.preset}
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

  const upNext = selectUpNext({
    today,
    all: all.map((p) => ({
      id: p.id,
      date: p.date,
      slot: p.slot,
      title: p.title,
      prescription: p.prescription,
      completedSessionId: p.completedSessionId,
      skippedAt: p.skippedAt,
    })),
  });

  const blockState = selectBlockState({
    block: { startedOn: block.startedOn },
    today,
    planned: all.map((p) => ({
      date: p.date,
      completedSessionId: p.completedSessionId,
      skippedAt: p.skippedAt,
    })),
    upNext,
  });

  // Future-block hero preview: first week's planned sessions in display
  // order. Empty unless the block hasn't started yet.
  const weekOnePreview: WeekOnePreviewItem[] =
    blockState.kind === "future"
      ? all
          .filter((p) => p.weekIndex === 0)
          .sort((a, b) =>
            a.date === b.date
              ? slotOrder(a.slot) - slotOrder(b.slot)
              : a.date < b.date
                ? -1
                : 1,
          )
          .map((p) => ({
            id: p.id,
            date: p.date,
            title: p.title,
            summary: summarisePrescription(p.prescription.items),
          }))
      : [];

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

  // Bodyweight-only banner trigger: no loadable main lift in the
  // equipment row AND no training maxes set. Loaded inline rather than
  // joined into the top of-page fetches because it's a cheap one-shot
  // check used only for this banner.
  const { data: planEquipProfile } = await supabase
    .from("profiles")
    .select("equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, timezone, time_format, date_format")
    .eq("id", user.id)
    .maybeSingle();
  const planTmCtx = await getTrainingMaxContext();
  const showBodyweightBanner =
    !hasLoadableMainLift(resolveEquipment(planEquipProfile)) &&
    planTmCtx.rows.length === 0;
  const planFmtProfile: ProfileForFormat = planEquipProfile
    ? {
        timezone: planEquipProfile.timezone,
        time_format: planEquipProfile.time_format ?? null,
        date_format: planEquipProfile.date_format ?? null,
      }
    : null;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {archetypeKicker}{archetypeName} · started {formatDate(block.startedOn, planFmtProfile)}
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

      {showBodyweightBanner && <BodyweightOnlyBanner />}

      <UpNextHero
        state={blockState}
        selection={upNext}
        skipAction={skipPlannedSession}
        formatProfile={planFmtProfile}
        weekOnePreview={weekOnePreview}
        blockName={archetypeName}
        blockSessionCount={totalPlanned}
        blockWeeks={block.weeks}
        completedActions={
          blockState.kind === "completed" ? (
            <EndBlockForm blockId={block.id} action={endBlock} />
          ) : undefined
        }
      />

      <div
        className="cp-plan-two-col"
        data-future={blockState.kind === "future" ? "true" : undefined}
        style={
          blockState.kind === "future"
            ? { opacity: 0.7, filter: "saturate(0.8)" }
            : undefined
        }
      >
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
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
            formatProfile={planFmtProfile}
          />
          <BlockHeatmapStrip all={all} today={today} />
        </div>
        <UpNextRail sessions={upNext.upcoming} formatProfile={planFmtProfile} />
      </div>

      <style>{`
        .cp-plan-two-col {
          display: grid;
          gap: 16px;
          grid-template-columns: minmax(0, 1fr);
          align-items: start;
        }
        @media (min-width: 1024px) {
          .cp-plan-two-col {
            grid-template-columns: minmax(0, 1.85fr) minmax(260px, 1fr);
          }
        }
      `}</style>

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
            formatProfile={planFmtProfile}
            tmByMovementId={planTmCtx.byMovementId}
          />
        ))}
      </section>

      <section className="cp-card" style={{ padding: 16, display: blockState.kind === "completed" ? "none" : undefined }}>
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
  formatProfile,
  tmByMovementId,
}: {
  dayName: string;
  plans: PlannedCell[];
  isTwoADay: boolean;
  today: string;
  timezone: string;
  amWindowStart: string;
  pmWindowStart: string;
  formatProfile: ProfileForFormat;
  tmByMovementId: ReadonlyMap<string, number>;
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
      <div
        data-testid={`plan-day-header-${dateStr}`}
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "6px 14px 0",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {dayName} ·{" "}
          {formatDate(
            dateStr + "T00:00:00Z",
            // Resolve date_format using the user's actual timezone (so
            // Helsinki → dmy_short), then render with timezone:UTC to
            // avoid the calendar-date shift that would happen if we
            // re-interpreted midnight-UTC in the user's local zone.
            { date_format: resolveDateFormat(formatProfile), timezone: "UTC" },
            "short_date",
          )}
          {isToday && <span style={{ color: "var(--cp-accent)", marginLeft: 6 }}>· today</span>}
        </div>
        {isTwoADay && (
          <span className="cp-pill" style={{ color: "var(--cp-accent)", borderColor: "var(--cp-accent)" }}>
            two-a-day{gapH != null ? ` · ${gapH.toFixed(0)}h gap` : ""}
          </span>
        )}
      </div>
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
          planned={planned}
          isToday={isToday}
          isPast={isPast}
          isTwoADay={isTwoADay}
          timeOfDay={slotTimes.get(planned.slot) ?? null}
          isCustomTime={!!planned.plannedAt}
          tmByMovementId={tmByMovementId}
        />
      ))}
    </div>
  );
}

function DaySessionCard({
  planned,
  isToday,
  isPast,
  isTwoADay,
  timeOfDay,
  isCustomTime,
  tmByMovementId,
}: {
  planned: PlannedCell;
  isToday: boolean;
  isPast: boolean;
  isTwoADay: boolean;
  timeOfDay: string | null;
  isCustomTime: boolean;
  tmByMovementId: ReadonlyMap<string, number>;
}) {
  const done = !!planned.completedSessionId;
  const skipped = !!planned.skippedAt;
  // Past completed sessions are de-emphasised in the full week list —
  // the user's eye should land on what's still actionable. Today's
  // session stays at full strength even when completed.
  const mutedPast = done && isPast && !isToday;
  // Skipped sessions get a one-glance distinction: warning-token left
  // border accent + reduced opacity so they read as "intentionally
  // bypassed", not the same vocabulary as completed.
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
      data-testid={`plan-day-card-${planned.id}`}
      data-muted={mutedPast ? "true" : undefined}
      data-skipped={skipped ? "true" : undefined}
      style={{
        padding: 16,
        borderColor: skipped
          ? "var(--cp-warning)"
          : isToday && !isTwoADay
            ? "var(--cp-accent)"
            : undefined,
        borderLeft: skipped ? "3px solid var(--cp-warning)" : undefined,
        background: skipped
          ? "color-mix(in oklab, var(--cp-warning) 4%, transparent)"
          : isToday && !isTwoADay
            ? "var(--cp-accent-soft)"
            : undefined,
        opacity: mutedPast ? 0.55 : skipped ? 0.75 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
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
        <PlannedPrescriptionSections
          items={planned.prescription.items}
          tmByMovementId={tmByMovementId}
        />
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
            className={isToday ? "cp-btn primary" : "cp-btn"}
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
      <div style={{ fontSize: 11, color: "var(--cp-warning)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
        Tissue-stack deficit
      </div>
      <div style={{ fontSize: 13, color: "var(--cp-text)" }}>
        This week is missing tendon / connective-tissue work the research
        treats as a floor, not optional:
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--cp-text-muted)" }}>
        {gaps.map((g) => (
          <li key={g.role}>
            <strong style={{ color: "var(--cp-text)" }}>{g.label}</strong>
            {" "}— {g.actual}/{g.required} planned this week
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Structured renderer for a planned session's prescription. Sessions
 * can carry MULTIPLE movements (bodyweight blocks emit one main +
 * back-off per family — push + pull + squat in the same session), so
 * we group by movement first and then bucket each movement's items by
 * kind (warm-up → main → back-off → accessory → tendon → hinge
 * compensation). Cardio is session-level and renders once at the
 * bottom.
 *
 * This replaces an earlier "group by kind only" pass which flattened
 * Front Squat 75% TM ×5 next to Wide-grip pull-up ×15 in the same
 * "Main work" column with no movement name attached, producing rows
 * the user couldn't parse.
 */
function PlannedPrescriptionSections({
  items,
  tmByMovementId,
}: {
  items: PrescriptionItem[];
  tmByMovementId?: ReadonlyMap<string, number>;
}) {
  const grouped = groupByMovementThenKind(items);
  const blocks: React.ReactNode[] = [];

  for (const section of grouped.movements) {
    blocks.push(
      <MovementSubsection
        key={`mov-${section.rowKey}`}
        section={section}
        tmKg={
          section.movementId && tmByMovementId
            ? tmByMovementId.get(section.movementId)
            : undefined
        }
      />,
    );
  }

  if (grouped.accessories.length > 0) {
    blocks.push(
      <MovementRowSection
        key="accessories"
        label={`Accessories (${grouped.accessories.length})`}
        rows={grouped.accessories}
        testId="plan-section-accessories"
      />,
    );
  }
  if (grouped.hingeCompensations.length > 0) {
    blocks.push(
      <MovementRowSection
        key="hinge"
        label="Posterior-chain support"
        rows={grouped.hingeCompensations}
        testId="plan-section-hinge-comp"
      />,
    );
  }
  if (grouped.tendon.length > 0) {
    blocks.push(
      <MovementRowSection
        key="tendon"
        label="Tendon work"
        rows={grouped.tendon}
        testId="plan-section-tendon"
      />,
    );
  }
  if (grouped.cardio.length > 0) {
    blocks.push(<CardioSection key="cardio" items={grouped.cardio} />);
  }

  if (blocks.length === 0) return null;

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 14 }} data-testid="plan-prescription-sections">
      {blocks}
    </div>
  );
}

/**
 * One movement = one labelled header + optional collapsed warm-up + a
 * single flat numbered "Sets" list (main + back-off merged, with a
 * tiny `back-off` chip on back-off rows). No "MAIN WORK" /
 * "BACK-OFF" sub-headers — the movement header IS the section.
 */
function MovementSubsection({
  section,
  tmKg,
}: {
  section: MovementPrescriptionSection;
  tmKg?: number;
}) {
  if (section.sets.length === 0 && section.warmups.length === 0) return null;
  const headerBadge = buildMovementHeaderBadge(section, tmKg);
  return (
    <div
      data-testid={`plan-movement-section-${section.rowKey}`}
      style={{ display: "grid", gap: 6 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          fontSize: 14,
          fontWeight: 700,
          color: "var(--cp-text)",
        }}
      >
        <span>{section.movementName}</span>
        {headerBadge && (
          <span
            className="cp-pill"
            data-testid={`plan-movement-badge-${section.rowKey}`}
            style={{
              fontSize: 10,
              padding: "0 6px",
              color: "var(--cp-text-muted)",
              borderColor: "var(--cp-border)",
              fontWeight: 500,
            }}
          >
            {headerBadge}
          </span>
        )}
      </div>
      {section.warmups.length > 0 && <WarmupSection items={section.warmups} />}
      {section.sets.length > 0 && (
        <MainWorkSection
          rows={section.sets}
          tmKg={tmKg}
          testId={`plan-section-sets-${section.rowKey}`}
        />
      )}
    </div>
  );
}

/**
 * Short tag rendered next to the movement name. For loaded lifts: the
 * TM in kg ("100 kg TM") when one is known. For bodyweight items: the
 * current progression node display name from the `bw` payload ("at
 * Decline push-up") — that's the actual movement variant the user
 * will perform, distinct from the family name shown in the header.
 */
function buildMovementHeaderBadge(
  section: MovementPrescriptionSection,
  tmKg?: number,
): string | null {
  if (tmKg != null && tmKg > 0) return `${tmKg} kg TM`;
  for (const row of section.sets) {
    const bw = row.item.bw as { nodeDisplayName?: string } | undefined;
    if (bw?.nodeDisplayName && bw.nodeDisplayName !== section.movementName) {
      return `at ${bw.nodeDisplayName}`;
    }
  }
  return null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--cp-text-muted)",
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function WarmupSection({ items }: { items: PrescriptionItem[] }) {
  return (
    <details data-testid="plan-section-warmup">
      <summary
        style={{
          cursor: "pointer",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--cp-text-muted)",
          fontWeight: 600,
          listStyle: "revert",
        }}
      >
        Warm-up · {items.length} set{items.length === 1 ? "" : "s"}
      </summary>
      <div
        className="mono"
        style={{
          marginTop: 6,
          fontSize: 12,
          color: "var(--cp-text-muted)",
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 14px",
        }}
      >
        {items.map((it, i) => (
          <span key={i}>
            {i + 1} · {formatPrescriptionItem(it)}
          </span>
        ))}
      </div>
    </details>
  );
}

function MainWorkSection({
  rows,
  testId = "plan-section-sets",
  tmKg,
}: {
  rows: PlanSetRow[];
  testId?: string;
  tmKg?: number;
}) {
  return (
    <div data-testid={testId} style={{ display: "grid", gap: 4 }}>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
        {rows.map((row, i) => {
          // Only surface *short* contextual notes inline. Long
          // educational cues (e.g. "Advanced skill nodes load the
          // tendon harder than the muscle...") belong in the session
          // log focus view, not in the plan-page preview where they
          // overwhelm the prescription. 24-char threshold catches
          // markers like "top set" / "AMRAP" while filtering the
          // multi-sentence cues.
          const cleanedNote = cleanPrescriptionNotes(row.item.notes);
          const shortNote =
            cleanedNote && cleanedNote.length <= 24 ? cleanedNote : null;
          return (
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
                Set {row.setNumber}
                {row.isTopSet && (
                  <span
                    className="cp-pill"
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      padding: "0 6px",
                      color: "var(--cp-accent)",
                      borderColor: "var(--cp-accent)",
                    }}
                  >
                    top set
                  </span>
                )}
                {row.isBackOff && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      color: "var(--cp-text-muted)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    back-off
                  </span>
                )}
                {shortNote && (
                  <span
                    style={{
                      color: "var(--cp-text-muted)",
                      fontWeight: 400,
                      marginLeft: 6,
                      fontSize: 12,
                    }}
                  >
                    · {shortNote}
                  </span>
                )}
              </span>
              <span className="mono" style={{ fontWeight: 600 }}>
                {formatPrescriptionItem(row.item, tmKg)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Compact "one row per movement" renderer used by accessories,
 * hinge-compensation, and tendon sections. Aggregates repeated items
 * for the same movement into a single `N × R` summary so a Bulgarian
 * split squat prescribed as two items shows once as `2 × 14`.
 */
function MovementRowSection({
  label,
  rows,
  testId,
}: {
  label: string;
  rows: PrescriptionMovementRow[];
  testId: string;
}) {
  return (
    <div data-testid={testId} style={{ display: "grid", gap: 4 }}>
      <SectionLabel>{label}</SectionLabel>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
        {rows.map((row) => {
          const loadBadge = describeRowExternalLoad(row);
          return (
            <li
              key={row.rowKey}
              style={{
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 8,
                padding: "6px 10px",
                background: "var(--cp-surface-soft)",
                borderRadius: 6,
              }}
            >
              <span style={{ fontWeight: 500 }}>
                {row.movementName}
                {loadBadge && (
                  <span
                    className="cp-pill"
                    data-testid={`plan-row-load-${row.rowKey}`}
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      padding: "0 6px",
                      color: "var(--cp-text-muted)",
                      borderColor: "var(--cp-border)",
                    }}
                  >
                    {loadBadge}
                  </span>
                )}
              </span>
              <span className="mono" style={{ fontWeight: 600, color: "var(--cp-text-muted)" }}>
                {formatMovementRowPrescription(row)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CardioSection({ items }: { items: PrescriptionItem[] }) {
  return (
    <div data-testid="plan-section-cardio" style={{ display: "grid", gap: 4 }}>
      <SectionLabel>Cardio</SectionLabel>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
        {items.map((it, i) => (
          <li
            key={i}
            style={{
              fontSize: 13,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 8,
              padding: "6px 10px",
              background: "var(--cp-surface-soft)",
              borderRadius: 6,
            }}
          >
            <span style={{ fontWeight: 500 }}>
              {it.movementName ?? it.intensityLabel ?? "Cardio"}
            </span>
            <span className="mono" style={{ fontWeight: 600, color: "var(--cp-text-muted)" }}>
              {formatPrescriptionItem(it)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Compact "N × R" / "N × R/side" prescription summary for one
 * accessory movement row. Falls back to the canonical
 * `formatPrescriptionItem` when the items disagree about reps or carry
 * extra detail (RIR, hold time) that the single-line formatter handles.
 */
function formatMovementRowPrescription(row: PrescriptionMovementRow): string {
  const first = row.items[0];
  if (!first) return "";
  // Total sets = sum of the `sets` field across this movement's
  // PrescriptionItems. The dynamic picker emits ONE PrescriptionItem
  // per accessory movement with `sets: N`, so naively using
  // `row.items.length` produced `1 × 14` everywhere even when the
  // archetype prescribed 2 or 3 sets.
  const totalSets = row.items.reduce((acc, it) => acc + (it.sets ?? 1), 0);

  // Carries: distance per trip × N trips. Pooled from `distanceM` so
  // the accessory-intensity matrix's per-week distance ramp surfaces.
  if (first.distanceM) {
    const { min, max } = first.distanceM;
    const dist = min === max ? `${min} m` : `${min}–${max} m`;
    return `${totalSets} × ${dist}`;
  }

  // Isometric accessories: hold duration, not reps.
  if (first.holdSec) {
    const { min, max } = first.holdSec;
    const hold = min === max ? `${min}s hold` : `${min}–${max}s hold`;
    return `${totalSets} × ${hold}`;
  }

  // Standard reps path. If every item agrees on the rep target, render
  // as `N × R` (with `/side` suffix when the movement is unilateral).
  const reps = row.items.map((i) => i.reps).filter((r): r is number => r != null);
  const allSameReps = reps.length === row.items.length && reps.every((r) => r === reps[0]);
  if (allSameReps && reps.length > 0) {
    const perSideHint = /per[\s_-]?side|each[\s_-]?side|\/side/i;
    const noteHasSide = (first.notes ?? "").match(perSideHint);
    const cueHasSide = (first.intensityCue ?? "").match(perSideHint);
    const suffix = noteHasSide || cueHasSide ? "/side" : "";
    return `${totalSets} × ${reps[0]}${suffix}`;
  }
  // Heterogeneous items — fall back to the canonical per-item formatter
  // on the first row. The user can expand the session card to see the
  // full breakdown via the in-session log.
  return formatPrescriptionItem(first);
}



