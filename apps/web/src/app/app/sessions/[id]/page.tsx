import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import {
  addCardioBlock,
  addStrengthSet,
  applyStravaAutofill,
  deleteCardio,
  fillSessionFromPlan,
  finishStravaAppliedSession,
  logCardioSession,
  markExternalCardioComplete,
  swapPrescriptionItem,
} from "@/lib/sessions/actions";
import { DeleteSessionButton } from "@/components/trash/DeleteSessionButton";
import { CancelWorkoutButton } from "@/components/session/CancelWorkoutButton";
import { getTrainingMaxDict } from "@/lib/training-maxes/queries";
import {
  type LoggedSet,
  type LastSetHint,
  type PriorBest,
} from "@/components/session/SessionLogClient";
import { SessionWorkArea } from "@/components/session/SessionWorkArea";
import { CardioPrescriptionList } from "@/components/session/CardioPrescriptionList";
import { CardioLogForm } from "@/components/session/CardioLogForm";
import { AddToWorkout } from "@/components/session/AddToWorkout";
import {
  resolveFreestyleMovements,
  type PersistedFreestyle,
} from "@/lib/sessions/freestyle-resolver";
import { FinishSessionBar } from "@/components/session/FinishSessionBar";
import { PostSessionSummary } from "@/components/session/PostSessionSummary";
import { StravaAutofillBanner, type StravaAutofillMatch } from "@/components/session/StravaAutofillBanner";
import { MODALITY_LABEL } from "@/lib/planner/session-modality";
import { findMatchingStravaActivity } from "@/lib/integrations/strava/match";
import { syncStravaForSession } from "@/lib/integrations/strava/actions";
import { GRM_RECOMMEND_THRESHOLD, applyGrmToPercent, computeGrm, grmLabel } from "@/lib/engine/grm";
import { PR_KIND_LABEL } from "@/lib/engine/pr";
import { bestEstimateOneRm } from "@/lib/engine/one-rm";
import { acceptTmBump, declineTmBump } from "@/lib/engine/tm-bump-actions";
import { findDeloadProposalForSession } from "@/lib/engine/deload";
import { formatDate } from "@/lib/format/datetime";
import { formatHitValue, countSessionTmAnchoredPrs, getSessionTmAnchoredPrSummaries } from "@/lib/stats/pr-queries";
import { findBumpProposalForSession } from "@/lib/stats/bump-proposal";
import { findPrRecalibrateProposals } from "@/lib/stats/pr-recalibrate";
import { getLastSetLogForMovement, getPriorBestsForMovements, summariseSessionSets } from "@/lib/sessions/queries";
import { suggestNextWeight } from "@/lib/progression/suggest-next";
import {
  matchPrescriptionItemsDetailed,
  countStrengthPrescriptionItems,
} from "@/lib/sessions/prescription-progress";
import type { ProgressionHint } from "@/components/session/PostSessionSummary";
import type { Prescription } from "@hta/db";
import { loadBwGateStatesForPrescription } from "@/lib/planner/bw-gate-state-loader";
import { cardioModalityLabel } from "@/lib/session/cardio-modality-label";
import { isEmptyInProgressSession } from "@/lib/sessions/empty-state";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
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
      "haptics_enabled, timer_sound_enabled, barbell_kg, trap_bar_kg, plate_inventory_kg, equipment, timezone, time_format, date_format, units",
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
      "id, set_index, set_kind, weight_kg, reps, duration_sec, distance_m, rpe, notes, prescription_item_index, skipped, skip_reason, created_at, movement:movements(id, slug, display_name, primary_region)",
    )
    .eq("session_id", id)
    .order("set_index", { ascending: true });

  const { data: cardio } = await supabase
    .from("cardio_logs")
    .select(
      "id, block_index, modality, duration_sec, distance_km, avg_hr_bpm, max_hr_bpm, rpe, notes, inferred_kind, inferred_confidence, external_source, movement:movements(id, display_name)",
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

  // Persisted freestyle additions (migration 0059). The server union of
  // (set_logs distinct ∪ session_movements) is computed below in
  // `resolveFreestyleMovements`; the page passes the persisted block
  // through to the client so a refresh keeps mistakenly-added but
  // not-yet-logged cards on screen.
  const { data: sessionMovementsRaw } = await supabase
    .from("session_movements")
    .select(
      "sort_order, added_at, movement:movements(id, slug, display_name, primary_region)",
    )
    .eq("session_id", id)
    .order("sort_order", { ascending: true });

  const persistedFreestyle: PersistedFreestyle[] = (sessionMovementsRaw ?? [])
    .map((row) => {
      const m = Array.isArray(row.movement) ? row.movement[0] : row.movement;
      if (!m?.id) return null;
      return {
        movement: {
          id: m.id as string,
          slug: (m.slug as string) ?? "",
          display_name: (m.display_name as string) ?? "Unknown movement",
          primary_region: (m.primary_region as string) ?? "",
        },
        sortOrder: (row.sort_order as number) ?? 0,
        addedAt:
          (row.added_at as string | null) ?? new Date(0).toISOString(),
      };
    })
    .filter((x): x is PersistedFreestyle => x !== null);

  // Slim set-log projection for the union resolver. Built here (rather
  // than passing `sets` directly) so the resolver stays decoupled from
  // the wider `LoggedSet` shape.
  const setLogSlimForFreestyle = (setsRaw ?? []).map((s) => {
    const m = Array.isArray(s.movement) ? s.movement[0] : s.movement;
    return {
      movement: {
        id: (m?.id as string) ?? "",
        slug: (m?.slug as string) ?? "",
        display_name: (m?.display_name as string) ?? "Unknown movement",
        primary_region: (m?.primary_region as string) ?? "",
      },
      created_at: (s.created_at as string | null) ?? null,
    };
  });

  const tmDict = await getTrainingMaxDict();
  const tmBySlug: Record<string, number> = Object.fromEntries(tmDict.bySlug);
  const oneRmBySlug: Record<string, number> = Object.fromEntries(tmDict.oneRmBySlug);

  const isComplete = !!session.completed_at;
  // "Cancel workout" escape hatch (Fix: in-session header) — show
  // only when the user just opened a fresh session and has logged
  // nothing yet. Any logged set or cardio block (or a completed
  // session) routes through the normal Delete flow instead.
  const isEmptyInProgress = isEmptyInProgressSession({
    completedAt: session.completed_at as string | null,
    setLogCount: sets.length,
    cardioLogCount: cardio?.length ?? 0,
  });

  // Pull the linked planned_session so we can build a contextual GRM
  // recommendation ("top set ~81% instead of 90%").
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, prescription, session_modality, effective_stress_load, week_index")
    .eq("completed_session_id", id)
    .maybeSingle();
  const plannedPrescription = (planned?.prescription as Prescription | null) ?? null;
  const sessionModality = (planned?.session_modality as
    | "pure_strength"
    | "pure_hypertrophy"
    | "pure_z2_aerobic"
    | "pure_hiit"
    | "mixed_modal"
    | "skill_focused"
    | "restorative"
    | null
    | undefined) ?? null;
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
  //
  // Perf audit F11: aggregation pushed into Postgres via the
  // `prior_bests_for_movements` RPC (migration 0054) so we receive one
  // row per movement instead of up to 500 raw set_logs rows.
  let priorBests: Record<string, PriorBest> = {};
  if (relevantMovementIds.size > 0 && !isComplete) {
    priorBests = await getPriorBestsForMovements(
      supabase,
      user.id,
      Array.from(relevantMovementIds),
      session.performed_at,
    );
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

  // Phase 6 — surface up to 2 bodyweight diagnostic signals on the
  // post-session recap. We filter to signals whose `family` matches
  // one of this session's BW prescription items, plus the
  // non-family-specific `cns_overreach_risk` signal which is always
  // relevant. The diagnostics module is read-only of session data
  // and never writes back to bw_progress.
  let bwSessionDiagnostics: import("@/lib/planner/bw-diagnostics").DiagnosticResult[] | undefined;
  if (isComplete) {
    const sessionFamilies = new Set<string>();
    for (const it of plannedPrescription?.items ?? []) {
      if (it.bw?.family) sessionFamilies.add(it.bw.family);
    }
    if (sessionFamilies.size > 0) {
      const { loadAndRunBwDiagnostics } = await import(
        "@/lib/planner/bw-diagnostics-loader"
      );
      const all = await loadAndRunBwDiagnostics({ supabase, userId: user.id });
      const filtered = all.filter((d) => {
        if (d.signal.kind === "cns_overreach_risk") return true;
        const fam = (d.signal as { family?: string }).family;
        return fam != null && sessionFamilies.has(fam);
      });
      bwSessionDiagnostics = filtered.length > 0 ? filtered.slice(0, 2) : undefined;
    }
  }

  // Phase 2 C1 — Strava autofill match. Only relevant when the session
  // is still open (post-completion the cardio is presumably already
  // logged). Silently no-op when the user has no Strava connection or
  // no in-window activity.
  let stravaMatch: StravaAutofillMatch | null = null;
  let stravaConnected = false;
  let stravaLastSyncedAt: string | null = null;
  {
    const { data: connRow } = await supabase
      .from("strava_connections")
      .select("user_id, last_synced_at")
      .eq("user_id", user.id)
      .maybeSingle();
    stravaConnected = !!connRow;
    stravaLastSyncedAt =
      (connRow?.last_synced_at as string | null | undefined) ?? null;
  }
  if (!isComplete && stravaConnected) {
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

  // Cardio modality / log form wiring. A session is "cardio-aware"
  // when any prescription item is a cardio kind; "pure cardio" when
  // ALL prescription items are cardio. Pure-cardio sessions render
  // the new CardioLogForm in place of the strength-only "Log at
  // least 1 set" gate; hybrid sessions render BOTH the existing
  // strength UI AND the cardio form below it so the user can finish
  // either path.
  const cardioPrescriptionItems = (plannedPrescription?.items ?? []).filter(
    (it) => it.kind.startsWith("cardio_") && it.kind !== "cardio_external",
  );
  const firstCardioPrescription = cardioPrescriptionItems[0] ?? null;
  const hasLoggedCardioRow = (cardio ?? []).length > 0;
  const hasCardio = cardioPrescriptionItems.length > 0;
  const hasStrengthPrescription = strengthItemCount > 0;
  const isPureCardio = hasCardio && !hasStrengthPrescription;
  const showCardioLogForm =
    hasCardio && !isComplete && !hasLoggedCardioRow;
  const userUnits: "metric" | "imperial" =
    feedbackPrefs?.units === "imperial" ? "imperial" : "metric";

  // Fix 4 — surface the planned cardio implementing modality (Run /
  // Bike / Row / Ski erg / …) next to the movement title in the
  // CardioCard header. Load the movement metadata + slug for every
  // cardio prescription item in a single query so the chip can render
  // server-side without an extra round-trip per row.
  const cardioMovementIds = Array.from(
    new Set(
      (plannedPrescription?.items ?? [])
        .filter(
          (it) => it.kind.startsWith("cardio_") && it.kind !== "cardio_external",
        )
        .map((it) => it.movementId)
        .filter((m): m is string => !!m),
    ),
  );
  const cardioModalityByMovementId: Record<string, string | null> = {};
  if (cardioMovementIds.length > 0) {
    const { data: cardioMovements } = await supabase
      .from("movements")
      .select("id, slug, metadata")
      .in("id", cardioMovementIds);
    for (const row of cardioMovements ?? []) {
      const meta = (row as { metadata?: Record<string, unknown> | null })
        .metadata;
      const slug = (row as { slug?: string | null }).slug ?? null;
      cardioModalityByMovementId[row.id as string] = cardioModalityLabel(
        meta,
        slug,
      );
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        {/* Single crumb row — e.g. "29 MAY · ENDURANCE · WK 1". Replaces
            the older 2-row header that duplicated the date as both a
            chip eyebrow and a stand-alone metadata strip. */}
        {(() => {
          const datePart = formatDate(session.performed_at, feedbackPrefs);
          const modalityPart = sessionModality
            ? MODALITY_LABEL[sessionModality].toUpperCase()
            : null;
          const weekIdx = (planned?.week_index as number | null | undefined) ?? null;
          const weekPart = weekIdx != null ? `WK ${weekIdx + 1}` : null;
          const crumb = [datePart.toUpperCase(), modalityPart, weekPart]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              data-testid="session-crumb"
              style={{
                fontSize: 12,
                color: "var(--cp-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {crumb}
            </div>
          );
        })()}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ fontSize: 26, margin: "4px 0 0", letterSpacing: "-0.01em" }}>
            {session.title ?? "Session"}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                {isEmptyInProgress ? (
                  <CancelWorkoutButton
                    sessionId={session.id}
                    redirectTo="/app"
                  />
                ) : (
                  <DeleteSessionButton
                    sessionId={session.id}
                    label={session.title || "Session"}
                    redirectTo="/app/sessions"
                    variant="menu"
                  />
                )}
              </div>
            </details>
          </div>
        </div>
      </header>

      {!isComplete && stravaConnected && (
        <StravaAutofillBanner
          sessionId={id}
          match={stravaMatch}
          applyAction={applyStravaAutofill}
          syncAction={async () => syncStravaForSession(id)}
          lastSyncedAt={stravaLastSyncedAt}
        />
      )}

      {isComplete && summary && (
        <PostSessionSummary
          sessionId={id}
          summary={summary}
          initialNotes={session.notes ?? null}
          progressionHints={progressionHints}
          bwDiagnostics={bwSessionDiagnostics}
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
        resolvedFreestyle={resolveFreestyleMovements({
          persisted: persistedFreestyle,
          sets: setLogSlimForFreestyle,
          prescribedMovementIds: new Set(
            (plannedPrescription?.items ?? [])
              .map((item) => item.movementId)
              .filter((m): m is string => !!m),
          ),
        })}
      />

      {(() => {
        // Cardio prescription items live in the same `prescription.items`
        // array as strength items but are filtered out of the per-movement
        // card grid (see `movement-grouping.ts`). Surface them here so
        // cardio days actually render their planned Z2 / VO2 / alactic
        // blocks instead of looking like an empty session card.
        //
        // Dedup: when the user has already logged a cardio block matching
        // a prescribed movement, render only the log (the prescription
        // becomes redundant). Match on movement_id; fall back to showing
        // both if either side is missing the id.
        const allCardioItemsIndexed =
          plannedPrescription?.items
            ?.map((it, itemIndex) => ({ it, itemIndex }))
            .filter(({ it }) => it.kind.startsWith("cardio_")) ?? [];
        const loggedMovementIds = new Set(
          (cardio ?? [])
            .map((c) => {
              const mov = Array.isArray(c.movement) ? c.movement[0] : c.movement;
              return mov?.id ?? null;
            })
            .filter((id): id is string => !!id),
        );
        const cardioItemsIndexed = allCardioItemsIndexed.filter(
          ({ it }) => !it.movementId || !loggedMovementIds.has(it.movementId),
        );
        const hasLoggedCardio = !!(cardio && cardio.length > 0);
        const showCardioSection = hasLoggedCardio || cardioItemsIndexed.length > 0 || !isComplete;
        if (!showCardioSection) return null;
        return (
        <section
          data-testid="cardio-section"
          className="cp-card"
          style={{ padding: 20, display: "grid", gap: 14 }}
        >
          {cardioItemsIndexed.length > 0 && (
            <CardioPrescriptionList
              plannedSessionId={(planned?.id as string | undefined) ?? null}
              pageTitle={session.title ?? null}
              items={cardioItemsIndexed.map(({ it, itemIndex }) => {
                // Phase 2 — surface the inferred classification on
                // cardio_external rows. Match by external_source +
                // inferred_kind on the cardio_logs we already loaded
                // for this session.
                let classification = null as
                  | {
                      label: string;
                      reason: string;
                      confidence: number;
                      effectiveStressLoad?: number | null;
                    }
                  | null;
                if (it.kind === "cardio_external") {
                  const log = (cardio ?? []).find(
                    (c) => (c as { inferred_kind?: string | null }).inferred_kind != null,
                  ) as
                    | {
                        inferred_kind?: string | null;
                        inferred_confidence?: string | number | null;
                        avg_hr_bpm?: number | null;
                        max_hr_bpm?: number | null;
                        duration_sec?: number | null;
                        external_source?: string | null;
                      }
                    | undefined;
                  if (log?.inferred_kind) {
                    const labelMap: Record<string, string> = {
                      cardio_z2: "Easy Z2",
                      cardio_threshold: "Threshold",
                      cardio_vo2: "VO2 intervals",
                      cardio_alactic: "Sprint / alactic",
                      cardio_mixed: "Mixed intensity",
                    };
                    const durationMin = Math.round((log.duration_sec ?? 0) / 60);
                    const reasonParts: string[] = [];
                    if (log.avg_hr_bpm != null) reasonParts.push(`avg ${log.avg_hr_bpm} bpm`);
                    if (log.max_hr_bpm != null) reasonParts.push(`max ${log.max_hr_bpm} bpm`);
                    const reason = reasonParts.length > 0
                      ? `${reasonParts.join(", ")} over ${durationMin} min`
                      : `${durationMin} min`;
                    const confNum = log.inferred_confidence == null
                      ? 0
                      : typeof log.inferred_confidence === "number"
                        ? log.inferred_confidence
                        : Number(log.inferred_confidence);
                    classification = {
                      label: labelMap[log.inferred_kind] ?? log.inferred_kind,
                      reason,
                      confidence: confNum,
                      effectiveStressLoad:
                        (planned as { effective_stress_load?: string | number | null } | null)
                          ?.effective_stress_load == null
                          ? null
                          : Number((planned as { effective_stress_load?: string | number }).effective_stress_load),
                    };
                  }
                }
                const modalityLabel = it.movementId
                  ? cardioModalityByMovementId[it.movementId] ?? null
                  : null;
                return { item: it, itemIndex, classification, modalityLabel };
              })}
              ownedCardio={equipment.cardio}
              swapAction={swapPrescriptionItem}
              isReadOnly={isComplete}
              markExternalCompleteAction={markExternalCardioComplete}
            />
          )}
          {hasLoggedCardio && (
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
              {cardio!.map((c) => {
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginLeft: "auto",
                        }}
                      >
                        <Link
                          href={`/app/sessions/${id}/cardio/${c.id}/edit`}
                          data-testid={`cardio-prescription-edit-${c.id}`}
                          style={{
                            fontSize: 11,
                            fontWeight: 500,
                            color: "var(--cp-link)",
                            lineHeight: 1,
                            textDecoration: "none",
                          }}
                        >
                          edit
                        </Link>
                        <form action={deleteCardio} style={{ display: "inline-flex", alignItems: "center" }}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="sessionId" value={id} />
                          <button
                            type="submit"
                            data-testid={`cardio-prescription-delete-${c.id}`}
                            style={{
                              fontSize: 11,
                              fontWeight: 500,
                              background: "transparent",
                              border: "none",
                              color: "var(--cp-link)",
                              cursor: "pointer",
                              padding: 0,
                              lineHeight: 1,
                              font: "inherit",
                            }}
                          >
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
          {showCardioLogForm && (
            <div style={{ marginTop: 14 }}>
              <CardioLogForm
                sessionId={id}
                prescribedDurationMin={firstCardioPrescription?.durationMin ?? null}
                movementId={firstCardioPrescription?.movementId ?? null}
                modality={
                  (firstCardioPrescription?.movementId
                    ? cardioModalityByMovementId[firstCardioPrescription.movementId] ?? null
                    : null)
                    ?.toLowerCase()
                    ?.replace(/\s+/g, "_") ?? "other"
                }
                units={userUnits}
                action={logCardioSession}
                stravaApplied={
                  Array.isArray(cardio) &&
                  cardio[0]?.external_source === "strava"
                }
                stravaFinishAction={finishStravaAppliedSession}
              />
            </div>
          )}
        </section>
        );
      })()}

      {/* AddToWorkout (issue #210) replaces three historical surfaces:
            - the per-section "+ add cardio block" disclosure that used
              to live inside the cardio section (with AddCardioBlockForm)
            - the pure-cardio-only "+ Add off-plan movement" pill
            - implicit "no strength entry" gap on cardio-only sessions
          One unified pill at the bottom of the page handles them all. */}
      {!isComplete && (
        <AddToWorkout sessionId={id} cardioAction={addCardioBlock} />
      )}

      {!isComplete && !isPureCardio && (() => {
        // feat/logging-works — relaxed finish gate. The user can finish
        // the session as soon as ≥1 set has been logged; partial
        // sessions are explicitly allowed (call-outs flagged the strict
        // gate as a P1 dead-end). If some prescribed items are still
        // unlogged we surface a count and a "Finish anyway" subtitle so
        // the choice is intentional, not accidental.
        //
        // For pure-cardio sessions the cardio log form above owns the
        // "Finish workout →" CTA, so we skip the strength-flavoured
        // bottom bar entirely.
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
