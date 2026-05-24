import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import { AddCardioBlockForm } from "@/components/add-log-forms";
import {
  addCardioBlock,
  addStrengthSet,
  applyStravaAutofill,
  deleteCardio,
  fillSessionFromPlan,
  swapPrescriptionItem,
} from "@/lib/sessions/actions";
import { DeleteSessionButton } from "@/components/trash/DeleteSessionButton";
import { getTrainingMaxDict } from "@/lib/training-maxes/queries";
import {
  type LoggedSet,
  type LastSetHint,
  type PriorBest,
} from "@/components/session/SessionLogClient";
import { SessionWorkArea } from "@/components/session/SessionWorkArea";
import { FinishSessionBar } from "@/components/session/FinishSessionBar";
import { PostSessionSummary } from "@/components/session/PostSessionSummary";
import { StravaAutofillBanner, type StravaAutofillMatch } from "@/components/session/StravaAutofillBanner";
import { findMatchingStravaActivity } from "@/lib/integrations/strava/match";
import { GRM_RECOMMEND_THRESHOLD, applyGrmToPercent, computeGrm, grmLabel } from "@/lib/engine/grm";
import { PR_KIND_LABEL } from "@/lib/engine/pr";
import { bestEstimateOneRm } from "@/lib/engine/one-rm";
import { acceptTmBump, declineTmBump } from "@/lib/engine/tm-bump-actions";
import { findDeloadProposalForSession } from "@/lib/engine/deload";
import { formatDate, formatDateTime } from "@/lib/format/datetime";
import { formatHitValue, countSessionTmAnchoredPrs, getSessionTmAnchoredPrSummaries } from "@/lib/stats/pr-queries";
import { findBumpProposalForSession } from "@/lib/stats/bump-proposal";
import { findPrRecalibrateProposals } from "@/lib/stats/pr-recalibrate";
import { getLastSetLogForMovement, summariseSessionSets } from "@/lib/sessions/queries";
import { suggestNextWeight } from "@/lib/progression/suggest-next";
import {
  matchPrescriptionItemsDetailed,
  countStrengthPrescriptionItems,
} from "@/lib/sessions/prescription-progress";
import type { ProgressionHint } from "@/components/session/PostSessionSummary";
import type { Prescription } from "@hta/db";
import { loadBwGateStatesForPrescription } from "@/lib/planner/bw-gate-state-loader";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("sessions")
    .select(
      "id, performed_at, title, fatigue, soreness, session_rpe, duration_min, notes, completed_at",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!session) notFound();

  // Phase 3 C1/C2 — load feedback preferences so we can thread them
  // into the log client (haptic tick on set save + tone at rest=0).
  // Bar weights + plate inventory ride along so the focus view can
  // render the plate-per-side breakdown next to the target weight.
  const { data: feedbackPrefs } = await supabase
    .from("profiles")
    .select(
      "haptics_enabled, timer_sound_enabled, barbell_kg, trap_bar_kg, plate_inventory_kg, equipment, timezone, time_format, date_format",
    )
    .eq("id", user.id)
    .maybeSingle();
  const hapticsEnabled = feedbackPrefs?.haptics_enabled ?? true;
  const timerSoundEnabled = feedbackPrefs?.timer_sound_enabled ?? true;
  // Resolve via the same canonical helper the settings page uses, so
  // a profile written through the new editor and a legacy profile
  // both surface a fully-typed Equipment blob here.
  const equipment = resolveEquipment(feedbackPrefs ?? null);
  const barbellKg = equipment.bars.barbellKg || 20;
  const trapBarKg = equipment.bars.trapBarKg ?? 25;
  const plateInventory = equipment.plates.map((weightKg) => ({ weightKg }));

  const { data: setsRaw } = await supabase
    .from("set_logs")
    .select(
      "id, set_index, set_kind, weight_kg, reps, duration_sec, distance_m, rpe, notes, prescription_item_index, skipped, skip_reason, movement:movements(id, slug, display_name, primary_region)",
    )
    .eq("session_id", id)
    .order("set_index", { ascending: true });

  const { data: cardio } = await supabase
    .from("cardio_logs")
    .select(
      "id, block_index, modality, duration_sec, distance_km, avg_hr_bpm, rpe, notes, movement:movements(id, display_name)",
    )
    .eq("session_id", id)
    .order("block_index", { ascending: true });

  const sets: LoggedSet[] = (setsRaw ?? []).map((s) => {
    const m = Array.isArray(s.movement) ? s.movement[0] : s.movement;
    return {
      id: s.id,
      set_index: s.set_index,
      set_kind: s.set_kind,
      weight_kg: s.weight_kg,
      reps: s.reps,
      duration_sec: s.duration_sec,
      distance_m: s.distance_m,
      rpe: s.rpe,
      skipped: s.skipped ?? false,
      skip_reason: (s.skip_reason as string | null) ?? null,
      movement: m ?? {
        id: "",
        slug: "",
        display_name: "Unknown movement",
        primary_region: "",
      },
    };
  });

  const tmDict = await getTrainingMaxDict();
  const tmBySlug: Record<string, number> = Object.fromEntries(tmDict.bySlug);
  const oneRmBySlug: Record<string, number> = Object.fromEntries(tmDict.oneRmBySlug);

  const isComplete = !!session.completed_at;

  // Pull the linked planned_session so we can build a contextual GRM
  // recommendation ("top set ~81% instead of 90%").
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, prescription")
    .eq("completed_session_id", id)
    .maybeSingle();
  const plannedPrescription = (planned?.prescription as Prescription | null) ?? null;
  const bwGateStateByFamily = await loadBwGateStatesForPrescription({
    supabase,
    userId: user.id,
    prescription: plannedPrescription,
  });
  const plannedTopPercent = plannedPrescription?.items
    .filter((i) => i.kind === "main" && typeof i.percentTm === "number")
    .reduce((max, i) => Math.max(max, i.percentTm ?? 0), 0);
  const grm = computeGrm({ fatigue: session.fatigue, soreness: session.soreness });
  const showRecommendation =
    grm.hasCheckIn && grm.value < GRM_RECOMMEND_THRESHOLD && !isComplete;

  // PR detection — the user-facing in-session 🏆 PR callout uses
  // TM-anchored detection: only fires when the new set beats the
  // user's saved 1RM (Weight / e1RM) or the prescription's top-set
  // reps (Rep PR). The historical-max detector (`getSessionPrs`)
  // still backs the lifetime catalog at /app/stats/prs — see the
  // two-tier rationale on the `feat/pr-vs-tm` PR.
  const tmAnchoredPrSummaries = sets.length > 0
    ? getSessionTmAnchoredPrSummaries(
        (setsRaw ?? []).map((s) => ({
          set_kind: s.set_kind as string,
          weight_kg: s.weight_kg as number | string | null,
          reps: (s.reps as number | null) ?? null,
          rpe: (s.rpe as number | string | null) ?? null,
          movement: (() => {
            const m = Array.isArray(s.movement) ? s.movement[0] : s.movement;
            return {
              id: m?.id ?? "",
              slug: m?.slug ?? "",
              display_name: m?.display_name ?? "Unknown movement",
            };
          })(),
        })),
        oneRmBySlug,
        plannedPrescription,
      )
    : [];

  // TM-bump proposal — runs the AMRAP confidence gate. Returns null when
  // there's no planned-session link, no AMRAP, no qualifying set, or the
  // gate suppresses (hard gate or below score threshold).
  const bumpProposal = !isComplete && sets.length > 0
    ? await findBumpProposalForSession(supabase, user.id, id)
    : null;

  // Deload proposal — fires when this session AND the prior AMRAP session
  // on the same movement both missed real (GRM-gated). Mutually exclusive
  // with bumpProposal in practice (the same set can't both bump and deload).
  const deloadProposal = !isComplete && !bumpProposal && sets.length > 0
    ? await findDeloadProposalForSession(supabase, user.id, id)
    : null;

  // PR-driven recalibrate — catches custom blocks, freestyle sessions, and
  // non-AMRAP top sets in curated blocks. Excludes movements that already
  // have an AMRAP or deload proposal so we don't double-stack cards.
  const excludeMovementIds = new Set<string>();
  if (bumpProposal) excludeMovementIds.add(bumpProposal.movementId);
  if (deloadProposal) excludeMovementIds.add(deloadProposal.movementId);
  const prRecalibrateProposals = !isComplete && sets.length > 0
    ? await findPrRecalibrateProposals(supabase, user.id, id, session.performed_at, excludeMovementIds)
    : [];

  // Phase 1 B2 — "Last time" inline hints. Resolve the set of movements
  // relevant to this session: every movement in the prescription PLUS
  // every movement already logged. Run the lookups in parallel so the
  // page render cost stays close to a single round-trip.
  const relevantMovementIds = new Set<string>();
  for (const s of sets) if (s.movement.id) relevantMovementIds.add(s.movement.id);
  for (const item of plannedPrescription?.items ?? []) {
    if (item.movementId) relevantMovementIds.add(item.movementId);
  }
  const lastHintsList = await Promise.all(
    Array.from(relevantMovementIds).map((mid) =>
      getLastSetLogForMovement(supabase, user.id, mid, { excludeSessionId: id }).then((row) =>
        row ? ([mid, row] as const) : null,
      ),
    ),
  );
  const lastSetHints: Record<string, LastSetHint> = {};
  for (const entry of lastHintsList) {
    if (!entry) continue;
    const [mid, row] = entry;
    lastSetHints[mid] = {
      weightKg: row.weightKg,
      reps: row.reps,
      performedAt: row.performedAt,
    };
  }

  // Phase 1 B3 — Prior personal bests snapshot for the client-side PR
  // badge. We pull the user's strongest prior set per relevant movement
  // (heaviest weight + best e1RM) so the client can flash ⭐PR! the
  // instant a new set beats either bar — without waiting for the
  // canonical server detection (which still runs in `getSessionPrs`).
  const priorBests: Record<string, PriorBest> = {};
  if (relevantMovementIds.size > 0 && !isComplete) {
    const { data: priorRowsRaw } = await supabase
      .from("set_logs")
      .select("weight_kg, reps, rpe, movement_id, sessions!inner(id, user_id, performed_at, deleted_at)")
      .in("movement_id", Array.from(relevantMovementIds))
      .eq("sessions.user_id", user.id)
      .is("sessions.deleted_at", null)
      .neq("set_kind", "warmup")
      .not("weight_kg", "is", null)
      .not("reps", "is", null)
      .gt("reps", 0)
      .lt("performed_at", session.performed_at)
      .limit(500);
    type PriorRow = {
      weight_kg: number | string;
      reps: number;
      rpe: number | string | null;
      movement_id: string;
    };
    for (const r of (priorRowsRaw ?? []) as PriorRow[]) {
      const weight = Number(r.weight_kg);
      const reps = Number(r.reps);
      const rpe = r.rpe == null ? null : Number(r.rpe);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      if (!Number.isFinite(reps) || reps <= 0) continue;
      const e1rm = bestEstimateOneRm({ weight, reps, rpe });
      const cur = priorBests[r.movement_id] ?? { heaviestWeight: null, bestE1rm: null };
      if (cur.heaviestWeight == null || weight > cur.heaviestWeight) {
        cur.heaviestWeight = weight;
      }
      if (e1rm != null && (cur.bestE1rm == null || e1rm > cur.bestE1rm)) {
        cur.bestE1rm = e1rm;
      }
      priorBests[r.movement_id] = cur;
    }
  }

  // Phase 1 C1/C2 — post-session summary. Materialised on-the-fly from
  // already-fetched rows; no new schema column.
  //
  // The "PRs" tile uses TM-anchored detection (see lib/engine/tm-anchored-pr.ts)
  // so the post-session callout lines up with the in-session ⭐ flash:
  // both fire only when the user beats their saved 1RM, not their
  // historical max from the log. The lifetime catalog at /app/stats/prs
  // continues to use historical-max detection — see the two-tier
  // rationale in `feat/pr-vs-tm` PR notes.
  const tmAnchoredPrCount = isComplete
    ? countSessionTmAnchoredPrs(
        (setsRaw ?? []).map((s) => ({
          set_kind: s.set_kind as string,
          weight_kg: s.weight_kg as number | string | null,
          reps: (s.reps as number | null) ?? null,
          rpe: (s.rpe as number | string | null) ?? null,
          movement: (() => {
            const m = Array.isArray(s.movement) ? s.movement[0] : s.movement;
            return { id: m?.id ?? "", slug: m?.slug ?? "" };
          })(),
        })),
        oneRmBySlug,
        plannedPrescription,
      )
    : 0;
  const summary = isComplete
    ? summariseSessionSets(
        (setsRaw ?? []).map((s) => ({
          set_kind: s.set_kind as string,
          weight_kg: s.weight_kg as number | string | null,
          reps: (s.reps as number | null) ?? null,
        })),
        {
          performed_at: session.performed_at as string,
          completed_at: (session.completed_at as string | null) ?? null,
          duration_min: (session.duration_min as number | null) ?? null,
        },
        tmAnchoredPrCount,
      )
    : null;

  // Phase 2 D2 — suggested progression hints. Computed only for completed
  // sessions, only for main lifts (defined as "movement_id has a row in
  // training_maxes"). For each main lift in this session, find the top
  // working set, estimate 1RM, and pass through the progression engine.
  // Prescription gives us the rep target; fall back to logged reps when
  // the link isn't present.
  let progressionHints: ProgressionHint[] | undefined;
  if (isComplete && sets.length > 0) {
    const targetRepsByMovementId = new Map<string, number>();
    for (const item of plannedPrescription?.items ?? []) {
      if (item.kind === "main" && typeof item.reps === "number" && item.reps > 0) {
        // First main entry wins per movement — multi-main prescriptions
        // (top + back-off) share the same rep target by design.
        if (!targetRepsByMovementId.has(item.movementId)) {
          targetRepsByMovementId.set(item.movementId, item.reps);
        }
      }
    }
    const topByMovement = new Map<
      string,
      { weight: number; reps: number; rpe: number | null; displayName: string }
    >();
    for (const s of sets) {
      if (s.set_kind === "warmup") continue;
      const tm = tmBySlug[s.movement.slug];
      if (!tm) continue; // not a main lift
      const w = Number(s.weight_kg);
      const r = Number(s.reps);
      if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(r) || r <= 0) continue;
      const rpe = s.rpe == null ? null : Number(s.rpe);
      const cur = topByMovement.get(s.movement.id);
      if (!cur || w > cur.weight || (w === cur.weight && r > cur.reps)) {
        topByMovement.set(s.movement.id, {
          weight: w,
          reps: r,
          rpe: Number.isFinite(rpe as number) ? (rpe as number) : null,
          displayName: s.movement.display_name,
        });
      }
    }
    const hints: ProgressionHint[] = [];
    for (const [movementId, top] of topByMovement) {
      const tmSlug = sets.find((s) => s.movement.id === movementId)?.movement.slug;
      const tm = tmSlug ? tmBySlug[tmSlug] : undefined;
      if (!tm) continue;
      const targetReps = targetRepsByMovementId.get(movementId) ?? top.reps;
      const e1rm = bestEstimateOneRm({ weight: top.weight, reps: top.reps, rpe: top.rpe });
      const sugg = suggestNextWeight({
        lastSet: { weightKg: top.weight, reps: top.reps, rpe: top.rpe },
        targetReps,
        e1rmKg: e1rm,
        trainingMaxKg: tm,
        plateIncrement: 2.5,
        isMainLift: true,
      });
      hints.push({
        movementId,
        movementDisplayName: top.displayName,
        kind: sugg.kind,
        nextWeightKg: sugg.nextWeightKg,
        nextReps: sugg.nextReps,
        rationale: sugg.rationale,
      });
    }
    progressionHints = hints.length > 0 ? hints : undefined;
  }

  // Phase 2 C1 — Strava autofill match. Only relevant when the session
  // is still open (post-completion the cardio is presumably already
  // logged). Silently no-op when the user has no Strava connection or
  // no in-window activity.
  let stravaMatch: StravaAutofillMatch | null = null;
  if (!isComplete) {
    const candidate = await findMatchingStravaActivity(
      supabase,
      user.id,
      session.performed_at,
      { excludeSessionId: id },
    );
    if (candidate) {
      stravaMatch = {
        cardioLogId: candidate.cardioLogId,
        stravaActivityId: candidate.stravaActivityId,
        modality: candidate.modality,
        durationSec: candidate.durationSec,
        distanceKm: candidate.distanceKm,
        avgHrBpm: candidate.avgHrBpm,
      };
    }
  }

  // feat/logging-works — which prescription items have been satisfied
  // by ≥1 logged set, and the canonical set_logs.id for each (so the
  // prescription row can scroll the user to the right "This session"
  // entry). Lifts the new explicit `prescription_item_index` link
  // first, then falls back to movement-based matching for sets logged
  // before the column existed.
  const loggedForMatch = (setsRaw ?? []).map((s) => {
    const m = Array.isArray(s.movement) ? s.movement[0] : s.movement;
    return {
      id: s.id as string,
      movementId: (m?.id as string | undefined) ?? "",
      setKind: s.set_kind as string,
      prescriptionItemIndex: (s.prescription_item_index as number | null) ?? null,
      skipped: (s.skipped as boolean | null) ?? false,
    };
  });
  const { matched: loggedItemIndexSet, skipped: skippedItemIndexSet } =
    matchPrescriptionItemsDetailed(
      plannedPrescription,
      loggedForMatch.map((s) => ({
        movementId: s.movementId,
        setKind: s.setKind,
        prescriptionItemIndex: s.prescriptionItemIndex,
        skipped: s.skipped,
      })),
    );
  const loggedItemIndices = Array.from(loggedItemIndexSet).sort((a, b) => a - b);
  const skippedItemIndices = Array.from(skippedItemIndexSet).sort((a, b) => a - b);
  const loggedSetIdByItemIndex: Record<number, string> = {};
  // Pick the FIRST logged set per matched index (the one the user
  // scrolls back to). Explicit links win; movement-fallback fills the
  // rest, mirroring `matchPrescriptionItems` so the two stay aligned.
  if (plannedPrescription) {
    const claimed = new Set<number>();
    for (const s of loggedForMatch) {
      if (
        s.prescriptionItemIndex != null &&
        s.prescriptionItemIndex >= 0 &&
        s.prescriptionItemIndex < (plannedPrescription.items?.length ?? 0) &&
        !loggedSetIdByItemIndex[s.prescriptionItemIndex]
      ) {
        loggedSetIdByItemIndex[s.prescriptionItemIndex] = s.id;
        claimed.add(s.prescriptionItemIndex);
      }
    }
    for (const s of loggedForMatch) {
      if (s.prescriptionItemIndex != null) continue;
      if (s.setKind === "warmup") continue;
      for (let i = 0; i < (plannedPrescription.items?.length ?? 0); i++) {
        if (claimed.has(i)) continue;
        const it = plannedPrescription.items[i]!;
        if (
          it.movementId === s.movementId &&
          (it.kind === "warmup" ||
            it.kind === "main" ||
            it.kind === "back_off" ||
            it.kind === "accessory" ||
            it.kind === "tendon" ||
            it.kind === "power_potentiation")
        ) {
          claimed.add(i);
          loggedSetIdByItemIndex[i] = s.id;
          break;
        }
      }
    }
  }
  const strengthItemCount = countStrengthPrescriptionItems(plannedPrescription);
  const unloggedStrengthCount = Math.max(0, strengthItemCount - loggedItemIndexSet.size);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {formatDateTime(session.performed_at, feedbackPrefs)}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ fontSize: 26, margin: "4px 0 0", letterSpacing: "-0.01em" }}>
            {session.title ?? "Session"}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isComplete && (
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "color-mix(in oklab, var(--cp-success) 18%, transparent)",
                  color: "var(--cp-success)",
                  fontWeight: 600,
                }}
              >
                completed
              </span>
            )}
            <details className="cp-menu" style={{ position: "relative" }}>
              <summary
                aria-label="More actions"
                title="More actions"
                style={{
                  listStyle: "none",
                  cursor: "pointer",
                  width: 36,
                  height: 36,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  color: "var(--cp-text-muted)",
                  fontSize: 18,
                  fontWeight: 700,
                  userSelect: "none",
                }}
              >
                ⋯
              </summary>
              <div
                role="menu"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 4px)",
                  zIndex: 50,
                  minWidth: 200,
                  background: "var(--cp-surface)",
                  border: "1px solid var(--cp-border)",
                  borderRadius: 10,
                  boxShadow: "var(--cp-shadow, 0 8px 24px rgba(0,0,0,0.18))",
                  padding: 4,
                }}
              >
                <DeleteSessionButton
                  sessionId={session.id}
                  label={session.title || "Session"}
                  redirectTo="/app/sessions"
                  variant="menu"
                />
              </div>
            </details>
          </div>
        </div>
      </header>

      {stravaMatch && (
        <StravaAutofillBanner
          sessionId={id}
          match={stravaMatch}
          applyAction={applyStravaAutofill}
        />
      )}

      {isComplete && summary && (
        <PostSessionSummary
          sessionId={id}
          summary={summary}
          initialNotes={session.notes ?? null}
          progressionHints={progressionHints}
        />
      )}

      {showRecommendation && (
        <section
          role="note"
          className="cp-card"
          style={{
            padding: "12px 16px",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            background: "var(--cp-surface-soft)",
            borderColor: "var(--cp-border)",
          }}
          title="research-v2 §3.4 — Global Recovery Multiplier"
        >
          <div style={{ fontSize: 18, lineHeight: 1, color: "var(--cp-text)" }} aria-hidden="true">
            ⓘ
          </div>
          <div style={{ display: "grid", gap: 4, flex: 1 }}>
            <div style={{ fontSize: 13, color: "var(--cp-text)" }}>
              <strong>Feeling {grmLabel(grm.value)}.</strong>
              <span style={{ color: "var(--cp-text-muted)", marginLeft: 6 }}>
                Recovery multiplier <span className="mono">{grm.value.toFixed(2)}</span>.
                {plannedTopPercent && plannedTopPercent > 0 ? (
                  <>
                    {" "}
                    Top set at{" "}
                    <span className="mono" style={{ color: "var(--cp-text)" }}>
                      ~{applyGrmToPercent(plannedTopPercent, grm.value)}%
                    </span>{" "}
                    instead of {plannedTopPercent}% may be the smarter call today.
                  </>
                ) : (
                  <> Consider pulling back the top-set intensity by ~{Math.round((1 - grm.value) * 100)}%.</>
                )}
              </span>
            </div>
            <div style={{ fontSize: 10, color: "var(--cp-text-muted)", fontStyle: "italic" }}>
              Advisory only — research-v2 §3.4 GRM.
            </div>
          </div>
        </section>
      )}

      {bumpProposal && (
        <section
          className="cp-card"
          style={{
            padding: 18,
            display: "grid",
            gap: 12,
            borderColor: "var(--cp-accent)",
            background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">📈</div>
            <div style={{ display: "grid", gap: 4, flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--cp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                Bump your TM?
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {bumpProposal.movementDisplayName} —{" "}
                <span className="mono">{bumpProposal.currentTm.toFixed(1)} kg</span>{" "}
                →{" "}
                <span className="mono" style={{ color: "var(--cp-accent)" }}>
                  {bumpProposal.proposal.newTm} kg
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                Estimated 1RM from today&apos;s top set:{" "}
                <span className="mono">{bumpProposal.proposal.estimatedOneRm.toFixed(1)} kg</span>. New TM
                is 90% of that, rounded to the nearest plate.
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 4, paddingLeft: 34 }}>
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              Why this fired
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 2 }}>
              {bumpProposal.proposal.reasons.map((r, i) => (
                <li key={i} style={{ fontSize: 12, color: "var(--cp-text-muted)", display: "flex", gap: 6 }}>
                  <span style={{ color: r.points >= 0 ? "var(--cp-success)" : "var(--cp-danger)", fontWeight: 600, minWidth: 30 }}>
                    {r.points >= 0 ? `+${r.points}` : r.points}
                  </span>
                  <span>{r.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ display: "flex", gap: 8, paddingLeft: 34, flexWrap: "wrap" }}>
            <form action={acceptTmBump}>
              <input type="hidden" name="movementId" value={bumpProposal.movementId} />
              <input type="hidden" name="newTmKg" value={String(bumpProposal.proposal.newTm)} />
              <input type="hidden" name="reason" value="amrap_bump" />
              <input type="hidden" name="triggerKey" value={bumpProposal.triggerKey} />
              <input type="hidden" name="sessionId" value={id} />
              <button type="submit" className="cp-btn primary">
                Accept {bumpProposal.proposal.newTm} kg
              </button>
            </form>
            <form action={declineTmBump}>
              <input type="hidden" name="movementId" value={bumpProposal.movementId} />
              <input type="hidden" name="triggerKey" value={bumpProposal.triggerKey} />
              <input type="hidden" name="sessionId" value={id} />
              <button type="submit" className="cp-btn ghost">
                Not now
              </button>
            </form>
          </div>
        </section>
      )}

      {deloadProposal && (
        <section
          className="cp-card"
          style={{
            padding: 18,
            display: "grid",
            gap: 12,
            borderColor: "var(--cp-warning)",
            background: "color-mix(in oklab, var(--cp-warning) 6%, transparent)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">⚠️</div>
            <div style={{ display: "grid", gap: 4, flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--cp-warning)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                Consider deloading
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {deloadProposal.movementDisplayName} —{" "}
                <span className="mono">{deloadProposal.currentTm.toFixed(1)} kg</span>{" "}
                →{" "}
                <span className="mono" style={{ color: "var(--cp-warning)" }}>
                  {deloadProposal.proposedTm.toFixed(1)} kg
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                Two missed AMRAP top sets in a row (and you weren&apos;t cooked either time). Dropping
                the TM 10% rebuilds momentum without grinding through under-recovery.
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 4, paddingLeft: 34 }}>
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              Recent misses
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 2 }}>
              {deloadProposal.missContext.map((m, i) => (
                <li key={i} style={{ fontSize: 12, color: "var(--cp-text-muted)", display: "flex", gap: 8 }}>
                  <span className="mono" style={{ minWidth: 92 }}>
                    {formatDate(m.performedAt, feedbackPrefs)}
                  </span>
                  <span className="mono">
                    {m.weight} kg × {m.performedReps}
                  </span>
                  <span style={{ fontStyle: "italic" }}>(target {m.targetReps}+)</span>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ display: "flex", gap: 8, paddingLeft: 34, flexWrap: "wrap" }}>
            <form action={acceptTmBump}>
              <input type="hidden" name="movementId" value={deloadProposal.movementId} />
              <input type="hidden" name="newTmKg" value={String(deloadProposal.proposedTm)} />
              <input type="hidden" name="reason" value="deload" />
              <input type="hidden" name="triggerKey" value={deloadProposal.triggerKey} />
              <input type="hidden" name="sessionId" value={id} />
              <button type="submit" className="cp-btn primary">
                Drop to {deloadProposal.proposedTm.toFixed(1)} kg
              </button>
            </form>
            <form action={declineTmBump}>
              <input type="hidden" name="movementId" value={deloadProposal.movementId} />
              <input type="hidden" name="triggerKey" value={deloadProposal.triggerKey} />
              <input type="hidden" name="sessionId" value={id} />
              <button type="submit" className="cp-btn ghost">
                Not now
              </button>
            </form>
          </div>
        </section>
      )}

      {prRecalibrateProposals.length > 0 && (
        <section style={{ display: "grid", gap: 10 }}>
          {prRecalibrateProposals.map((p) => (
            <div
              key={`pr-recal:${p.movementId}`}
              className="cp-card"
              style={{
                padding: 18,
                display: "grid",
                gap: 10,
                borderColor: "var(--cp-accent)",
                background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">📈</div>
                <div style={{ display: "grid", gap: 4, flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--cp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                    Recalibrate TM?
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>
                    {p.movementDisplayName} —{" "}
                    <span className="mono">{p.currentTm.toFixed(1)} kg</span>{" "}
                    →{" "}
                    <span className="mono" style={{ color: "var(--cp-accent)" }}>
                      {p.proposedTm.toFixed(1)} kg
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                    Today&apos;s top set (<span className="mono">{p.bestSet.weight} kg × {p.bestSet.reps}</span>
                    {p.bestSet.rpe != null ? <> @ RPE {p.bestSet.rpe}</> : null}) implies an estimated 1RM
                    of <span className="mono">{p.estimatedOneRm.toFixed(1)} kg</span>. Recalibrating the
                    TM keeps future prescriptions honest.
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, paddingLeft: 34, flexWrap: "wrap" }}>
                <form action={acceptTmBump}>
                  <input type="hidden" name="movementId" value={p.movementId} />
                  <input type="hidden" name="newTmKg" value={String(p.proposedTm)} />
                  <input type="hidden" name="reason" value="pr_detection" />
                  <input type="hidden" name="triggerKey" value={p.triggerKey} />
                  <input type="hidden" name="sessionId" value={id} />
                  <button type="submit" className="cp-btn primary">
                    Accept {p.proposedTm.toFixed(1)} kg
                  </button>
                </form>
                <form action={declineTmBump}>
                  <input type="hidden" name="movementId" value={p.movementId} />
                  <input type="hidden" name="triggerKey" value={p.triggerKey} />
                  <input type="hidden" name="sessionId" value={id} />
                  <button type="submit" className="cp-btn ghost">
                    Not now
                  </button>
                </form>
              </div>
            </div>
          ))}
        </section>
      )}

      {session.duration_min != null && (
        <div
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            padding: "6px 0",
          }}
        >
          Duration · <span className="mono">{session.duration_min}m</span>
        </div>
      )}

      {tmAnchoredPrSummaries.length > 0 && (
        <section style={{ display: "grid", gap: 8 }}>
          {tmAnchoredPrSummaries.map((s) =>
            s.hits.map((hit) => (
              <div
                key={`${s.movementId}:${hit.kind}`}
                className="cp-card"
                style={{
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  borderColor: "var(--cp-accent)",
                  background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
                }}
              >
                <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">🏆</div>
                <div style={{ display: "grid", gap: 2, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-text)" }}>
                    {PR_KIND_LABEL[hit.kind]} · {s.movementDisplayName}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                    <span className="mono" style={{ fontWeight: 600, color: "var(--cp-accent)" }}>
                      {formatHitValue({ ...hit, previousBest: null, daysSincePrevious: null }, hit.kind)}
                    </span>
                    <span style={{ marginLeft: 8, fontStyle: "italic" }}>
                      · beats your saved 1RM
                    </span>
                  </div>
                </div>
              </div>
            )),
          )}
        </section>
      )}

      <SessionWorkArea
        sessionId={id}
        isComplete={isComplete}
        performedAt={session.performed_at as string}
        durationMin={(session.duration_min as number | null) ?? null}
        sessionRpe={(session.session_rpe as number | string | null) ?? null}
        sets={sets}
        tmBySlug={tmBySlug}
        oneRmBySlug={oneRmBySlug}
        addStrengthSet={addStrengthSet}
        fillFromPlan={fillSessionFromPlan}
        hapticsEnabled={hapticsEnabled}
        timerSoundEnabled={timerSoundEnabled}
        lastSetHints={lastSetHints}
        priorBests={priorBests}
        plannedSessionId={(planned?.id as string | undefined) ?? null}
        prescription={plannedPrescription}
        swapAction={swapPrescriptionItem}
        loggedItemIndices={loggedItemIndices}
        skippedItemIndices={skippedItemIndices}
        loggedSetIdByItemIndex={loggedSetIdByItemIndex}
        barbellKg={barbellKg}
        trapBarKg={trapBarKg}
        plateInventory={plateInventory}
        bwGateStateByFamily={bwGateStateByFamily}
      />

      {(cardio && cardio.length > 0) || !isComplete ? (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            Cardio <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>({cardio?.length ?? 0})</span>
          </h2>
          {cardio && cardio.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
              {cardio.map((c) => {
                const mov = Array.isArray(c.movement) ? c.movement[0] : c.movement;
                return (
                  <li
                    key={c.id}
                    style={{
                      padding: "10px 0",
                      borderTop: "1px solid var(--cp-border)",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 13,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500 }}>{mov?.display_name ?? c.modality}</div>
                      <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                        {Math.round(c.duration_sec / 60)} min
                        {c.distance_km ? ` · ${c.distance_km} km` : ""}
                        {c.avg_hr_bpm ? ` · HR ${c.avg_hr_bpm}` : ""}
                        {c.rpe ? ` · RPE ${c.rpe}` : ""}
                      </div>
                    </div>
                    {!isComplete && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <Link href={`/app/sessions/${id}/cardio/${c.id}/edit`} style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                          edit
                        </Link>
                        <form action={deleteCardio}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="sessionId" value={id} />
                          <button type="submit" style={{ fontSize: 11, background: "transparent", border: "none", color: "var(--cp-text-muted)", cursor: "pointer", padding: 0 }}>
                            delete
                          </button>
                        </form>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {!isComplete && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--cp-text-muted)", userSelect: "none" }}>
                + add cardio block
              </summary>
              <div style={{ marginTop: 10 }}>
                <AddCardioBlockForm sessionId={id} action={addCardioBlock} />
              </div>
            </details>
          )}
        </section>
      ) : null}

      {!isComplete && (() => {
        // feat/logging-works — relaxed finish gate. The user can finish
        // the session as soon as ≥1 set has been logged; partial
        // sessions are explicitly allowed (call-outs flagged the strict
        // gate as a P1 dead-end). If some prescribed items are still
        // unlogged we surface a count and a "Finish anyway" subtitle so
        // the choice is intentional, not accidental.
        const canFinish = sets.length > 0;
        const partial = canFinish && unloggedStrengthCount > 0;
        const subtitle = !canFinish
          ? "Log at least 1 set to finish."
          : partial
            ? `${unloggedStrengthCount} of ${strengthItemCount} planned sets aren't logged. You can still finish; the session will be marked complete with what you logged. · Finish anyway`
            : null;
        return (
          <FinishSessionBar
            sessionId={id}
            variant="bottom"
            disabled={!canFinish}
            subtitle={subtitle}
            testId="finish-stickybar"
          />
        );
      })()}

      {isComplete && session.notes && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Notes</h3>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--cp-text-muted)", whiteSpace: "pre-wrap" }}>
            {session.notes}
          </p>
        </section>
      )}
    </div>
  );
}
