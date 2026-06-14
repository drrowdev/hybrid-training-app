import Link from "next/link";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  roundToPlate,
} from "@/lib/planner/archetypes";
import {
  archetypeDisplayName,
  getActiveBlock,
  getPlannedDays,
  getRecentBlocks,
  getTodayPlannedSessions,
  getUpcomingPlannedSessions,
  type PlannedDay,
} from "@/lib/planner/queries";
import { summariseOverdue } from "@/lib/planner/overdue";
import { getTrainingMaxDict } from "@/lib/training-maxes/queries";
import { todayYmd } from "@/lib/dates";
import { effectiveTimeOfDay, gapHoursBetween } from "@/lib/planner/time-of-day";
import { getRegionFreshness, type FreshnessConflict } from "@/lib/stats/region-freshness-queries";
import { getRegionSpikes } from "@/lib/stats/region-spike-queries";
import { getMuscleFreshness } from "@/lib/muscle/muscle-freshness";
import { findHeavyOnRecoveringConflictWithMuscles } from "@/lib/muscle/muscle-conflict";
import { StravaStaleSyncTrigger } from "@/components/StravaStaleSyncTrigger";
import { StravaSyncPill } from "@/components/shell/StravaSyncPill";
import { BodyweightOnlyBanner } from "@/components/banners/BodyweightOnlyBanner";
import { dismissBwBanner } from "@/lib/profile/actions";
import { OverdueNotice } from "@/components/today/OverdueNotice";
import { RegionSpikeBanner } from "@/components/today/RegionSpikeBanner";
import { ProgramRecommendationsBanner } from "@/components/today/ProgramRecommendationsBanner";
import { getPendingProgramRecommendations, type PendingProgramRecommendation } from "@/lib/platform/recommendations-queries";
import { dismissProgramRecommendation } from "@/lib/platform/actions";
import { SessionPreviewBody } from "@/components/session/SessionPreviewBody";
import { QuickWorkoutCard } from "@/components/today/QuickWorkoutCard";
import {
  startQuickStrengthSession,
  repeatRecentSession,
  generateQuickStrengthSession,
  updatePlannedSessionNotes,
} from "@/lib/sessions/actions";
import { getQuickRepeatCandidates } from "@/lib/sessions/queries";
import { getLimitationTodaySummary } from "@/lib/limitations/today-summary";
import { getNextBlockNudge } from "@/lib/planner/next-block-suggestion-server";
import { NextBlockSuggestionCard } from "@/components/planner/NextBlockSuggestionCard";
import type { SuggestProgramId } from "@/lib/planner/next-block-suggestion";
import { KNOWN_SUGGEST_PROGRAMS } from "@/lib/planner/next-block-suggestion";
import {
  ActiveLimitationsCard,
  type ActiveLimitationSummary,
} from "@/components/today/ActiveLimitationsCard";
import type { RegionSpike } from "@/lib/engine/region-spike-detector";
import {
  hasLoadableMainLift,
  resolveEquipment,
} from "@/lib/settings/equipment-presets";
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
import type { TmFormula, TmSource } from "@hta/db";
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
import { estimateSessionMinutes } from "@/lib/sessions/estimate-duration";
import { ThisWeekRail } from "@/components/plan/ThisWeekRail";
import type { PlanSessionInput } from "@/components/plan/PlanRedesign";
import { hasAiAccess } from "@/lib/ai/access";
import { AskWhyButton } from "@/components/session/AskWhyButton";
import { askWhySessionId } from "@/lib/sessions/ask-why";

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
  } = await getAuthUser();
  const userId = user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, timezone, am_window_start, pm_window_start, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, time_format, date_format, bw_nudge_hidden_until, bw_banner_dismissed_at, byoai_provider, byoai_key_vault_id, byoai_unlocked_at, units",
    )
    .eq("id", userId)
    .maybeSingle();

  const aiAccess = hasAiAccess({
    byoai_provider: profile?.byoai_provider ?? null,
    byoai_key_vault_id: profile?.byoai_key_vault_id ?? null,
    byoai_unlocked_at: profile?.byoai_unlocked_at ?? null,
  });

  const todayIso = todayYmd(profile?.timezone ?? "UTC");

  const [{ data: todaySessions }, { data: recent }, plannedToday, upcoming, freshness, activeBlock, tmDict, tmRows, regionSpikes, { data: activeLimitationsRaw }, quickRepeatRecent, limitationSummary, programRecs] = await Promise.all([
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
    getRegionSpikes(supabase, userId, profile?.timezone ?? "UTC"),
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

  // Audit F16 fix — the seven blocks that follow used to await one
  // after another (~6 stages, dominating the 2s TTFB). They are
  // mutually independent given the inputs already resolved by the
  // first Promise.all above, so resolve them in one outer Promise.all
  // of async IIFEs. The post-fetch in-memory work (tm-meta assembly,
  // conflict computation, week-strip bucketing) still runs serially
  // after the Promise.all since it consumes results from multiple
  // groups.
  const plannedMovementIds = Array.from(
    new Set(plannedToday.flatMap((p) => p.prescription.items.map((i) => i.movementId))),
  );
  const [
    sessionPerformedAt,
    pendingSuggestions,
    stravaConn,
    nextEvent,
    { movementRegionById, movementSlugById },
    muscleFreshnessRows,
  ] = await Promise.all([
    // Group A — derived-session timestamps used by the TM hero topline
    // annotation. Depends on tmRows (already resolved).
    (async (): Promise<Map<string, string>> => {
      const map = new Map<string, string>();
      if (derivedSessionIds.length === 0) return map;
      const { data: derivedSessions } = await supabase
        .from("sessions")
        .select("id, performed_at")
        .in("id", derivedSessionIds);
      for (const s of derivedSessions ?? []) {
        map.set(s.id, s.performed_at);
      }
      return map;
    })(),

    // Group B — pending TM suggestions + their joined source set /
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

    // Group C — Strava connection presence + last sync timestamp.
    supabase
      .from("strava_connections")
      .select("user_id, last_synced_at")
      .eq("user_id", userId)
      .maybeSingle()
      .then((r) => r.data),

    // Group D — next priority event (drives the taper recommendation).
    supabase
      .from("priority_events")
      .select("id, name, event_date, priority, modality, target_performance, result")
      .eq("user_id", userId)
      .gte("event_date", todayIso)
      .order("event_date", { ascending: true })
      .limit(1)
      .maybeSingle()
      .then((r) => r.data),

    // Group E — region / slug maps for the planned movements today
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

    // Group F — muscle-level freshness (PR feat/muscle-grid-16).
    getMuscleFreshness(supabase, userId, { tz: profile?.timezone ?? "UTC" }),
  ]);

  const hasStravaConnection = Boolean(stravaConn);
  const lastSyncedAt =
    ((stravaConn as { last_synced_at: string | null } | null)
      ?.last_synced_at ?? null) as string | null;
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
  const isTwoADay = plannedToday.length > 1;
  const timezone = profile?.timezone ?? "UTC";
  const amWindowStart = profile?.am_window_start ?? "07:00:00";
  const pmWindowStart = profile?.pm_window_start ?? "17:00:00";

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

  // Today is a single-column layout — the right rail (Training Maxes
  // summary) was retired with the shell refresh; TM details live on
  // /app/profile and /app/settings/training-maxes now.
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
  const overdueSummary = activeBlock
    ? summariseOverdue(plannedDaysAll, todayIso)
    : { count: 0, oldestDate: null, items: [] };
  // "This week" rail sessions — built in the same PlanSessionInput shape
  // the /app/plan page uses so the Today rail reuses the shared rail +
  // drawer (single source of truth; see components/plan/ThisWeekRail).
  const weekRailSessions: PlanSessionInput[] = plannedDaysAll.map((p) => {
    const items = p.prescription?.items ?? [];
    const isCardio =
      items.length > 0 && items.every((i) => (i.kind ?? "").startsWith("cardio_"));
    const hasStrengthItems = items.some((i) => !(i.kind ?? "").startsWith("cardio_"));
    return {
      id: p.id,
      weekIndex: p.weekIndex,
      dayIndex: p.dayIndex,
      date: p.date,
      title: p.title,
      isCardio,
      isStrength: hasStrengthItems,
      done: p.completedAt != null,
      inProgress: !!p.completedSessionId && p.completedAt == null,
      skipped: !!p.skippedAt,
      slot: p.slot,
      items,
      estDurationMin: estimateSessionMinutes(items),
      notes: p.notes,
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
    return `${archetypeName.toUpperCase()} · WEEK ${week} · ${eyebrowText}`;
  })();
  const eyebrowLineMobile = (() => {
    if (!activeBlock || !archetypeName) return eyebrowText;
    const week = (computedWeekIndex ?? 0) + 1;
    return `${archetypeName.toUpperCase()} · W${week} · ${eyebrowText}`;
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
              fontFamily: "var(--cp-font-mono)",
              fontSize: 11,
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontWeight: 500,
            }}
          >
            {activeBlock && archetypeName ? (
              <>
                <span className="cp-desktop-only">
                  <span style={{ color: "var(--cp-accent)" }}>
                    {archetypeName.toUpperCase()}
                  </span>
                  <span style={{ margin: "0 8px", opacity: 0.5 }}>·</span>
                  WEEK {(computedWeekIndex ?? 0) + 1}
                  <span style={{ margin: "0 8px", opacity: 0.5 }}>·</span>
                  {eyebrowText}
                </span>
                <span className="cp-mobile-only" data-testid="today-eyebrow-mobile">
                  <span style={{ color: "var(--cp-accent)" }}>
                    {archetypeName.toUpperCase()}
                  </span>
                  <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
                  W{(computedWeekIndex ?? 0) + 1}
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 4,
            }}
          >
            <h1
              style={{
                fontFamily: "var(--cp-font-display)",
                fontSize: 36,
                margin: 0,
                letterSpacing: "0.01em",
                textTransform: "uppercase",
                lineHeight: 1.05,
                fontWeight: 600,
              }}
            >
              Today
            </h1>
            <StravaSyncPill
              hasStravaConnection={hasStravaConnection}
              lastSyncedAt={lastSyncedAt}
              variant="inline"
            />
          </div>
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

            {endingNudge && (endingNudge.suggestion || endingNudge.realization) && (
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
            )}


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
              blockWeeks={activeBlock?.weeks ?? null}
              tmById={tmById}
              tmMetaByMovementId={tmMetaByMovementId}
              nextUpcoming={upcoming[0] ?? null}
              formatProfile={formatProfile}
              overdueCount={overdueSummary.count}
              regionSpikes={regionSpikes}
              programRecs={programRecs}
              aiAccess={aiAccess}
            />

            <QuickWorkoutCard
              variant={isRestDay ? "rest" : "planned"}
              recent={quickRepeatRecent}
              startStrength={startQuickStrengthSession}
              repeatRecent={repeatRecentSession}
              generateStrength={generateQuickStrengthSession}
            />

            {hasStravaConnection && <StravaStaleSyncTrigger />}
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
        fontSize: 10.5,
        color: "var(--cp-text-muted)",
        background: "var(--cp-surface-soft)",
        border: "1px solid var(--cp-border)",
        borderRadius: 7,
        padding: "2px 7px",
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
  isTwoADay,
  timezone,
  amWindowStart,
  pmWindowStart,
  conflictsBySlot,
  archetypeName,
  weekIndex,
  blockWeeks,
  tmById,
  tmMetaByMovementId,
  nextUpcoming,
  formatProfile,
  overdueCount,
  regionSpikes,
  programRecs,
  aiAccess,
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
  blockWeeks: number | null;
  tmById: Record<string, number>;
  tmMetaByMovementId: Record<string, {
    source: TmSource;
    formula: TmFormula | null;
    derivedAt: string | null;
    derivedFromSessionId: string | null;
    derivedFromSessionPerformedAt: string | null;
  }>;
  nextUpcoming: PlannedDay | null;
  formatProfile: ProfileForFormat;
  overdueCount: number;
  regionSpikes: ReadonlyArray<RegionSpike>;
  programRecs: PendingProgramRecommendation[];
  aiAccess: boolean;
}) {
  // Secondary, non-blocking notice rendered above the day's primary
  // card whenever the user has past-incomplete planned sessions sitting
  // in limbo. We never auto-open these — the user reviews them on
  // /app/plan, where the inline one-tap "Mark skipped" / "Log now"
  // CTAs live.
  const overdueNotice = <OverdueNotice count={overdueCount} />;
  // Soft, read-only warning when one or more body regions are >25%
  // above the user's own 4-week ATL baseline. Rendered below the
  // overdue notice and above the day's primary card. Does not gate
  // any prescription or planner action — purely informational.
  const spikeBanner = <RegionSpikeBanner spikes={regionSpikes} />;
  // Platform programs: program-owned nudges (retest maxes, next block, 7th-week
  // verdict). Informational; dismiss-only. No-op for archetype blocks.
  const programRecsBanner = (
    <ProgramRecommendationsBanner recommendations={programRecs} dismissAction={dismissProgramRecommendation} />
  );
  if (openSession) {
    return (
      <>
        {overdueNotice}
        {spikeBanner}
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

  if (completedToday.length > 0 && plannedToday.length <= completedToday.length) {
    // All planned slots for today are logged.
    return (
      <>
        {overdueNotice}
        {spikeBanner}
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

  if (plannedToday.length === 0) {
    // Compact 1-row rest banner. Replaces the older Why-rest-day card.
    // The next-session preview pulls top-set numbers from the same
    // prescription + TM math the hero uses so the line reads identically.
    const nextTopLine = nextUpcoming ? topSetLine(nextUpcoming, tmById) : null;
    return (
      <>
        {overdueNotice}
        {spikeBanner}
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
                    fontSize: 10.5,
                    letterSpacing: "0.12em",
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
                  {nextTopLine && (
                    <>
                      {" · "}
                      <span style={{ color: "var(--cp-accent)" }}>{nextTopLine}</span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 10.5,
                    letterSpacing: "0.12em",
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
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--cp-text)",
                textDecoration: "none",
                padding: "7px 12px",
                border: "1px solid var(--cp-border-strong)",
                borderRadius: 9,
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
        const aDone = a.completedAt != null ? 1 : 0;
        const bDone = b.completedAt != null ? 1 : 0;
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
    ? plannedToday.find((p) => p.slot === "am" && p.completedAt != null)
    : null;
  const openPmSlot = completedAmSlot
    ? plannedToday.find((p) => p.slot === "pm" && p.completedAt == null)
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
      {overdueNotice}
      {spikeBanner}
      {programRecsBanner}
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
                blockWeeks={blockWeeks}
                tmById={tmById}
                tmMetaByMovementId={tmMetaByMovementId}
                aiAccess={aiAccess}
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
  isTwoADay,
  timeOfDay,
  conflict,
  archetypeName,
  weekIndex,
  blockWeeks,
  tmById,
  tmMetaByMovementId,
  aiAccess,
}: {
  planned: PlannedDay;
  isTwoADay: boolean;
  timeOfDay: string | null;
  conflict: FreshnessConflict | null;
  archetypeName: string | null;
  weekIndex: number | null;
  blockWeeks: number | null;
  tmById: Record<string, number>;
  tmMetaByMovementId: Record<string, {
    source: TmSource;
    formula: TmFormula | null;
    derivedAt: string | null;
    derivedFromSessionId: string | null;
    derivedFromSessionPerformedAt: string | null;
  }>;
  aiAccess: boolean;
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

  // Glanceable hero metrics (redesign): estimated duration + the number of
  // distinct movements the user will train. Both derive from the same
  // prescription the preview body renders, so they never disagree with it.
  const estMin = estimateSessionMinutes(planned.prescription.items);
  const movementCount = new Set(
    planned.prescription.items
      .filter((i) => i.kind !== "warmup")
      .map((i) => i.movementId)
      .filter((m): m is string => !!m),
  ).size;
  const weekLabel =
    weekIndex != null
      ? blockWeeks != null
        ? `Week ${weekIndex + 1} of ${blockWeeks}`
        : `Week ${weekIndex + 1}`
      : null;

  // (Hero topline used to compute an `estMin` rough duration here; it
  // was dropped now that SessionPreviewBody renders structured per-
  // section duration rows. See block comment above.)

  // Movement names + accessory tally are rendered by
  // `<SessionPreviewBody variant="compact">` below, which is the same
  // component the Preview page uses — so the two surfaces stay in
  // sync by construction. In the compact variant strength movements
  // are condensed to one overview row each (name + working-set/top-set
  // summary) so a multi-lift day doesn't balloon the hero with every
  // warm-up + working set; cardio keeps its full structured card. The
  // "Preview" CTA drills into the full set-by-set breakdown on the
  // Preview page. The older inline chip block lived here too and
  // double-counted everything that wasn't `main`/`back_off` —
  // including cardio + warm-ups + tendon — which produced a spurious
  // "+ 1 assistance" pill on cardio-only sessions that have zero
  // user-visible accessories. Removed; the preview body is now the
  // single source of truth for "what am I about to do".

  // Hero topline no longer renders the rough `~N min` duration — the
  // structured preview body below shows per-section duration rows
  // (CardioCard's "Duration" cell, strength sets, etc), so the
  // standalone topline number was duplicate noise. Top-set + e1RM
  // annotation stay because they are not surfaced anywhere in the
  // preview body.

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
        minHeight: isTwoADay ? 200 : 280,
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {archetypeName && (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "4px 9px",
              borderRadius: 999,
              color: "var(--cp-accent)",
              background: "var(--cp-accent-soft)",
            }}
          >
            {archetypeName}
          </span>
        )}
        {weekLabel && (
          <span
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
            {weekLabel}
          </span>
        )}
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
        {!archetypeName && !weekLabel && !(isTwoADay && planned.slot !== "single") && (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--cp-accent)",
            }}
          >
            {slotLabel}
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
            className="mono"
            style={{
              marginLeft: "auto",
              fontSize: 11.5,
              color: "var(--cp-text-muted)",
            }}
          >
            ~{estMin} min
          </span>
        )}
      </div>
      <h2 style={{ fontSize: 26, margin: 0, letterSpacing: "-0.02em", fontWeight: 700 }}>{planned.title}</h2>
      {(topLine || movementCount > 0) && (
        <div
          data-testid="hero-topline"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
          }}
        >
          {topLine && (
            <span
              className="mono"
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--cp-accent)",
                background: "var(--cp-accent-soft)",
                border:
                  "1px solid color-mix(in srgb, var(--cp-accent) 30%, var(--cp-border))",
                borderRadius: 9,
                padding: "6px 11px",
              }}
            >
              {topLine}
            </span>
          )}
          {movementCount > 0 && (
            <span
              className="mono"
              style={{
                fontSize: 12.5,
                color: "var(--cp-text-soft)",
                background: "var(--cp-surface)",
                border: "1px solid var(--cp-border)",
                borderRadius: 9,
                padding: "6px 11px",
              }}
            >
              {movementCount} movement{movementCount === 1 ? "" : "s"}
            </span>
          )}
          {topLineAnnotation && (
            <span
              data-testid="hero-topline-e1rm-annotation"
              style={{
                color: "var(--cp-text-muted)",
                fontSize: 12,
                fontWeight: 500,
                fontStyle: "italic",
              }}
            >
              {topLineAnnotation}
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
        {planned.completedSessionId ? (
          <Link
            href={`/app/sessions/${planned.completedSessionId}`}
            className="cp-btn primary big"
            data-testid="today-cta"
            style={{ flex: "1 1 auto", minHeight: 56 }}
          >
            Continue workout →
          </Link>
        ) : (
          <Link
            href={`/app/sessions/start/${planned.id}`}
            className="cp-btn primary big"
            data-testid="today-cta"
            style={{ flex: "1 1 auto", minHeight: 56 }}
          >
            Start workout →
          </Link>
        )}
        <Link
          href={`/app/plan/preview/${planned.id}`}
          className="cp-btn big"
          data-testid="today-preview-cta"
          style={{ flex: "0 1 auto", minHeight: 56, justifyContent: "center" }}
        >
          Preview
        </Link>
        {aiAccess ? (
          <AskWhyButton sessionId={askWhySessionId(planned)} />
        ) : (
          <AskWhyButton href="/app/settings/ai" />
        )}
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
