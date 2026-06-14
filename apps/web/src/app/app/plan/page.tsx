import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  endBlock,
  movePlannedSession,
  skipPlannedSession,
  startSessionFromPlan,
  unskipPlannedSession,
} from "@/lib/planner/actions";
import { updatePlannedSessionNotes } from "@/lib/sessions/actions";
import { estimateSessionMinutes } from "@/lib/sessions/estimate-duration";
import { ARCHETYPES } from "@/lib/planner/archetypes";
import {
  getActiveBlock,
  getBlockNumberAndTotal,
  getPlannedDays,
  todayYmd,
} from "@/lib/planner/queries";
import { getTrainingMaxContext } from "@/lib/training-maxes/queries";
import { getCurrentWeekTissueStackGaps, type TissueStackGap } from "@/lib/stats/tissue-stack-queries";
import { EndBlockForm } from "@/components/plan/EndBlockForm";
import { PlanRedesign, type PlanSessionInput, type PlanFilter, type PlanViewMode } from "@/components/plan/PlanRedesign";
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
import { addDaysToYmd } from "@/lib/dates";
import { hasAiAccess } from "@/lib/ai/access";

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    filter?: string;
    new?: string;
    build?: string;
    deload?: string;
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
  const block = await getActiveBlock();

  if (!block || forceNew) {
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
  const archetypeName = isCustom
    ? block.notes?.trim() || "Custom program"
    : archetype?.name ?? block.notes?.trim() ?? block.archetype ?? "Program";
  // Program-aware noun for a training block: 5/3/1 (family "531") calls it a
  // "cycle"; Tactical Barbell / Green Protocol (and the generic default) call
  // it a "block" — matching each methodology's own book terminology.
  const cycleNoun = block.programFamily === "531" ? "cycle" : "block";

  const [all, { data: profile }, blockNumbering] = await Promise.all([
    getPlannedDays(block.id, block.startedOn),
    supabase
      .from("profiles")
      .select("timezone, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, bw_banner_dismissed_at, byoai_provider, byoai_key_vault_id, byoai_unlocked_at")
      .eq("id", user.id)
      .maybeSingle(),
    getBlockNumberAndTotal(block.id),
  ]);
  const timezone = profile?.timezone ?? "UTC";
  const today = todayYmd(timezone);
  const todayWeek = all.find((d) => d.date === today)?.weekIndex ?? -1;

  const aiAccess = hasAiAccess({
    byoai_provider: profile?.byoai_provider ?? null,
    byoai_key_vault_id: profile?.byoai_key_vault_id ?? null,
    byoai_unlocked_at: profile?.byoai_unlocked_at ?? null,
  });

  const view: PlanViewMode = sp?.view === "month" ? "month" : "timeline";
  const filter: PlanFilter =
    sp?.filter === "strength" || sp?.filter === "cardio" ? sp.filter : "all";

  const sessions: PlanSessionInput[] = all.map((p) => {
    const items = p.prescription?.items ?? [];
    const isCardio =
      items.length > 0 && items.every((i) => (i.kind ?? "").startsWith("cardio_"));
    const hasStrengthItems = items.some((i) => !(i.kind ?? "").startsWith("cardio_"));
    // Set-aware duration estimate (shared with the planner's tilt governor).
    const dur = estimateSessionMinutes(items);
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
      estDurationMin: dur,
      notes: p.notes,
    };
  });

  // Block end date: last day of week N-1.
  const endedOn = addDaysToYmd(block.startedOn, block.weeks * 7 - 1);

  // Tissue gaps banner kept — the surfacing of "missing tendon work"
  // is engine output and stays out of the visual rework.
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
        cycleNoun={cycleNoun}
        blockNumber={blockNumbering.index}
        blockTotal={blockNumbering.total}
        focusMuscles={block.focusMuscles}
        startedOn={block.startedOn}
        endedOn={endedOn}
        weeks={block.weeks}
        today={today}
        currentWeekIndex={todayWeek}
        deloadWeekIndex={resolveDeloadWeekIndex({ archetype: block.archetype, weeks: block.weeks, sessions: all })}
        sessions={sessions}
        view={view}
        filter={filter}
        logHrefBase="/app/sessions/start"
        moveAction={movePlannedSession}
        skipAction={skipPlannedSession}
        unskipAction={unskipPlannedSession}
        updateNotesAction={updatePlannedSessionNotes}
        startSessionAction={startSessionFromPlan}
        aiAccess={aiAccess}
      />

      <section
        className="cp-card"
        data-testid="block-controls"
        style={{ padding: 16, display: "grid", gap: 14 }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>Program controls</div>

        {deloadWeekPreview && !showDeloadBanner && (
          <>
            <DeloadWeekCard
              preview={deloadWeekPreview}
              insertAction={insertDeloadWeekAction}
              variant="quiet"
              autoOpen={deloadDeepLink}
            />
            <div style={{ borderTop: "1px solid var(--cp-border)" }} />
          </>
        )}


        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Start a new program</div>
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
              Builds a fresh schedule and archives this one. You keep all logged sessions.
            </div>
          </div>
          <Link
            href="/app/plan?new=1"
            className="cp-btn primary"
            data-testid="start-new-block"
          >
            Start a new program
          </Link>
        </div>

        <div style={{ borderTop: "1px solid var(--cp-border)" }} />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>End current program</div>
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
              Archives the schedule without starting a new one. You keep all logged sessions.
            </div>
          </div>
          <EndBlockForm blockId={block.id} action={endBlock} />
        </div>
      </section>
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
