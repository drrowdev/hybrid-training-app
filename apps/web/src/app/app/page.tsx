import { selectTodayPrompt } from "@hta/domain";
import { TodayDashboard, type TodayWorkout } from "@/components/today/TodayDashboard";
import { loadTodaySwims, loadTodaySessionSummaries, loadTodayWeek, plannedTodayWorkout } from "@/lib/today/workouts";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  archetypeDisplayName,
  getActiveBlocks,
  getActivePlannedDays,
  getRecentBlocks,
  getTodayPlannedSessions,
} from "@/lib/planner/queries";
import { addDaysToYmd, todayYmd, ymdToUtc } from "@/lib/dates";
import { hasTwoADaySlotPair } from "@/lib/planner/slot";
import { FRESHNESS_REGION_LABELS, getRegionFreshness, type FreshnessConflict } from "@/lib/stats/region-freshness-queries";
import { getMuscleFreshness } from "@/lib/muscle/muscle-freshness";
import { findHeavyOnRecoveringConflictWithMuscles } from "@/lib/muscle/muscle-conflict";
import { BodyweightOnlyBanner } from "@/components/banners/BodyweightOnlyBanner";
import { dismissBwBanner, dismissBwNudge } from "@/lib/profile/actions";
import { BodyweightNudge } from "@/components/today/BodyweightNudge";
import { recordDailyCheckIn } from "@/lib/wellness/actions";
import { attributeLimitation, buildLimitationResponse } from "@/lib/limitations/response";
import { MUSCLE_FROM_DB_ENUM, MUSCLE_LABELS } from "@/lib/muscle/muscle-groups";
import { deriveLimitationsContext } from "@/lib/planner/limitations-context";
import { loadPickerCatalog } from "@/lib/planner/picker-catalog";
import { ProgramRecommendationsBanner } from "@/components/today/ProgramRecommendationsBanner";
import { getPendingProgramRecommendations } from "@/lib/platform/recommendations-queries";
import { dismissProgramRecommendation } from "@/lib/platform/actions";
import { QuickWorkoutCard } from "@/components/today/QuickWorkoutCard";
import {
  startQuickStrengthSession,
  repeatRecentSession,
  generateQuickStrengthSession,
  generateQuickHyroxSession,
} from "@/lib/sessions/actions";
import { getQuickRepeatCandidates } from "@/lib/sessions/queries";
import { getLimitationTodaySummary } from "@/lib/limitations/today-summary";
import { getNextBlockNudge } from "@/lib/planner/next-block-suggestion-server";
import { NextBlockSuggestionCard } from "@/components/planner/NextBlockSuggestionCard";
import type { SuggestProgramId } from "@/lib/planner/next-block-suggestion";
import { KNOWN_SUGGEST_PROGRAMS } from "@/lib/planner/next-block-suggestion";
import { getSeasonContinuation } from "@/lib/seasons/queries";
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
import { TmSuggestionBanner, type TmSuggestionView } from "@/components/today/TmSuggestionBanner";
import {
  acceptTmSuggestion,
  dismissTmSuggestion,
} from "@/lib/training-maxes/actions";
import type { TmFormula } from "@hta/db";
import { listTrainingMaxes } from "@/lib/training-maxes/queries";
import { loadBlockProgramKinds } from "@/lib/programs/ownership";
import { orderPlannedSessionsForToday } from "@/lib/sessions/today-hero";

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  const userId = user!.id;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "display_name, timezone, am_window_start, pm_window_start, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, time_format, date_format, bw_nudge_hidden_until, bw_banner_dismissed_at, units, season_planning_enabled",
    )
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new Error("Couldn't load today's settings.", { cause: profileError });

  const todayIso = todayYmd(profile?.timezone ?? "UTC");
  const activePrograms = getActiveBlocks();

  const [{ data: todaySessions, error: todaySessionsError }, plannedToday, freshness, activeBlocks, tmRows, { data: activeLimitationsRaw, error: limitationsError }, quickRepeatRecent, limitationSummary, programRecs, lastWeight] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, title, slot, completed_at, performed_at")
      .is("deleted_at", null)
      .gte("performed_at", ymdToUtc(todayIso, profile?.timezone ?? "UTC").toISOString())
      .lt("performed_at", ymdToUtc(addDaysToYmd(todayIso, 1), profile?.timezone ?? "UTC").toISOString())
      .order("performed_at", { ascending: false }),
    getTodayPlannedSessions(),
    getRegionFreshness(supabase, userId),
    activePrograms,
    listTrainingMaxes(),
    supabase
      .from("limitations")
      .select("id, kind, severity, started_at, region, resolved_at, affected_muscles, affected_movement_ids, allowed_movement_ids")
      .eq("user_id", userId)
      .is("resolved_at", null)
      .order("started_at", { ascending: false })
      .limit(20),
    getQuickRepeatCandidates(supabase, userId, { limit: 3 }),
    getLimitationTodaySummary(),
    getPendingProgramRecommendations(supabase, userId),
    supabase.from("wellness").select("date").eq("user_id", userId).not("bodyweight_kg", "is", null)
      .order("date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (todaySessionsError) throw new Error("Today\u0027s workouts could not be loaded.", { cause: todaySessionsError });
  if (limitationsError || lastWeight.error) throw new Error("Couldn't load today's prompts.", { cause: limitationsError ?? lastWeight.error });

  const activeLimitations: ActiveLimitationSummary[] = (
    activeLimitationsRaw ?? []
  ).map((r) => ({
    id: r.id as string,
    kind: (r.kind as string | null) ?? null,
    severity: r.severity as "mild" | "moderate" | "severe",
    startedAt: r.started_at as string,
  }));

  const activeBlock = activeBlocks.length === 1 ? activeBlocks[0] : null;
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
      const { data: pendingSuggestionsRaw, error: suggestionsError } = await supabase
        .from("tm_suggestions")
        .select(
          "id, movement_id, current_tm_kg, suggested_tm_kg, derived_formula, derived_from_set_log_id, derived_from_session_id, created_at",
        )
        .eq("user_id", userId).eq("status", "pending")
        .order("created_at", { ascending: false });
      if (suggestionsError) throw new Error("Couldn't read strength suggestions. Try again.");
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
      const [{ data: movRows }, { data: setRows }, { data: sessRows, error: sessionsError }] = await Promise.all([
        supabase.from("movements").select("id, display_name").in("id", movIds),
        setIds.length > 0
          ? supabase.from("set_logs").select("id, weight_kg, reps").in("id", setIds)
          : Promise.resolve({ data: [] as { id: string; weight_kg: unknown; reps: unknown }[] }),
        sessIds.length > 0
          ? supabase.from("sessions").select("id, performed_at, block_id").eq("user_id", userId).in("id", sessIds)
          : Promise.resolve({ data: [] as { id: string; performed_at: string; block_id: string | null }[], error: null }),
      ]);
      if (sessionsError) throw new Error("Couldn't read the source workouts. Try again.");
      const blockIds = (sessRows ?? []).flatMap((session) => session.block_id ? [session.block_id] : []);
      const kinds = await loadBlockProgramKinds(supabase, userId, blockIds);
      const typedSessions = new Set((sessRows ?? [])
        .filter((session) => session.block_id && kinds.get(session.block_id) != null).map((session) => session.id));
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
      return pendingSuggestionsRaw.filter((s) => !typedSessions.has(s.derived_from_session_id)).map((s) => {
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
      const { data: movs, error: movementError } = await supabase
        .from("movements")
        .select("id, display_name, slug, primary_region")
        .in("id", plannedMovementIds);
      if (movementError) throw new Error("Couldn't check today's exercises. Try again.");
      for (const m of movs ?? []) {
        regionMap.set(m.id, {
          primaryRegion: m.primary_region as string,
          name: m.display_name as string,
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

  const isTwoADay = hasTwoADaySlotPair(
    plannedToday.map((planned) => planned.slot),
  );
  const timezone = profile?.timezone ?? "UTC";
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

  // Continue the roadmap's own program, including after it completes or ends.
  const seasonNext =
    profile?.season_planning_enabled === true
      ? await (async () => {
          const continuation = await getSeasonContinuation(timezone);
          if (!continuation) return null;
          const next = continuation.block;
          const programName =
            selectablePrograms().find((p) => p.id === next.programId)?.name ??
            "Program";
          return { ...continuation, programName };
        })()
      : null;


  const [plannedDaysAll, swims, limitationData] = await Promise.all([
    getActivePlannedDays(),
    loadTodaySwims(supabase, userId, todayIso),
    activeLimitations.length && plannedToday.some((planned) => !planned.completedAt && !planned.skippedAt)
      ? loadPickerCatalog(supabase).then((catalog) => ({ catalog, response: buildLimitationResponse(
        plannedToday.filter((planned) => !planned.completedAt && !planned.skippedAt),
        catalog, deriveLimitationsContext(activeLimitationsRaw ?? []), resolveEquipment(profile),
      ) })) : null,
  ]);
  const limitationResponse = limitationData?.response;
  const limitationContexts = (activeLimitationsRaw ?? []).map((row) => ({ id: row.id, ctx: deriveLimitationsContext([row]) }));
  const limitationAffected = new Set(limitationResponse
    ? [...limitationResponse.swaps, ...limitationResponse.drops, ...limitationResponse.warns].map((row) => row.sessionId) : []);
  const plannedWorkouts = orderPlannedSessionsForToday(plannedToday, isTwoADay)
    .filter((planned) => !planned.skippedAt && planned.role !== "rest")
    .map((planned) => {
      const workout = plannedTodayWorkout(planned, activeBlocks, plannedDaysAll);
      const conflict = conflictsBySlot.get(planned.id);
      if (limitationAffected.has(planned.id) && limitationResponse && limitationData) {
        const offence = [...limitationResponse.warns, ...limitationResponse.swaps, ...limitationResponse.drops]
          .find((row) => row.sessionId === planned.id)!;
        const limitationId = attributeLimitation(limitationData.catalog.find((row) => row.id === offence.fromMovementId),
          offence.fromMovementId, limitationContexts);
        const limitation = activeLimitationsRaw?.find((row) => row.id === limitationId);
        const area = (limitation?.region ? FRESHNESS_REGION_LABELS[limitation.region] : undefined)
          ?? (limitation?.affected_muscles ?? []).map((muscle: string) => {
            const group = MUSCLE_FROM_DB_ENUM[muscle];
            return group ? MUSCLE_LABELS[group] : undefined;
          }).find((label: string | undefined) => !!label);
        workout.note = area
          ? `${area} still recovering. ${offence.fromName} may need a lighter load or a swap.`
          : "An active limitation affects this workout.";
      }
      else if (conflict) workout.note = `${conflict.regionLabel} still recovering. Heavy ${conflict.movementName} may need a lighter top set or a substitution.`;
      if (!workout.done && !workout.note) {
        if (recoveryBannerProps?.state.kind === "applied") workout.note = `Recovering from ${recoveryBannerProps.eventName}.`;
        else if (taperBannerProps?.state.kind === "applied") workout.note = `Tapering for ${taperBannerProps.eventName}.`;
      }
      return workout;
    });
  const linkedIds = new Set([...plannedWorkouts, ...swims.workouts].flatMap((workout) => workout.sessionId ? [workout.sessionId] : []));
  const unplannedWorkouts: TodayWorkout[] = (todaySessions ?? []).filter((session) => !linkedIds.has(session.id)).map((session) => ({
    id: session.id, sessionId: session.id, date: todayIso, title: session.title ?? "Workout",
    program: "Quick workout", programId: null, kind: null, done: !!session.completed_at,
    href: `/app/sessions/${session.id}`, minutes: null, action: "Continue workout",
    state: session.completed_at ? "completed" : "in_progress",
  }));
  const workouts = [...plannedWorkouts, ...swims.workouts.filter((workout) => workout.date === todayIso || workout.state === "started"), ...unplannedWorkouts];
  const summaries = await loadTodaySessionSummaries(supabase,
    [...new Set(workouts.filter((workout) => workout.done && workout.sessionId).map((workout) => workout.sessionId!))],
    profile?.units === "imperial");
  for (const workout of workouts) if (workout.sessionId && !workout.summary) workout.summary = summaries.get(workout.sessionId);
  const availableWorkouts = [
    ...plannedDaysAll.filter((planned) => !planned.skippedAt && planned.role !== "rest")
      .map((planned) => plannedTodayWorkout(planned, activeBlocks, plannedDaysAll)),
    ...swims.workouts, ...unplannedWorkouts,
  ];
  const weekWorkouts = await loadTodayWeek(supabase, activeBlocks, availableWorkouts);
  const next = availableWorkouts.filter((workout) => workout.date > todayIso && !workout.done &&
    (workout.state === "not_started" || workout.state === "scheduled"))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const selectedPrompt = selectTodayPrompt({
    "race-recovery": !!recoveryBannerProps,
    "race-check-in": !!raceCheckInProps,
    taper: !!taperBannerProps,
    "active-limitation": limitationAffected.size > 0,
    "training-max": pendingSuggestions.length > 0,
    season: !!seasonNext,
    "next-program": !!endingNudge && !!(endingNudge.suggestion || endingNudge.realization),
    "program-recommendation": programRecs.length > 0,
    "bodyweight-only": !hasLoadableMainLift(resolveEquipment(profile)) && tmRows.length === 0 && !profile?.bw_banner_dismissed_at,
    bodyweight: (!lastWeight.data || lastWeight.data.date <= addDaysToYmd(todayIso, -7)) &&
      (!profile?.bw_nudge_hidden_until || Date.parse(profile.bw_nudge_hidden_until) <= new Date().getTime()),
  });
  const programNames = Object.fromEntries(activeBlocks.map((block) => [block.id, archetypeDisplayName(block.archetype, block.notes)]));
  let prompt: React.ReactNode = null;
  switch (selectedPrompt?.kind) {
    case "race-recovery": prompt = recoveryBannerProps && <RecoveryBanner {...recoveryBannerProps} />; break;
    case "race-check-in": prompt = raceCheckInProps && <RaceCheckInCard {...raceCheckInProps} />; break;
    case "taper": prompt = taperBannerProps && <TaperBanner {...taperBannerProps} />; break;
    case "active-limitation": prompt = <ActiveLimitationsCard limitations={activeLimitations}
      adjustedById={limitationSummary.adjustedById} pendingCount={limitationSummary.pendingCount} />; break;
    case "training-max": prompt = <TmSuggestionBanner suggestions={pendingSuggestions.slice(0, 1)}
      acceptAction={acceptTmSuggestion} dismissAction={dismissTmSuggestion}
      units={profile?.units === "imperial" ? "imperial" : "metric"} />; break;
    case "season": prompt = seasonNext && <NextBlockSuggestionCard compact
      nudge={{ suggestion: { programId: seasonNext.block.programId as SuggestProgramId, programName: seasonNext.programName,
        reason: seasonNext.block.intentNote?.trim() || `It's the next program in your season "${seasonNext.seasonName}".` }, realization: null }}
      eyebrow="Next in your season" heading={`Next up: a ${seasonNext.programName} program`} suggestionTail=""
      cta={{ href: `/app/program?program=${seasonNext.block.programId}&seasonBlockId=${seasonNext.block.id}`, label: "Start this program" }}
      testId="block-ending-nudge-season" />; break;
    case "next-program": prompt = endingNudge && <NextBlockSuggestionCard compact nudge={endingNudge}
      eyebrow="Final week · what's next"
      cta={{ href: endingNudge.suggestion ? `/app/program?program=${endingNudge.suggestion.programId}` : "/app/program", label: "Plan your next program" }}
      testId="block-ending-nudge" />; break;
    case "program-recommendation": prompt = <ProgramRecommendationsBanner recommendations={programRecs.slice(0, 1)}
      programNames={programNames} dismissAction={dismissProgramRecommendation} />; break;
    case "bodyweight-only": prompt = <BodyweightOnlyBanner dismissedAt={profile?.bw_banner_dismissed_at ?? null}
      dismissBwBannerAction={dismissBwBanner} />; break;
    case "bodyweight": prompt = <BodyweightNudge todayYmd={todayIso} recordDailyCheckIn={recordDailyCheckIn}
      dismissedUntilIso={profile?.bw_nudge_hidden_until ?? null} dismissBwNudgeAction={dismissBwNudge}
      snoozeUntil={ymdToUtc(addDaysToYmd(todayIso, 1), timezone).toISOString()} />; break;
  }
  return <TodayDashboard today={todayIso} workouts={workouts} weekWorkouts={weekWorkouts}
    hasProgram={activeBlocks.length > 0 || swims.hasProgram} multiplePrograms={activeBlocks.length + swims.activeCount > 1}
    next={next} prompt={prompt} promptPlacement={selectedPrompt?.placement}
    quickWorkout={<QuickWorkoutCard variant={workouts.length ? "planned" : "rest"} recent={quickRepeatRecent}
      startStrength={startQuickStrengthSession} repeatRecent={repeatRecentSession}
      generateStrength={generateQuickStrengthSession} generateHyrox={generateQuickHyroxSession}
      hyroxStationDefaults={hyroxStationDefaults} />} />;
}
