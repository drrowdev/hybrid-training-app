import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  endBlock,
  movePlannedSession,
  skipPlannedSession,
  unskipPlannedSession,
} from "@/lib/planner/actions";
import { updatePlannedSessionNotes } from "@/lib/sessions/actions";
import { estimateSessionDurationBreakdown } from "@/lib/sessions/estimate-duration";
import { ARCHETYPES } from "@/lib/planner/archetypes";
import {
  getActiveBlock,
  getPlannedDays,
  todayYmd,
} from "@/lib/planner/queries";
import { getTrainingMaxContext } from "@/lib/training-maxes/queries";
import { getCurrentWeekTissueStackGaps, type TissueStackGap } from "@/lib/stats/tissue-stack-queries";
import {
  PlanRedesign,
  type PlanSessionInput,
  type PlanViewMode,
} from "@/components/plan/PlanRedesign";
import { PlanProgramActions } from "@/components/plan/PlanProgramActions";
import { BodyweightOnlyBanner } from "@/components/banners/BodyweightOnlyBanner";
import { dismissBwBanner } from "@/lib/profile/actions";
import {
  hasLoadableMainLift,
  resolveEquipment,
} from "@/lib/settings/equipment-presets";
import { getVolumeAutoregOffer } from "@/lib/planner/autoreg-offer";
import { acceptVolumeAutoregResult } from "@/lib/planner/autoreg-actions";
import { VolumeAutoregCard } from "@/components/plan/VolumeAutoregCard";
import { getDeloadSkipOffer } from "@/lib/planner/deload-skip-offer";
import { acceptDeloadSkip } from "@/lib/planner/deload-skip-actions";
import { DeloadSkipCard } from "@/components/plan/DeloadSkipCard";
import { getDeloadWeekPreview, getDeloadWeekFatigueSignal } from "@/lib/planner/deload-week-preview";
import { insertDeloadWeekAction } from "@/lib/planner/deload-week-actions";
import { DeloadWeekCard } from "@/components/plan/DeloadWeekCard";
import { getEarlyDeloadRecommendation } from "@/lib/planner/early-deload-offer";
import { acceptEarlyDeload } from "@/lib/planner/early-deload-actions";
import { EarlyDeloadCard } from "@/components/plan/EarlyDeloadCard";
import { resolveDeloadWeekIndex } from "@/lib/planner/deload-skip";
import { getLimitationResponseOffer } from "@/lib/limitations/offer";
import { applyLimitationResponseSelection } from "@/lib/limitations/actions";
import { LimitationResponseCard } from "@/components/limitations/LimitationResponseCard";
import { daysBetweenYmd, mondayOfYmd } from "@/lib/dates";
import { getActiveSeason, getUpcomingAEvents } from "@/lib/seasons/queries";
import { getMaintenanceFloorContext } from "@/lib/seasons/maintenance-floor-server";
import { SeasonDiscoveryNudge } from "@/components/seasons/SeasonDiscoveryNudge";
import { SEASON_EMPHASIS_VALUES } from "@/lib/seasons/season-logic";
import { selectablePrograms, getProgramEngine } from "@/lib/platform/registry";
import { SeasonRoadmap } from "@/components/seasons/SeasonRoadmap";
import { programSegments } from "@hta/program-core";
import {
  inferProgramStartWeekIndex,
  relativeProgramSegments,
  shiftSegmentsForInsertedWeeks,
} from "@/lib/plan/program-overview";

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    filter?: string;
    new?: string;
    build?: string;
    deload?: string;
    kept?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  // `?new=1` requests a fresh block mid-stream; like the empty state it routes
  // to the program wizard, which archives any prior active block on deploy.
  const forceNew = sp?.new === "1";

  // Season tab (ADR 0051) — opt-in, off by default. Its data is loaded alongside
  // the active block so Program / Calendar / Season can switch inside one shared
  // Plan shell. The standalone branch remains only for the edge case where a
  // Season exists without an active program to supply that shell.
  const { data: seasonProfile } = await supabase
    .from("profiles")
    .select("season_planning_enabled, timezone")
    .eq("id", user.id)
    .maybeSingle();
  const seasonEnabled = seasonProfile?.season_planning_enabled === true;
  const profileTz = seasonProfile?.timezone ?? "UTC";

  const [block, seasonReads] = await Promise.all([
    getActiveBlock(),
    seasonEnabled
      ? Promise.all([
          getActiveSeason(),
          getUpcomingAEvents(todayYmd(profileTz)),
          getMaintenanceFloorContext(supabase, user.id),
        ])
      : Promise.resolve(null),
  ]);
  const seasonData = seasonReads
    ? (() => {
        const [season, upcomingEvents, floorContext] = seasonReads;
        const programs = selectablePrograms().map((program) => ({
          id: program.id,
          name: program.name,
        }));
        const templatesByProgram: Record<
          string,
          { value: string; label: string }[]
        > = {};
        for (const program of programs) {
          const engine = getProgramEngine(program.id);
          const field = engine
            ?.describeSetup()
            .fields.find(
              (candidate) =>
                candidate.key === "templateId" ||
                candidate.key === "phaseId",
            );
          if (field?.options?.length) {
            templatesByProgram[program.id] = field.options;
          }
        }
        return {
          season,
          upcomingEvents,
          floorContext,
          programs,
          templatesByProgram,
        };
      })()
    : null;
  const seasonContent = seasonData ? (
    <SeasonRoadmap
      season={seasonData.season}
      programs={seasonData.programs}
      emphasisOptions={SEASON_EMPHASIS_VALUES}
      today={todayYmd(profileTz)}
      upcomingEvents={seasonData.upcomingEvents}
      floorContext={seasonData.floorContext}
      templatesByProgram={seasonData.templatesByProgram}
    />
  ) : null;

  if (seasonEnabled && sp?.view === "season" && !block) {
    return (
      <div style={{ display: "grid", gap: 24 }}>
        <SeasonViewTabs />
        {seasonContent}
      </div>
    );
  }

  if (!block || forceNew) {
    // Season-enabled users with an active Season but no live block would
    // otherwise be bounced straight to the program wizard and never reach their
    // roadmap (UX audit P2). Route them to the Season view instead — unless they
    // explicitly asked for a fresh program (?new=1). Only when a Season actually
    // exists, so users without one keep the normal "start a program" flow.
    if (seasonEnabled && !forceNew && seasonData?.season) {
      redirect("/app/plan?view=season");
    }
    // Legacy archetype BlockWizard retired — block creation now flows through
    // the program wizard (/app/program). createProgramInstance archives any
    // prior active block on deploy, covering the mid-block "start new" (?new=1).
    redirect("/app/program");
  }

  // ── Active block ─────────────────────────────────────────────────
  // The active-block path is the redesigned overview: header → controls
  // → two-column (timeline + "This week" rail) → drawer drill-down.
  // All the heavy summarising lives in PlanRedesign as a client
  // component; this server function just shapes the data.
  const archetype = ARCHETYPES[block.archetype as keyof typeof ARCHETYPES];
  const isCustom = block.archetype === "custom";
  // Platform programs (5/3/1, Tactical Barbell, Green Protocol) don't set a
  // known `archetype`; their display name is stored in `notes` (engine.meta.name)
  // at deploy. Fall back to it so the Plan header shows the program, not a blank.
  const baseArchetypeName = isCustom
    ? block.notes?.trim() || "Custom program"
    : archetype?.name ?? block.notes?.trim() ?? block.archetype ?? "Program";
  // Program-aware noun for a training block: 5/3/1 (family "531") calls it a
  // "cycle"; Tactical Barbell / Green Protocol (and the generic default) call
  // it a "block" — matching each methodology's own book terminology.
  const cycleNoun = block.programFamily === "531" ? "cycle" : "block";

  // Forward-only wizard re-entry ("Edit plan") is wired for the strength-only
  // foreign programs (5/3/1, Tactical Barbell) — the ones whose cardio days are
  // user-added in the wizard. Other programs own their own calendar/cardio.
  const canEditPlan =
    block.programId === "wendler-531" || block.programId === "tactical-barbell";

  const [all, { data: profile }, { data: programInstance }] =
    await Promise.all([
      getPlannedDays(block.id, block.startedOn),
      supabase
        .from("profiles")
        .select("timezone, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, bw_banner_dismissed_at")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("program_instances")
        .select("program_id, instance, setup_input, display_name, customization_version")
        .eq("block_id", block.id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle(),
    ]);
  const timezone = profile?.timezone ?? "UTC";
  const today = todayYmd(timezone);
  const planStartedOn = mondayOfYmd(block.startedOn);
  const elapsedDays = daysBetweenYmd(planStartedOn, today);
  const todayWeek =
    elapsedDays < 0
      ? -1
      : elapsedDays >= block.weeks * 7
        ? block.weeks
        : Math.floor(elapsedDays / 7);

  const view: PlanViewMode =
    seasonEnabled && sp?.view === "season"
      ? "season"
      : sp?.view === "month"
        ? "month"
        : "timeline";
  const programFamilyName =
    selectablePrograms().find((program) => program.id === block.programId)
      ?.name ?? "SxC";
  const customized = programInstance?.customization_version != null;
  const archetypeName =
    (programInstance?.display_name as string | null)?.trim() ||
    baseArchetypeName;
  const ownerEngine = programInstance?.program_id
    ? getProgramEngine(programInstance.program_id as string)
    : undefined;
  const setupInput =
    (programInstance?.setup_input as Record<string, unknown> | null) ?? {};
  const storedStartWeekIndex =
    typeof setupInput.startWeekIndex === "number"
      ? setupInput.startWeekIndex
      : null;
  const firstBlockRefs = all
    .filter((day) => day.weekIndex === 0)
    .map((day) => day.prescription?.programRef)
    .filter((ref): ref is string => typeof ref === "string");
  const startWeekIndex =
    storedStartWeekIndex ??
    (ownerEngine
      ? inferProgramStartWeekIndex(
          ownerEngine,
          programInstance?.instance,
          firstBlockRefs,
        )
      : 0);
  const insertedRecoveryWeeks = [
    ...new Set(
      all
        .filter(
          (day) =>
            day.role === "deload" &&
            typeof day.prescription?.programRef !== "string",
        )
        .map((day) => day.weekIndex),
    ),
  ];
  const segments = shiftSegmentsForInsertedWeeks(
    relativeProgramSegments(
      ownerEngine
        ? programSegments(ownerEngine, programInstance?.instance)
        : [],
      startWeekIndex,
      block.weeks,
      archetypeName,
    ),
    insertedRecoveryWeeks,
    block.weeks,
  );

  const sessions: PlanSessionInput[] = all.map((p) => {
    const items = p.prescription?.items ?? [];
    const isCardio =
      items.length > 0 && items.every((i) => (i.kind ?? "").startsWith("cardio_"));
    const hasStrengthItems = items.some((i) => !(i.kind ?? "").startsWith("cardio_"));
    const isRehab = p.role === "rehab";
    // Set-aware duration estimate (shared with the planner's tilt governor).
    const dur = estimateSessionDurationBreakdown(items).displayMinutes;
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
      estDurationMin: dur,
      notes: p.notes,
      completedSessionId: p.completedSessionId,
    };
  });

  // The generic tissue-stack audit belongs only to app-generated archetype
  // blocks. Packaged programs return no gaps because they own their methodology.
  const tissueGaps = await getCurrentWeekTissueStackGaps(supabase, user.id);

  // Reuse the `profile` row fetched above (audit F8 — was a duplicate
  // fetch of the same columns).
  const planTmCtx = await getTrainingMaxContext();
  const showBodyweightBanner =
    !hasLoadableMainLift(resolveEquipment(profile)) &&
    planTmCtx.rows.length === 0;

  // ADR 0013 / 0014 — mid-block adaptive offers. Both read-only here;
  // the accept actions re-derive server-side before writing. Null when
  // nothing applies (no over-budget signal / no offending limitation).
  const [autoregOffer, limitationOffer, deloadSkipOffer, earlyDeloadReco, deloadWeekPreview, deloadFatigued] = await Promise.all([
    getVolumeAutoregOffer(),
    getLimitationResponseOffer(),
    getDeloadSkipOffer(),
    getEarlyDeloadRecommendation(),
    getDeloadWeekPreview(supabase, user.id),
    getDeloadWeekFatigueSignal(),
  ]);

  // Recovery-week entry. The QUIET control is always available (program
  // controls). The PROMINENT banner only surfaces on a real fatigue signal — or
  // when deep-linked from the TB deload advisory (?deload=1) — and never when a
  // programmed deload offer is already handling fatigue.
  const deloadDeepLink = sp.deload === "1";
  const showDeloadBanner =
    !!deloadWeekPreview &&
    !deloadSkipOffer &&
    !earlyDeloadReco &&
    (deloadFatigued || deloadDeepLink);

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {sp?.kept === "today" && (
        <div
          data-testid="plan-today-kept-notice"
          style={{
            border: "1px solid var(--cp-border)",
            borderLeft: "3px solid var(--cp-warning)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--cp-text)",
            background: "var(--cp-surface)",
          }}
        >
          Today&rsquo;s workout is already under way, so it kept its current
          plan. Your changes apply to the upcoming workouts.
        </div>
      )}
      {!seasonEnabled && <SeasonDiscoveryNudge />}
      {tissueGaps.length > 0 && <TissueStackCard gaps={tissueGaps} />}
      {limitationOffer && (
        <LimitationResponseCard
          offer={limitationOffer}
          applyAction={applyLimitationResponseSelection}
        />
      )}
      {autoregOffer && (
        <VolumeAutoregCard offer={autoregOffer} applyAction={acceptVolumeAutoregResult} />
      )}
      {earlyDeloadReco && (
        <EarlyDeloadCard reco={earlyDeloadReco} applyAction={acceptEarlyDeload} />
      )}
      {deloadSkipOffer && (
        <DeloadSkipCard offer={deloadSkipOffer} applyAction={acceptDeloadSkip} />
      )}
      {showDeloadBanner && deloadWeekPreview && (
        <DeloadWeekCard
          preview={deloadWeekPreview}
          insertAction={insertDeloadWeekAction}
          variant="banner"
          autoOpen={deloadDeepLink}
        />
      )}
      {showBodyweightBanner && (
        <BodyweightOnlyBanner
          dismissedAt={profile?.bw_banner_dismissed_at ?? null}
          dismissBwBannerAction={dismissBwBanner}
        />
      )}

      <PlanRedesign
        archetypeName={archetypeName}
        programFamilyName={programFamilyName}
        customized={customized}
        segments={segments}
        headerActions={
          <PlanProgramActions
            blockId={block.id}
            canEdit={canEditPlan}
            editHref={`/app/program?edit=${block.id}`}
            startNewHref="/app/plan?new=1"
            endAction={endBlock}
            recoveryControl={
              deloadWeekPreview && !showDeloadBanner ? (
                <DeloadWeekCard
                  preview={deloadWeekPreview}
                  insertAction={insertDeloadWeekAction}
                  variant="quiet"
                  autoOpen={deloadDeepLink}
                />
              ) : undefined
            }
          />
        }
        cycleNoun={cycleNoun}
        focusMuscles={block.focusMuscles}
        startedOn={planStartedOn}
        weeks={block.weeks}
        today={today}
        currentWeekIndex={todayWeek}
        deloadWeekIndex={resolveDeloadWeekIndex({ archetype: block.archetype, weeks: block.weeks, sessions: all })}
        sessions={sessions}
        view={view}
        moveAction={movePlannedSession}
        skipAction={skipPlannedSession}
        unskipAction={unskipPlannedSession}
        updateNotesAction={updatePlannedSessionNotes}
        seasonEnabled={seasonEnabled}
        seasonContent={seasonContent}
      />
    </div>
  );
}


function SeasonViewTabs() {
  const tabBase = {
    fontSize: 13,
    fontWeight: 600,
    minHeight: 42,
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 14px",
    borderRadius: 8,
    color: "var(--cp-text-soft)",
    textDecoration: "none",
  } as const;
  const activeTab = {
    ...tabBase,
    color: "var(--cp-text)",
    background: "var(--cp-surface-soft)",
  } as const;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <nav
        aria-label="Plan views"
        className="cp-card"
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 2,
          borderRadius: 10,
          background: "var(--cp-surface)",
        }}
      >
        <Link href="/app/plan" style={tabBase} data-testid="season-nav-timeline">
          Program
        </Link>
        <Link
          href="/app/plan?view=month"
          style={tabBase}
          data-testid="season-nav-month"
        >
          Calendar
        </Link>
        <span style={activeTab} aria-current="page" data-testid="season-nav-season">
          Season
        </span>
      </nav>
      <span style={{ color: "var(--cp-text-muted)", fontSize: 12 }}>
        Long-range training roadmap
      </span>
    </div>
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
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-warning)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
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
 * ADR 0013 — within-block volume autoregulation offer. Surfaces only
 * when this week's strength volume is over / way-over budget and there
 * are un-started current-week sessions with discretionary volume to
 * trim. Accepting stamps a reversible read-time scalar onto those rows.
 * Rendered by the client `VolumeAutoregCard` (confirmation modal lives there).
 */
