import Link from "next/link";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  archetypeDisplayName,
  getActiveBlock,
  getPlannedDays,
  getRecentBlocks,
  getTodayPlannedSessions,
  getUpcomingPlannedSessions,
  type PlannedDay,
} from "@/lib/planner/queries";
import { todayYmd } from "@/lib/dates";
import { effectiveTimeOfDay } from "@/lib/planner/time-of-day";
import { hasTwoADaySlotPair } from "@/lib/planner/slot";
import { getRegionFreshness, type FreshnessConflict } from "@/lib/stats/region-freshness-queries";
import { getMuscleFreshness } from "@/lib/muscle/muscle-freshness";
import { findHeavyOnRecoveringConflictWithMuscles } from "@/lib/muscle/muscle-conflict";
import { BodyweightOnlyBanner } from "@/components/banners/BodyweightOnlyBanner";
import { dismissBwBanner } from "@/lib/profile/actions";
import { ProgramRecommendationsBanner } from "@/components/today/ProgramRecommendationsBanner";
import { getPendingProgramRecommendations, type PendingProgramRecommendation } from "@/lib/platform/recommendations-queries";
import { dismissProgramRecommendation } from "@/lib/platform/actions";
import { SessionPreviewBody } from "@/components/session/SessionPreviewBody";
import { QuickWorkoutCard } from "@/components/today/QuickWorkoutCard";
import {
  startQuickStrengthSession,
  repeatRecentSession,
  generateQuickStrengthSession,
  generateQuickHyroxSession,
  updatePlannedSessionNotes,
  markExternalCardioComplete,
} from "@/lib/sessions/actions";
import { getQuickRepeatCandidates } from "@/lib/sessions/queries";
import { getLimitationTodaySummary } from "@/lib/limitations/today-summary";
import { getNextBlockNudge } from "@/lib/planner/next-block-suggestion-server";
import { NextBlockSuggestionCard } from "@/components/planner/NextBlockSuggestionCard";
import type { SuggestProgramId } from "@/lib/planner/next-block-suggestion";
import { KNOWN_SUGGEST_PROGRAMS } from "@/lib/planner/next-block-suggestion";
import { getActiveSeason } from "@/lib/seasons/queries";
import { nextPlannedBlock } from "@/lib/seasons/season-logic";
import { selectablePrograms } from "@/lib/platform/registry";
import {
  ActiveLimitationsCard,
  type ActiveLimitationSummary,
} from "@/components/today/ActiveLimitationsCard";
import {
  hasLoadableMainLift,
  resolveEquipment,
} from "@/lib/settings/equipment-presets";
import { defaultHyroxStationsFromEquipment } from "@/lib/planner/quick-hyrox";
import { computeTaperRecommendation, taperModalityForEvent } from "@/lib/planner/taper";
import { computeRecoveryWindow } from "@/lib/planner/recovery";
import { TaperBanner, type TaperBannerState } from "@/components/today/TaperBanner";
import { RecoveryBanner, type RecoveryBannerState } from "@/components/today/RecoveryBanner";
import { RaceCheckInCard } from "@/components/today/RaceCheckInCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { TmSuggestionBanner, type TmSuggestionView } from "@/components/today/TmSuggestionBanner";
import {
  acceptTmSuggestion,
  dismissTmSuggestion,
} from "@/lib/training-maxes/actions";
import type { TmFormula } from "@hta/db";
import { listTrainingMaxes } from "@/lib/training-maxes/queries";
import { addDaysToYmd } from "@/lib/dates";
import {
  formatDate,
  formatEyebrowDate,
  type ProfileForFormat,
} from "@/lib/format/datetime";
import {
  movePlannedSession,
  skipPlannedSession,
  startSessionFromPlan,
  unskipPlannedSession,
} from "@/lib/planner/actions";
import {
  estimateSessionDurationBreakdown,
} from "@/lib/sessions/estimate-duration";
import { ThisWeekRail } from "@/components/plan/ThisWeekRail";
import { plannedSessionCta } from "@/lib/today/planned-session-cta";
import type { PlanSessionInput } from "@/components/plan/PlanRedesign";
import {
  actionablePlannedSessions,
  isTodayFullyLogged,
  orderPlannedSessionsForToday,
} from "@/lib/sessions/today-hero";
import {
  groupByMovementThenKind,
  isSupplementalOnlySection,
} from "@/lib/plan/prescription-grouping";

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  const userId = user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, timezone, am_window_start, pm_window_start, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, time_format, date_format, bw_nudge_hidden_until, bw_banner_dismissed_at, units, season_planning_enabled",
    )
    .eq("id", userId)
    .maybeSingle();

  const todayIso = todayYmd(profile?.timezone ?? "UTC");

  const [{ data: todaySessions }, { data: recent }, plannedToday, upcoming, freshness, activeBlock, tmRows, { data: activeLimitationsRaw }, quickRepeatRecent, limitationSummary, programRecs] = await Promise.all([
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
    listTrainingMaxes(),
    supabase
      .from("limitations")
      .select("id, kind, severity, started_at")
      .eq("user_id", userId)
      .is("resolved_at", null)
      .order("started_at", { ascending: false })
      .limit(20),
    getQuickRepeatCandidates(supabase, userId, { limit: 3 }),
    getLimitationTodaySummary(),
    getPendingProgramRecommendations(supabase, userId),
  ]);

  const activeLimitations: ActiveLimitationSummary[] = (
    activeLimitationsRaw ?? []
  ).map((r) => ({
    id: r.id as string,
    kind: (r.kind as string | null) ?? null,
    severity: r.severity as "mild" | "moderate" | "severe",
    startedAt: r.started_at as string,
  }));

  const archetypeName = activeBlock
    ? archetypeDisplayName(activeBlock.archetype, activeBlock.notes)
    : null;
  // Audit F16 fix — the five groups that follow used to await one
  // after another (dominating the 2s TTFB). They are
  // mutually independent given the inputs already resolved by the
  // first Promise.all above, so resolve them in one outer Promise.all
  // of async IIFEs. The post-fetch in-memory work (conflict computation
  // and week-strip bucketing) still runs serially
  // after the Promise.all since it consumes results from multiple
  // groups.
  const plannedMovementIds = Array.from(
    new Set(plannedToday.flatMap((p) => p.prescription.items.map((i) => i.movementId))),
  );
  const [
    pendingSuggestions,
    nextEvent,
    { movementRegionById, movementSlugById },
    muscleFreshnessRows,
  ] = await Promise.all([
    // Group A — pending TM suggestions + their joined source set /
    // session / movement rows. The inner Promise.all stays inside
    // the IIFE because it depends on the suggestion list.
    (async (): Promise<TmSuggestionView[]> => {
      const { data: pendingSuggestionsRaw } = await supabase
        .from("tm_suggestions")
        .select(
          "id, movement_id, current_tm_kg, suggested_tm_kg, derived_formula, derived_from_set_log_id, derived_from_session_id, created_at",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (!pendingSuggestionsRaw || pendingSuggestionsRaw.length === 0) return [];
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
      return pendingSuggestionsRaw.map((s) => {
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
    })(),

    // Group C — next priority event (drives the taper recommendation).
    supabase
      .from("priority_events")
      .select("id, name, event_date, priority, modality, target_performance, result")
      .eq("user_id", userId)
      .gte("event_date", todayIso)
      .order("event_date", { ascending: true })
      .limit(1)
      .maybeSingle()
      .then((r) => r.data),

    // Group D — region / slug maps for the planned movements today
    // (DC-V2 heavy-on-recovering soft warning).
    (async (): Promise<{
      movementRegionById: Map<string, { primaryRegion: string; name: string }>;
      movementSlugById: Map<string, string | null>;
    }> => {
      const regionMap = new Map<string, { primaryRegion: string; name: string }>();
      const slugMap = new Map<string, string | null>();
      if (plannedMovementIds.length === 0) {
        return { movementRegionById: regionMap, movementSlugById: slugMap };
      }
      const { data: movs } = await supabase
        .from("movements")
        .select("id, name, slug, primary_region")
        .in("id", plannedMovementIds);
      for (const m of movs ?? []) {
        regionMap.set(m.id, {
          primaryRegion: m.primary_region as string,
          name: m.name as string,
        });
        slugMap.set(m.id, (m.slug as string | null) ?? null);
      }
      return { movementRegionById: regionMap, movementSlugById: slugMap };
    })(),

    // Group E — muscle-level freshness (PR feat/muscle-grid-16).
    getMuscleFreshness(supabase, userId, { tz: profile?.timezone ?? "UTC" }),
  ]);

  const taper = computeTaperRecommendation(
    nextEvent
      ? {
          name: nextEvent.name,
          date: nextEvent.event_date,
          priority: nextEvent.priority,
          modality: taperModalityForEvent(nextEvent.modality),
        }
      : null,
  );

  // Fetch the most recent past event in the user's local tz (for the
  // race check-in + recovery banner) and any active modification rows
  // for either event. Both queries are cheap (LIMIT 1 / index hit).
  const yesterdayIso = (() => {
    const d = new Date(`${todayIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const { data: pastEventRow } = await supabase
    .from("priority_events")
    .select("id, name, event_date, priority, modality, target_performance, result")
    .eq("user_id", userId)
    .lt("event_date", todayIso)
    .order("event_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  type ModRow = {
    id: string;
    event_id: string | null;
    kind: "taper" | "recovery";
    status: "applied" | "declined" | "reverted";
    applied_at: string;
    payload: { triggeredPhase?: string; triggeredAtDaysOut?: number } | Record<string, unknown>;
  };
  const candidateEventIds = [nextEvent?.id, pastEventRow?.id].filter(
    (x): x is string => typeof x === "string",
  );
  let modRows: ModRow[] = [];
  if (candidateEventIds.length > 0) {
    const { data: rows } = await supabase
      .from("prescription_modifications")
      .select("id,event_id,kind,status,applied_at,payload")
      .eq("user_id", userId)
      .in("event_id", candidateEventIds)
      .neq("status", "reverted")
      .order("applied_at", { ascending: false });
    modRows = (rows ?? []) as ModRow[];
  }

  function latestForEvent(eventId: string, kind: "taper" | "recovery"): ModRow | null {
    return modRows.find((r) => r.event_id === eventId && r.kind === kind) ?? null;
  }

  let taperBannerProps: React.ComponentProps<typeof TaperBanner> | null = null;
  if (taper && nextEvent) {
    const latest = latestForEvent(nextEvent.id, "taper");
    let state: TaperBannerState | null;
    if (!latest) state = { kind: "pending" };
    else if (latest.status === "applied") {
      const p = latest.payload as { triggeredPhase?: string; triggeredAtDaysOut?: number };
      state = {
        kind: "applied",
        appliedDaysOut: typeof p.triggeredAtDaysOut === "number" ? p.triggeredAtDaysOut : taper.daysOut,
        appliedPhase: (p.triggeredPhase as TaperBannerState extends { appliedPhase: infer X } ? X : never) ?? taper.phase,
      };
    } else {
      // Declined: the user dismissed the taper for this window. Keep the
      // audit row (the engine ignores it) but hide the banner outright —
      // a declined recommendation should disappear, not nag.
      state = null;
    }
    if (state) {
      taperBannerProps = {
        eventId: nextEvent.id,
        eventName: nextEvent.name,
        daysOut: taper.daysOut,
        phase: taper.phase as "approach" | "deep" | "polish" | "event_day",
        volumeScale: taper.volumeScale,
        intensityAction: taper.intensityAction,
        state,
      };
    }
  }

  // Race check-in + recovery banner gating. The check-in shows the
  // day after `event_date` until result.status is set; recovery
  // banner shows after a "raced" or "partial" check-in.
  let raceCheckInProps: { eventId: string; eventName: string } | null = null;
  let recoveryBannerProps: React.ComponentProps<typeof RecoveryBanner> | null = null;
  if (pastEventRow && pastEventRow.priority !== "C") {
    const eventIso = String(pastEventRow.event_date);
    const isYesterdayOrEarlier = eventIso <= yesterdayIso;
    const resultObj = (pastEventRow.result as Record<string, unknown> | null) ?? null;
    const resultStatus =
      typeof resultObj?.status === "string"
        ? (resultObj.status as "raced" | "partial" | "skipped")
        : null;

    if (isYesterdayOrEarlier && resultStatus === null) {
      raceCheckInProps = { eventId: pastEventRow.id, eventName: pastEventRow.name };
    } else if (resultStatus === "raced" || resultStatus === "partial") {
      // Compute recovery to feed banner. We deliberately recompute
      // (not snapshot-pull) so the *display* always reflects current
      // engine spec; the *applied* row carries its own snapshot.
      const distanceKm =
        (typeof (pastEventRow.target_performance as Record<string, unknown> | null)?.targetDistanceKm ===
        "number"
          ? ((pastEventRow.target_performance as Record<string, unknown>).targetDistanceKm as number)
          : null) ?? null;
      const modality = (() => {
        const m = pastEventRow.modality;
        return m === "run" || m === "bike" || m === "swim" || m === "row" || m === "triathlon"
          ? m
          : ("other" as const);
      })();
      const win = computeRecoveryWindow({
        distanceKm,
        durationMin: null,
        modality,
        priority: pastEventRow.priority,
        userTier: 2,
      });
      if (win) {
        // Stop showing recovery banner after the window has passed.
        const startD = new Date(`${eventIso}T00:00:00Z`);
        startD.setUTCDate(startD.getUTCDate() + 1);
        const endD = new Date(startD);
        endD.setUTCDate(endD.getUTCDate() + win.days - 1);
        const todayD = new Date(`${todayIso}T00:00:00Z`);
        const inWindow = todayD >= startD && todayD <= endD;
        if (inWindow) {
          const latest = latestForEvent(pastEventRow.id, "recovery");
          let state: RecoveryBannerState | null;
          if (!latest) state = { kind: "pending" };
          else if (latest.status === "applied") state = { kind: "applied" };
          // Declined: hide the banner outright (audit row stays). A declined
          // recommendation should disappear, not persist.
          else state = null;
          if (state) {
            recoveryBannerProps = {
              eventId: pastEventRow.id,
              eventName: pastEventRow.name,
              days: win.days,
              strengthLoadScale: win.strengthLoadScale,
              cardioLoadScale: win.cardioLoadScale,
              rampDays: win.rampDays,
              ...(win.confidence ? { confidence: win.confidence } : {}),
              state,
            };
          }
        }
      }
    }
  }

  const freshnessByRegion = new Map(
    freshness.map((r) => [r.region, { freshness: r.freshness, regionLabel: r.regionLabel }]),
  );
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
  const isMultiSessionDay = plannedToday.length > 1;
  const isTwoADay = hasTwoADaySlotPair(
    plannedToday.map((planned) => planned.slot),
  );
  const timezone = profile?.timezone ?? "UTC";
  const amWindowStart = profile?.am_window_start ?? "07:00:00";
  const pmWindowStart = profile?.pm_window_start ?? "17:00:00";
  const hyroxStationDefaults = defaultHyroxStationsFromEquipment(
    resolveEquipment(profile),
  );

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

  // Final-week next-block guidance (ADR 0010). The /app/plan nudge only
  // appears once a block has ended; surfacing the same read-only, advice-only
  // suggestion during the block's final week reaches the user at the decision
  // point instead of after they've already left the block. Computed only in
  // the final week to keep the extra queries off the common Today path.
  const inFinalWeek =
    activeBlock != null &&
    computedWeekIndex != null &&
    computedWeekIndex >= activeBlock.weeks - 1;
  const endingNudge = inFinalWeek
    ? await (async () => {
        const recent = await getRecentBlocks(3);
        // The next-block nudge suggests which PROGRAM to run next (ADR 0010,
        // de-archetyped per ADR 0046). Map recent blocks to their platform
        // program id, keeping only the known selectable lineup so a run of the
        // same program can be detected; legacy archetype blocks (program_id
        // NULL) drop out.
        const recentPrograms = recent
          .map((b) => b.programId)
          .filter((p): p is SuggestProgramId =>
            p != null && KNOWN_SUGGEST_PROGRAMS.has(p),
          );
        return getNextBlockNudge(
          supabase,
          userId,
          recentPrograms,
          todayIso,
          recent.length > 0 ? recent[recent.length - 1].startedOn : null,
        );
      })()
    : null;

  // Season-aware override (ADR 0051 D2): when Season planning is on and the user
  // has an active Season with a next planned block, the final-week nudge advances
  // the roadmap (activate the next block) instead of the recomputed ADR-0010
  // guess. Only computed in the final week, gated on the opt-in flag.
  const seasonNext =
    inFinalWeek && profile?.season_planning_enabled === true
      ? await (async () => {
          const season = await getActiveSeason();
          if (!season) return null;
          const next = nextPlannedBlock(season.blocks);
          if (!next) return null;
          const programName =
            selectablePrograms().find((p) => p.id === next.programId)?.name ??
            next.programId;
          return { seasonName: season.name, block: next, programName };
        })()
      : null;

  // Today is a single-column layout — the right rail (Training Maxes
  // summary) was retired with the shell refresh; TM details live on
  // /app/settings/training-maxes now.
  const isRestDay = plannedToday.length === 0 && !openSession;
  const todayDate = new Date();

  // Overdue planned sessions across the active block (date < today,
  // neither completed nor skipped). The today page surfaces a single
  // "you have N overdue" link above the day's primary card so the user
  // can review them on /app/plan — we never auto-open a past planned
  // session in the today flow.
  const plannedDaysAll = activeBlock
    ? await getPlannedDays(activeBlock.id, activeBlock.startedOn)
    : [];
  // "This week" rail sessions — built in the same PlanSessionInput shape
  // the /app/plan page uses so the Today rail reuses the shared rail +
  // drawer (single source of truth; see components/plan/ThisWeekRail).
  const weekRailSessions: PlanSessionInput[] = plannedDaysAll.map((p) => {
    const items = p.prescription?.items ?? [];
    const isCardio =
      items.length > 0 && items.every((i) => (i.kind ?? "").startsWith("cardio_"));
    const hasStrengthItems = items.some((i) => !(i.kind ?? "").startsWith("cardio_"));
    const isRehab = p.role === "rehab";
    return {
      id: p.id,
      weekIndex: p.weekIndex,
      dayIndex: p.dayIndex,
      date: p.date,
      title: p.title,
      isCardio,
      isStrength: hasStrengthItems && !isRehab,
      isRehab,
      done: p.completedAt != null,
      inProgress: !!p.completedSessionId && p.completedAt == null,
      skipped: !!p.skippedAt,
      slot: p.slot,
      items,
      estDurationMin: estimateSessionDurationBreakdown(items).displayMinutes,
      notes: p.notes,
      completedSessionId: p.completedSessionId,
    };
  });
  const formatProfile: ProfileForFormat = profile
    ? {
        timezone: profile.timezone,
        time_format: profile.time_format ?? null,
        date_format: profile.date_format ?? null,
      }
    : null;
  const eyebrowText = formatEyebrowDate(todayDate, formatProfile);
  const eyebrowLine = (() => {
    if (!activeBlock || !archetypeName) return eyebrowText;
    const week = (computedWeekIndex ?? 0) + 1;
    return `${archetypeName.toUpperCase()} · WEEK ${week} OF ${activeBlock.weeks} · ${eyebrowText}`;
  })();
  const eyebrowLineMobile = (() => {
    if (!activeBlock || !archetypeName) return eyebrowText;
    const week = (computedWeekIndex ?? 0) + 1;
    return `${archetypeName.toUpperCase()} · WEEK ${week} OF ${activeBlock.weeks} · ${eyebrowText}`;
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
              fontSize: 12,
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}
          >
            {activeBlock && archetypeName ? (
              <>
                <span className="cp-desktop-only">
                  <span style={{ color: "var(--cp-accent)" }}>
                    {archetypeName.toUpperCase()}
                  </span>
                  <span style={{ margin: "0 8px", opacity: 0.5 }}>·</span>
                  WEEK {(computedWeekIndex ?? 0) + 1} OF {activeBlock.weeks}
                  <span style={{ margin: "0 8px", opacity: 0.5 }}>·</span>
                  {eyebrowText}
                </span>
                <span className="cp-mobile-only" data-testid="today-eyebrow-mobile">
                  <span style={{ color: "var(--cp-accent)" }}>
                    {archetypeName.toUpperCase()}
                  </span>
                  <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
                  WEEK {(computedWeekIndex ?? 0) + 1} OF {activeBlock.weeks}
                  <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
                  {eyebrowText}
                </span>
              </>
            ) : (
              <>
                <span className="cp-desktop-only">{eyebrowLine}</span>
                <span className="cp-mobile-only">{eyebrowLineMobile}</span>
              </>
            )}
          </div>
          <h1
            style={{
              fontSize: 30,
              margin: "4px 0 0",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              fontWeight: 800,
            }}
          >
            Today
          </h1>
        </header>

        {/* Two-column on wide screens: primary actions in the main
            column, glanceable cards (This week / Recent activity) in the
            right rail. Collapses to a single column ≤768px where the rail
            stacks below the main column. */}
        <div className="today-grid">
          <div className="today-main" style={{ display: "grid", gap: 18, minWidth: 0 }}>
            {raceCheckInProps && <RaceCheckInCard {...raceCheckInProps} />}

            {taperBannerProps && <TaperBanner {...taperBannerProps} />}

            {recoveryBannerProps && <RecoveryBanner {...recoveryBannerProps} />}

            {!hasLoadableMainLift(resolveEquipment(profile)) && tmRows.length === 0 && (
              <BodyweightOnlyBanner
                dismissedAt={profile?.bw_banner_dismissed_at ?? null}
                dismissBwBannerAction={dismissBwBanner}
              />
            )}

            <TmSuggestionBanner
              suggestions={pendingSuggestions}
              acceptAction={acceptTmSuggestion}
              dismissAction={dismissTmSuggestion}
              units={profile?.units === "imperial" ? "imperial" : "metric"}
            />

            <ActiveLimitationsCard
              limitations={activeLimitations}
              adjustedById={limitationSummary.adjustedById}
              pendingCount={limitationSummary.pendingCount}
            />

            {seasonNext ? (
              <NextBlockSuggestionCard
                nudge={{
                  suggestion: {
                    // The card never reads programId (the CTA href is passed
                    // separately); the cast just satisfies the suggestion shape
                    // for season programs outside the ADR-0010 lineup (e.g. HYROX).
                    programId: seasonNext.block.programId as SuggestProgramId,
                    programName: seasonNext.programName,
                    reason:
                      seasonNext.block.intentNote?.trim() ||
                      `It\u2019s the next block in your season \u201C${seasonNext.seasonName}\u201D.`,
                  },
                  realization: endingNudge?.realization ?? null,
                }}
                eyebrow={"Final week \u00b7 next in your season"}
                heading={`Next up: a ${seasonNext.programName} block`}
                suggestionTail={""}
                cta={{
                  href: `/app/program?program=${seasonNext.block.programId}&seasonBlockId=${seasonNext.block.id}`,
                  label: "Start this block",
                }}
                testId="block-ending-nudge-season"
              />
            ) : (
              endingNudge && (endingNudge.suggestion || endingNudge.realization) && (
                <NextBlockSuggestionCard
                  nudge={endingNudge}
                  eyebrow={"Final week \u00b7 what\u2019s next"}
                  cta={{
                    href: endingNudge.suggestion
                      ? `/app/program?program=${endingNudge.suggestion.programId}`
                      : "/app/program",
                    label: "Plan your next block",
                  }}
                  testId="block-ending-nudge"
                />
              )
            )}


            <TodaySessionCard
              openSession={openSession}
              completedToday={completedToday}
              plannedToday={plannedToday}
              isMultiSessionDay={isMultiSessionDay}
              isTwoADay={isTwoADay}
              timezone={timezone}
              amWindowStart={amWindowStart}
              pmWindowStart={pmWindowStart}
              conflictsBySlot={conflictsBySlot}
              nextUpcoming={upcoming[0] ?? null}
              formatProfile={formatProfile}
              programRecs={programRecs}
            />

            <QuickWorkoutCard
              variant={isRestDay ? "rest" : "planned"}
              recent={quickRepeatRecent}
              startStrength={startQuickStrengthSession}
              repeatRecent={repeatRecentSession}
              generateStrength={generateQuickStrengthSession}
              generateHyrox={generateQuickHyroxSession}
              hyroxStationDefaults={hyroxStationDefaults}
            />
          </div>

          <aside
            className="today-rail"
            aria-label="At a glance"
            style={{ display: "grid", gap: 14, minWidth: 0 }}
          >
            <div data-testid="today-week-strip">
              <ThisWeekRail
                sessions={weekRailSessions}
                today={todayIso}
                currentWeekIndex={computedWeekIndex ?? -1}
                weeks={activeBlock?.weeks ?? 1}
                logHrefBase="/app/sessions/start"
                moveAction={movePlannedSession}
                skipAction={skipPlannedSession}
                unskipAction={unskipPlannedSession}
                updateNotesAction={updatePlannedSessionNotes}
                startSessionAction={startSessionFromPlan}
                markCardioDoneAction={markExternalCardioComplete}
              />
            </div>

            <ActivitySection sessions={recent ?? []} todayIso={todayIso} />
          </aside>
        </div>
    </div>
  );
}

/**
 * Recent activity grouped by Today / Yesterday / Earlier. Replaces the
 * original flat list — same row structure, just bucketed.
 */
function ActivityPill({ label, mono }: { label: string; mono?: boolean }) {
  return (
    <span
      className={mono ? "mono" : undefined}
      style={{
        fontSize: 11,
        color: "var(--cp-text-muted)",
        background: "var(--cp-surface-soft)",
        border: "1px solid var(--cp-border)",
        borderRadius: 7,
        padding: "3px 8px",
      }}
    >
      {label}
    </span>
  );
}

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
          body="Sessions you log appear here, grouped by date."
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
            {g.items.map((s) => {
              const complete = !!s.completed_at;
              return (
                <Link
                  key={s.id}
                  href={`/app/sessions/${s.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "var(--cp-surface)",
                    border: "1px solid var(--cp-border)",
                    borderRadius: 11,
                    padding: "11px 13px",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flex: "0 0 auto",
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 13,
                      background: complete
                        ? "var(--cp-accent-soft)"
                        : "color-mix(in srgb, var(--cp-warning) 16%, transparent)",
                      color: complete ? "var(--cp-accent)" : "var(--cp-warning)",
                    }}
                  >
                    {complete ? "✓" : "◷"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.title ?? "Untitled session"}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        marginTop: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      {!complete && <ActivityPill label="in progress" />}
                      {s.session_rpe != null && (
                        <ActivityPill label={`Effort ${s.session_rpe}`} mono />
                      )}
                      {s.duration_min != null && (
                        <ActivityPill label={`${s.duration_min} min`} mono />
                      )}
                    </div>
                  </div>
                  <span style={{ color: "var(--cp-text-muted)", fontSize: 16 }} aria-hidden>›</span>
                </Link>
              );
            })}
          </div>
        ))}
    </section>
  );
}

function TodaySessionCard({
  openSession,
  completedToday,
  plannedToday,
  isMultiSessionDay,
  isTwoADay,
  timezone,
  amWindowStart,
  pmWindowStart,
  conflictsBySlot,
  nextUpcoming,
  formatProfile,
  programRecs,
}: {
  openSession: { id: string; title: string | null } | null;
  completedToday: { id: string; title: string | null }[];
  plannedToday: PlannedDay[];
  isMultiSessionDay: boolean;
  isTwoADay: boolean;
  timezone: string;
  amWindowStart: string;
  pmWindowStart: string;
  conflictsBySlot: Map<string, FreshnessConflict>;
  nextUpcoming: PlannedDay | null;
  formatProfile: ProfileForFormat;
  programRecs: PendingProgramRecommendation[];
}) {
  // Platform programs: program-owned nudges (retest maxes, next block, 7th-week
  // verdict). Informational; dismiss-only. No-op for archetype blocks.
  const programRecsBanner = (
    <ProgramRecommendationsBanner recommendations={programRecs} dismissAction={dismissProgramRecommendation} />
  );
  const actionableToday = actionablePlannedSessions(plannedToday);
  if (openSession) {
    return (
      <>
        {programRecsBanner}
        <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Resume today&apos;s workout
          </div>
          <h2 style={{ fontSize: 22, margin: 0 }}>{openSession.title ?? "In-progress session"}</h2>
          <p style={{ color: "var(--cp-text-muted)", margin: 0, fontSize: 14 }}>
            You started this earlier today. Pick up where you left off.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href={`/app/sessions/${openSession.id}`} className="cp-btn primary big">
              ⚡ Resume workout
            </Link>
          </div>
        </section>
      </>
    );
  }

  if (isTodayFullyLogged({ completedTodayCount: completedToday.length, plannedToday })) {
    // Every planned slot for today is actually completed (linked or logged).
    // NB: we check per-session completion, not a count comparison — an extra
    // standalone activity (e.g. an extra easy run logged on a day that
    // also has a prescribed session) must NOT mask a still-pending planned
    // session. It surfaces under "Recent activity"; the planned card stays.
    return (
      <>
        {programRecsBanner}
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
      </>
    );
  }

  if (actionableToday.length === 0) {
    if (plannedToday.length > 0) {
      return (
        <>
          {programRecsBanner}
          <section
            className="cp-card"
            data-testid="today-settled"
            style={{ padding: 20, display: "grid", gap: 10 }}
          >
            <div
              style={{
                fontSize: 11,
                color: "var(--cp-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Today&apos;s plan
            </div>
            <h2 style={{ fontSize: 22, margin: 0 }}>
              No remaining workouts
            </h2>
            <p
              style={{
                color: "var(--cp-text-muted)",
                margin: 0,
                fontSize: 14,
              }}
            >
              Today&apos;s planned sessions are completed or skipped.
            </p>
          </section>
        </>
      );
    }
    // Compact 1-row rest banner. Replaces the older Why-rest-day card.
    return (
      <>
        {programRecsBanner}
        <section
          data-testid="today-rest"
          className="cp-card--bracket"
          style={{
            display: "grid",
            gap: 14,
            padding: "18px 20px",
            background:
              "linear-gradient(180deg, var(--cp-bg-elevated), var(--cp-surface))",
            border: "1px solid var(--cp-border)",
            borderRadius: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                flex: "0 0 auto",
                width: 38,
                height: 38,
                borderRadius: 9,
                display: "grid",
                placeItems: "center",
                background: "var(--cp-accent-soft)",
                color: "var(--cp-accent)",
              }}
            >
              <svg
                width={20}
                height={20}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            </span>
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>
                Rest day
              </div>
              <div style={{ fontSize: 12.5, color: "var(--cp-text-muted)" }}>
                Recovery is where the adaptation happens. Nothing scheduled today.
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              padding: "12px 14px",
              background: "var(--cp-surface)",
              border: "1px solid var(--cp-border)",
              borderRadius: 12,
              flexWrap: "wrap",
            }}
          >
            {nextUpcoming ? (
              <div data-testid="rest-tomorrow" style={{ display: "grid", gap: 3, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "var(--cp-text-muted)",
                    fontWeight: 700,
                  }}
                >
                  Next session
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{nextUpcoming.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--cp-text-muted)" }}>
                  {formatUpcomingDay(nextUpcoming.date, formatProfile)}
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "var(--cp-text-muted)",
                    fontWeight: 700,
                  }}
                >
                  Next session
                </div>
                <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
                  Nothing on the schedule.
                </div>
              </div>
            )}
            <Link
              href="/app/plan"
              style={{
                flex: "0 0 auto",
                display: "inline-flex",
                alignItems: "center",
                minHeight: 44,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--cp-text)",
                textDecoration: "none",
                padding: "0 16px",
                border: "1px solid var(--cp-border-strong)",
                borderRadius: 10,
                whiteSpace: "nowrap",
              }}
            >
              View plan →
            </Link>
          </div>
        </section>
      </>
    );
  }

  // 1 or 2 planned sessions today. Resolve effective times for the PM-next
  // hint when the first session has already been completed.
  const slotTimes = new Map<string, string>();
  for (const p of actionableToday) {
    const t = effectiveTimeOfDay({
      slot: p.slot,
      plannedAt: p.plannedAt,
      amWindowStart,
      pmWindowStart,
      timezone,
    });
    if (t) slotTimes.set(p.slot, t);
  }
  // Genuine two-a-days stay AM → PM. Mixed same-day rows (such as a primary
  // session plus adjunct rehab) lead with the primary `single` session.
  const orderedPlannedToday = orderPlannedSessionsForToday(
    actionableToday,
    isTwoADay,
  );

  // PM-next hint (B2). When the AM slot is logged and PM remains, show
  // a ~Xh count-down above the PM card. Computed from the PM slot time
  // minus now-in-user-timezone — falls back to "PM session next" when
  // we can't resolve a clock time.
  const completedAmSlot = isTwoADay
    ? plannedToday.find((p) => p.slot === "am" && p.completedAt != null)
    : null;
  const openPmSlot = completedAmSlot
    ? actionableToday.find((p) => p.slot === "pm" && p.completedAt == null)
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
      {programRecsBanner}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMultiSessionDay
            ? "repeat(auto-fit, minmax(300px, 1fr))"
            : "1fr",
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
                isMultiSessionDay={isMultiSessionDay}
                isTwoADay={isTwoADay}
                timeOfDay={slotTimes.get(p.slot) ?? null}
                conflict={conflictsBySlot.get(p.id) ?? null}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlannedSessionCard({
  planned,
  isMultiSessionDay,
  isTwoADay,
  timeOfDay,
  conflict,
}: {
  planned: PlannedDay;
  isMultiSessionDay: boolean;
  isTwoADay: boolean;
  timeOfDay: string | null;
  conflict: FreshnessConflict | null;
}) {
  const slotLabel =
    planned.slot === "am" ? "Morning" : planned.slot === "pm" ? "Evening" : "Today's session";

  // Glanceable hero metrics derive from the same movement grouping as the
  // compact preview, so role counts and section contents cannot drift apart.
  const duration = estimateSessionDurationBreakdown(planned.prescription.items);
  const estMin = duration.displayMinutes;
  const grouped = groupByMovementThenKind(planned.prescription.items);
  const mainLiftCount = grouped.movements.filter(
    (section) => !isSupplementalOnlySection(section),
  ).length;
  const supplementalLiftCount = grouped.movements.filter(
    isSupplementalOnlySection,
  ).length;
  const accessoryCount =
    grouped.accessories.length +
    grouped.hingeCompensations.length +
    grouped.tendon.length;
  const rehabMovementCount = grouped.rehab.length;
  const movementSummary =
    planned.role === "rehab" && rehabMovementCount > 0
      ? `${rehabMovementCount} rehab movement${
          rehabMovementCount === 1 ? "" : "s"
        }`
      : [
          mainLiftCount > 0
            ? `${mainLiftCount} main lift${mainLiftCount === 1 ? "" : "s"}`
            : null,
          supplementalLiftCount > 0
            ? `${supplementalLiftCount} supplemental lift${
                supplementalLiftCount === 1 ? "" : "s"
              }`
            : null,
          accessoryCount > 0
            ? `${accessoryCount} accessor${accessoryCount === 1 ? "y" : "ies"}`
            : null,
        ]
          .filter((part): part is string => part != null)
          .join(", ");
  const showMetaRow =
    (isTwoADay && planned.slot !== "single") ||
    planned.completedAt != null ||
    estMin != null;
  const primaryCta = plannedSessionCta({
    plannedId: planned.id,
    completedSessionId: planned.completedSessionId,
    completedAt: planned.completedAt,
    deletedCompletedSessionId: planned.deletedCompletedSessionId,
  });

  return (
    <section
      className="cp-card"
      data-testid={`today-card-${planned.id}`}
      data-hero="planned"
      style={{
        position: "relative",
        overflow: "hidden",
        padding: 18,
        display: "grid",
        gap: 12,
        borderColor: "var(--cp-border)",
        background:
          "linear-gradient(165deg, var(--cp-bg-elevated), var(--cp-surface))",
        minHeight: isMultiSessionDay ? 200 : 280,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: "0 0 auto 0",
          height: 3,
          background:
            "linear-gradient(90deg, var(--cp-accent), transparent 70%)",
          opacity: 0.8,
        }}
      />
      {showMetaRow && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
        {isTwoADay && planned.slot !== "single" && (
          <span
            data-testid={`slot-label-${planned.slot}`}
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "4px 9px",
              borderRadius: 999,
              color: "var(--cp-text-muted)",
              background: "var(--cp-surface-soft)",
              border: "1px solid var(--cp-border)",
            }}
          >
            {slotLabel}
            {timeOfDay ? ` · ${timeOfDay}` : ""}
          </span>
        )}
        {planned.completedAt && (
          <span
            data-testid="slot-complete-badge"
            style={{
              fontSize: 10,
              padding: "2px 7px",
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
        {estMin != null && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              color: "var(--cp-text-muted)",
            }}
          >
            ~{estMin} min
          </span>
        )}
        </div>
      )}
      <h2 style={{ fontSize: 26, margin: 0, letterSpacing: "-0.02em", fontWeight: 700 }}>{planned.title}</h2>
      {(movementSummary || rehabMovementCount > 0) && (
        <div
          data-testid="hero-topline"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 12.5,
              color: "var(--cp-text-soft)",
              background: "var(--cp-surface)",
              border: "1px solid var(--cp-border)",
              borderRadius: 9,
              padding: "6px 11px",
            }}
          >
            {movementSummary}
          </span>
          {planned.role !== "rehab" && rehabMovementCount > 0 && (
            <span
              data-testid="embedded-rehab-badge"
              style={{
                fontSize: 12.5,
                color: "var(--cp-accent)",
                background: "var(--cp-accent-soft)",
                border: "1px solid var(--cp-accent)",
                borderRadius: 9,
                padding: "6px 11px",
                fontWeight: 650,
              }}
            >
              Includes rehab · {rehabMovementCount} movement
              {rehabMovementCount === 1 ? "" : "s"}
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
          title={`${conflict.regionLabel} freshness ${(conflict.freshness * 100).toFixed(0)}% — still recovering from recent load`}
        >
          <span aria-hidden style={{ fontSize: 14 }}>⚠</span>
          <span>
            <strong>{conflict.regionLabel}</strong> still recovering. Heavy {conflict.movementName} may need a lighter top set or a substitution.
          </span>
        </div>
      )}
      <div data-testid="today-hero-preview" style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
        <SessionPreviewBody
          variant="compact"
          session={{
            id: planned.id,
            title: planned.title,
            // Eyebrow + duration are rendered by the hero card itself
            // (slot label / archetype / week badge above, structured
            // duration rows inside the section cards). The compact
            // variant of SessionPreviewBody skips its own header, so
            // these strings are unused — pass placeholders.
            eyebrow: "",
            estDurationMin: null,
            items: planned.prescription.items,
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: "auto" }}>
        <Link
          href={primaryCta.href}
          className="cp-btn primary big"
          data-testid="today-cta"
          data-session-state={primaryCta.state}
          style={{ flex: "1 1 auto", minHeight: 56 }}
        >
          {primaryCta.label}
        </Link>
        {/*
          Preview opens the SAME drawer the "This week" rail uses, rather than a
          second, near-identical read-only preview screen. The rail listens for
          `#session=<plannedId>` (see ThisWeekRail's hashchange effect) and finds
          the session across ALL planned days, not just the rendered week, so a
          plain hash anchor is enough — and it stays a real, keyboard-focusable
          link. Next's <Link> is deliberately avoided here: a client-side
          pushState navigation would not fire `hashchange`.
        */}
        <a
          href={`#session=${planned.id}`}
          className="cp-btn big"
          data-testid="today-preview-cta"
          style={{ flex: "0 1 auto", minHeight: 56, justifyContent: "center" }}
        >
          Preview
        </a>
      </div>
    </section>
  );
}


function formatUpcomingDay(iso: string, profile: ProfileForFormat): string {
  const target = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return iso;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 1) return "Tomorrow";
  if (diffDays >= 2 && diffDays <= 6) {
    return target.toLocaleDateString(undefined, { weekday: "long" });
  }
  return formatDate(target, profile, "short_date");
}
