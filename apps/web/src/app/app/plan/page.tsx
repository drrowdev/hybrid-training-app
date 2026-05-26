import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { acceptTmBump, declineTmBump } from "@/lib/engine/tm-bump-actions";
import { findBlockCompleteBump } from "@/lib/engine/block-complete";
import {
  endBlock,
  movePlannedSession,
  skipPlannedSession,
  unskipPlannedSession,
  createBlock,
} from "@/lib/planner/actions";
import { updatePlannedSessionNotes } from "@/lib/sessions/actions";
import { updateWizardDayPref } from "@/lib/profile/actions";
import type { WizardDayPrefValue } from "@/lib/planner/wizard/day-pref";
import {
  ARCHETYPES,
  STRENGTH_ROLE_LABELS,
  effectiveDays,
} from "@/lib/planner/archetypes";
import {
  getActiveBlock,
  getBlockNumberAndTotal,
  getPlannedDays,
  getRecentBlocks,
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
import {
  PlanNewSwitch,
  type RecentBlockCard,
  type TmReadinessByArchetype,
} from "@/components/planner/BlockWizard";
import { addDaysToYmd } from "@/lib/dates";

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
    view?: string;
    filter?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
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
          "allows_two_a_days, timezone, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, bodyweight_kg, wizard_day_pref",
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
          serverDayPref={(prof?.wizard_day_pref ?? null) as WizardDayPrefValue | null}
          saveDayPrefAction={updateWizardDayPref}
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

  // ── Active block ─────────────────────────────────────────────────
  // The active-block path is the redesigned overview: header → controls
  // → two-column (timeline + "This week" rail) → drawer drill-down.
  // All the heavy summarising lives in PlanRedesign as a client
  // component; this server function just shapes the data.
  const archetype = ARCHETYPES[block.archetype as keyof typeof ARCHETYPES];
  const isCustom = block.archetype === "custom";
  const archetypeName = isCustom
    ? block.notes?.trim() || "Custom block"
    : archetype?.name ?? block.archetype;

  const [all, { data: profile }, blockNumbering] = await Promise.all([
    getPlannedDays(block.id, block.startedOn),
    supabase
      .from("profiles")
      .select("timezone, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, bw_banner_dismissed_at")
      .eq("id", user.id)
      .maybeSingle(),
    getBlockNumberAndTotal(block.id),
  ]);
  const timezone = profile?.timezone ?? "UTC";
  const sp = await searchParams;
  const today = todayYmd(timezone);
  const todayWeek = all.find((d) => d.date === today)?.weekIndex ?? -1;

  const view: PlanViewMode = sp?.view === "month" ? "month" : "timeline";
  const filter: PlanFilter =
    sp?.filter === "strength" || sp?.filter === "cardio" ? sp.filter : "all";

  const sessions: PlanSessionInput[] = all.map((p) => {
    const items = p.prescription?.items ?? [];
    const isCardio =
      items.length > 0 && items.every((i) => (i.kind ?? "").startsWith("cardio_"));
    const hasStrengthItems = items.some((i) => !(i.kind ?? "").startsWith("cardio_"));
    // Rough duration estimate — sum cardio durationMin, then add a flat
    // 5 min per non-cardio item. Pure UI cosmetic, no engine impact.
    let dur: number | null = null;
    for (const it of items) {
      if (it.kind?.startsWith("cardio_") && it.durationMin) {
        dur = (dur ?? 0) + it.durationMin;
      }
    }
    if (hasStrengthItems) {
      const strengthCount = items.filter(
        (i) => !(i.kind ?? "").startsWith("cardio_"),
      ).length;
      dur = (dur ?? 0) + strengthCount * 5;
    }
    return {
      id: p.id,
      weekIndex: p.weekIndex,
      dayIndex: p.dayIndex,
      date: p.date,
      title: p.title,
      isCardio,
      isStrength: hasStrengthItems,
      done: !!p.completedSessionId,
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

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {tissueGaps.length > 0 && <TissueStackCard gaps={tissueGaps} />}
      {showBodyweightBanner && (
        <BodyweightOnlyBanner
          dismissedAt={profile?.bw_banner_dismissed_at ?? null}
          dismissBwBannerAction={dismissBwBanner}
        />
      )}

      <PlanRedesign
        archetypeName={archetypeName}
        archetypeId={block.archetype}
        blockNumber={blockNumbering.index}
        blockTotal={blockNumbering.total}
        startedOn={block.startedOn}
        endedOn={endedOn}
        weeks={block.weeks}
        today={today}
        currentWeekIndex={todayWeek}
        sessions={sessions}
        view={view}
        filter={filter}
        logHrefBase="/app/sessions/start"
        moveAction={movePlannedSession}
        skipAction={skipPlannedSession}
        unskipAction={unskipPlannedSession}
        updateNotesAction={updatePlannedSessionNotes}
      />

      <section
        className="cp-card"
        style={{
          padding: 16,
          display: sessions.every((s) => s.done || s.skipped) ? "block" : "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
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
          <div
            style={{
              fontSize: 11,
              color: "var(--cp-success)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
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
