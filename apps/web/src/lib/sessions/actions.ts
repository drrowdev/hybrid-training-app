"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { type WeightUnit, toKg } from "@/lib/stats/units";
import { recomputeRegionState } from "@/lib/engine/region-ledger";
import { maybeCompleteBlock } from "@/lib/planner/completion";
import { expandPrescriptionSetItems } from "@/lib/planner/expand-prescription-sets";
import { getUserTimezone, dayDate } from "@/lib/planner/queries";
import { roundToPlate } from "@/lib/planner/archetypes";
import { roundWarmupLoadKg } from "@/lib/planner/warmups";
import { resolveQuickStrengthPlan } from "@/lib/planner/quick-generate-resolve";
import { resolveQuickHyroxPlan } from "@/lib/planner/quick-hyrox-resolve";
import type { HyroxQuickStation } from "@/lib/planner/quick-hyrox";
import type { QuickLength } from "@/lib/planner/quick-generate";
import { TM_RESOLUTION_SELECT } from "@/lib/training-maxes/columns";
import { applyAutoregVolumeScale } from "@/lib/planner/autoreg-volume";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import {
  applyModificationsToPrescription,
  getActiveModifications,
} from "@/lib/planner/modifications";
import {
  planMissingPrescriptionSets,
  plannedSetClientId,
  type ExistingPlannedSet,
  type PlannedSetKind,
} from "./fill-plan-sets";
import {
  isSystemLoadMovementSlug,
  repairLegacySystemLoadWarmups,
  resolvePrescriptionSetWork,
  resolvePrescribedSnapshot,
  resolveTargetLoadKg,
  validateSubmittedTarget,
} from "@hta/domain";
import type { Prescription, PrescriptionItem, PrescribedSnapshot } from "@hta/db";
import { isSystemLoadItem, loadSystemLoadMovementIds } from "./system-load";
import { legacyWarmupRampFractions } from "./legacy-warmup-ramp";
import { loggedSetKindForItemKind } from "./set-kind";
import { recomputeAfterCompletedSessionMutation } from "./post-completion-recompute";
import { resolveBarWeightKg } from "./bar-kind";
import { applyPrescriptionSwap } from "./prescription-mutations";
import { recordOverrideEvent } from "@/lib/engine/overrides";
import {
  prescriptionItemsHaveStrength,
  sessionPrescribesStrength,
} from "./strength-prescribed";

const startAdHocSchema = z.object({
  title: z.string().trim().max(120).optional(),
});

/**
 * Create a new ad-hoc session and redirect to its detail page.
 *
 * The pre-session fatigue + soreness interstitial was removed — the
 * follow-up Today-page wellness check-in card has since also been
 * retired (see chore/retire-wellness-checkin). The `wellness` table
 * and `recordDailyCheckIn` action still exist for the bodyweight
 * nudge and any future re-introduction. This action only collects an
 * optional title; everything else is logged on the session detail
 * surface.
 */
export async function startSession(formData: FormData): Promise<void> {
  const parsed = startAdHocSchema.safeParse({
    title: formData.get("title") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      title: parsed.data.title ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/app");
  redirect(`/app/sessions/${data.id}`);
}

const setSchema = z.object({
  sessionId: z.string().uuid(),
  movementId: z.string().uuid(),
  setKind: z.enum(["warmup", "main", "back_off", "accessory", "tendon"]).default("main"),
  weightKg: z.coerce.number().min(0).max(1000).optional().nullable(),
  reps: z.coerce.number().int().min(0).max(500).optional().nullable(),
  durationSec: z.coerce.number().int().min(0).max(7200).optional().nullable(),
  distanceM: z.coerce.number().int().min(0).max(50000).optional().nullable(),
  rpe: z.coerce.number().min(0).max(10).optional().nullable(),
  notes: z.string().trim().max(400).optional().nullable(),
  // Index into the linked planned_session.prescription.items array
  // when this set was logged via a prescription row click. The session
  // detail page uses this to paint a per-item ✓ check. Free-form logs
  // (picker, "+ add movement") leave it null.
  prescriptionItemIndex: z.coerce.number().int().min(0).max(500).optional().nullable(),
  // Per-set skip surface (migration 0037). When `skipped` is true the
  // row is persisted with weight 0 / reps 0 / no rpe and is treated as
  // "no work" by every tonnage-summing engine helper.
  skipped: z.coerce.boolean().optional(),
  skipReason: z
    .enum(["pain", "fatigue", "time", "equipment", "other"])
    .optional()
    .nullable(),
  // Phase 7 — actual external load (kg) applied on a loaded BW set.
  // Optional; missing/zero means bodyweight only. Negative = band assist.
  externalLoadKg: z.coerce.number().min(-100).max(200).optional().nullable(),
  loadSource: z
    .enum(["weighted_vest", "dip_belt", "ankle_weights", "band_assist"])
    .optional()
    .nullable(),
  // Offline-logging idempotency key (migration 0097). Client-generated UUID set
  // on the outbox path so a retried flush can't double-insert. Absent on the
  // regular online path → byte-identical behaviour.
  clientLogId: z.string().uuid().optional().nullable(),
  // ADR 0070 — the prescribed values the user actually SAW for this set. Sent
  // by the client rather than re-derived here on purpose: re-resolving at
  // insert time reads *current* TM / taper / prescription state, which after an
  // offline replay or a mid-block TM change is not what was on screen. The
  // server validates these against the linked prescription (see
  // `validateSubmittedTarget`) and stores NULL when it can't corroborate them.
  // Absent on free-form logs and legacy clients → NULL, meaning "unknown".
  targetWeightKg: z.coerce.number().min(0).max(1000).optional().nullable(),
  targetReps: z.coerce.number().int().min(0).max(500).optional().nullable(),
});

export type AddStrengthSetResult = {
  error?: string;
  ok?: true;
  /**
   * The persisted row, returned so the client optimistic overlay can hold the
   * REAL id (for the edit link) without waiting for a full page revalidation.
   * Present only on a successful insert.
   */
  set?: {
    id: string;
    movementId: string;
    prescriptionItemIndex: number | null;
    setKind: string;
    skipped: boolean;
  };
  /**
   * Updated bodyweight TUT for the affected family (when the logged set was a BW
   * prescription). Lets the client refresh the "Next:" chip counter without a
   * full revalidation.
   */
  bwTut?: { family: string; tutAccumulated: number };
};

/**
 * ADR 0070 — resolve the prescribed snapshot for one logged set.
 *
 * The client submits what it displayed; this corroborates it against the linked
 * prescription and returns the SUBMITTED values when they agree (they are what
 * the user actually saw — the whole point) or NULL when they can't be trusted.
 *
 * Guards, in order:
 *   1. No prescription link → free-form log, no snapshot, ZERO extra queries.
 *   2. Index must resolve to an item whose movement AND set kind match the row
 *      being logged. `prescription_item_index` addresses a transformed array
 *      (autoreg trim + taper/recovery reorder), so a stale index can otherwise
 *      point at a different movement. Identity mismatch → NULL, not a guess.
 *   3. Numeric targets must be within tolerance of what the item implies.
 *
 * Never throws: a snapshot failure must never stop the actual set being logged.
 */
async function resolveSetSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    sessionId: string;
    movementId: string;
    prescriptionItemIndex: number | null;
    setKind: string;
    submittedWeightKg: number | null;
    submittedReps: number | null;
  },
): Promise<{
  targetWeightKg: number | null;
  targetReps: number | null;
  prescribed: PrescribedSnapshot | null;
}> {
  const empty = { targetWeightKg: null, targetReps: null, prescribed: null };
  const { prescriptionItemIndex: idx } = args;
  if (idx == null) return empty;

  try {
    const { data: planned } = await supabase
      .from("planned_sessions")
      .select("prescription")
      .eq("completed_session_id", args.sessionId)
      .maybeSingle();
    const items = (planned?.prescription as Prescription | null)?.items ?? [];
    let item = items[idx];
    if (!item) return empty;

    // Identity guard — the index must still address the slot being logged.
    if (item.movementId && item.movementId !== args.movementId) return empty;
    if (loggedSetKindForItemKind(item.kind) !== args.setKind) return empty;

    // Independently derive what this item implies, so submitted values can be
    // corroborated. `tmKg` is only needed for percentage-based loads, but a
    // legacy system-load WARM-UP carries only an absolute target and still has
    // to be reinterpreted — without the bodyweight the server would expect the
    // uncorrected number and reject the corrected one the logger showed.
    let tmKg: number | null = null;
    let bodyweightKg: number | null = null;
    let isSystemLoad = item.systemLoad === true;
    const hasPercent = typeof item.percentTm === "number";
    const hasAbsolute =
      typeof item.targetWeightKg === "number" && Number.isFinite(item.targetWeightKg);
    if ((hasPercent || hasAbsolute) && item.movementId) {
      const [tmRes, profileRes, movementRes] = await Promise.all([
        supabase
          .from("training_maxes")
          .select(TM_RESOLUTION_SELECT)
          .eq("movement_id", item.movementId)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("tm_percent_default, bodyweight_kg, warmup_scheme")
          .maybeSingle(),
        supabase
          .from("movements")
          .select("slug")
          .eq("id", item.movementId)
          .maybeSingle(),
      ]);
      const tmRow = tmRes.data as {
        one_rm_kg?: number | string | null;
        tm_percent?: number | string | null;
      } | null;
      const oneRm = Number(tmRow?.one_rm_kg);
      if (Number.isFinite(oneRm) && oneRm > 0) {
        const pct = Number(
          tmRow?.tm_percent ?? profileRes.data?.tm_percent_default ?? 90,
        );
        // Rounded, matching `getTrainingMaxContext` — the working max the live
        // logger resolves against. An unrounded max here disagreed with the
        // logger by a plate, which the bodyweight subtraction on a system-load
        // movement then magnifies into a rejected target.
        tmKg = roundToPlate((oneRm * pct) / 100);
      }
      const bw = Number(profileRes.data?.bodyweight_kg);
      bodyweightKg = Number.isFinite(bw) && bw > 0 ? bw : null;
      // The catalog decides for any movement it knows. A stale `systemLoad`
      // marker survives on items materialised while `body_weight_loaded` stood
      // in for this question, and honouring it subtracts bodyweight from an
      // ordinary lift.
      const slug = (movementRes.data as { slug?: string | null } | null)?.slug ?? null;
      if (slug != null) {
        isSystemLoad = isSystemLoadMovementSlug(slug);
      }
      // Same restatement the logger and the fill apply, so the server expects
      // the corrected number rather than rejecting it as a deviation.
      if (slug != null && !isSystemLoad) {
        const repaired = repairLegacySystemLoadWarmups(items, {
          isSystemLoadMovement: (movementId) =>
            movementId === item.movementId ? false : undefined,
          bodyweightKg,
          trainingMaxKg: () => tmKg,
          rampFractions: legacyWarmupRampFractions(profileRes.data?.warmup_scheme),
        });
        item = repaired[idx] ?? item;
      }
    }

    const expected = resolvePrescribedSnapshot(item, {
      tmKg,
      basis: item.intensityLabel?.includes("1RM") ? "1RM" : "TM",
      ...(isSystemLoad ? { isSystemLoad: true } : {}),
      bodyweightKg,
      roundToPlate,
      setKind: args.setKind,
    });

    return {
      targetWeightKg: validateSubmittedTarget(
        args.submittedWeightKg,
        expected.targetWeightKg,
      ),
      targetReps: validateSubmittedTarget(args.submittedReps, expected.targetReps),
      prescribed: expected.prescribed,
    };
  } catch {
    // Snapshot resolution is best-effort — never block the log.
    return empty;
  }
}

export async function addStrengthSet(
  formData: FormData,
): Promise<AddStrengthSetResult> {
  const parsed = setSchema.safeParse({
    sessionId: formData.get("sessionId"),
    movementId: formData.get("movementId"),
    setKind: formData.get("setKind") || "main",
    weightKg: formData.get("weightKg") || undefined,
    reps: formData.get("reps") || undefined,
    durationSec: formData.get("durationSec") || undefined,
    distanceM: formData.get("distanceM") || undefined,
    rpe: formData.get("rpe") || undefined,
    notes: formData.get("notes") || undefined,
    prescriptionItemIndex: formData.get("prescriptionItemIndex") ?? undefined,
    skipped: formData.get("skipped") ?? undefined,
    skipReason: formData.get("skipReason") || undefined,
    externalLoadKg: formData.get("externalLoadKg") ?? undefined,
    loadSource: formData.get("loadSource") || undefined,
    clientLogId: formData.get("clientLogId") || undefined,
    targetWeightKg: formData.get("targetWeightKg") ?? undefined,
    targetReps: formData.get("targetReps") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const isSkipped = parsed.data.skipped === true;
  if (isSkipped && !parsed.data.skipReason) {
    return { error: "Pick a reason before skipping." };
  }

  const { reps, durationSec, distanceM } = parsed.data;
  if (!isSkipped && !reps && !durationSec && !distanceM) {
    return { error: "Log at least reps, a hold duration, or a distance." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const clientLogId = parsed.data.clientLogId ?? null;

  // ADR 0070 — resolve the prescribed snapshot for this set.
  //
  // The CLIENT is authoritative on the numbers (it rendered them); the server's
  // job is corroboration, not derivation. We look up the linked prescription
  // item, independently compute what it implies, and keep the submitted value
  // only when the two agree within tolerance. A mismatch stores NULL rather
  // than the server's own figure — "we don't know what was shown" is the honest
  // record, and a fabricated target would manufacture a false deviation.
  //
  // Wrapped so any failure here can NEVER block logging the actual set.
  const snapshot = await resolveSetSnapshot(supabase, {
    sessionId: parsed.data.sessionId,
    movementId: parsed.data.movementId,
    prescriptionItemIndex: parsed.data.prescriptionItemIndex ?? null,
    setKind: parsed.data.setKind,
    submittedWeightKg: parsed.data.targetWeightKg ?? null,
    submittedReps: parsed.data.targetReps ?? null,
  });

  const insertPayload = {
    session_id: parsed.data.sessionId,
    movement_id: parsed.data.movementId,
    set_kind: parsed.data.setKind,
    // Skipped rows always persist as 0 / 0 / null rpe — every engine
    // helper either ignores them (.eq('skipped', false)) or treats
    // the zero weight as a no-op.
    weight_kg: isSkipped ? 0 : (parsed.data.weightKg ?? null),
    reps: isSkipped ? 0 : (parsed.data.reps ?? null),
    duration_sec: isSkipped ? null : (parsed.data.durationSec ?? null),
    distance_m: isSkipped ? null : (parsed.data.distanceM ?? null),
    rpe: isSkipped ? null : (parsed.data.rpe ?? null),
    notes: parsed.data.notes ?? null,
    prescription_item_index: parsed.data.prescriptionItemIndex ?? null,
    skipped: isSkipped,
    skip_reason: isSkipped ? (parsed.data.skipReason ?? null) : null,
    client_log_id: clientLogId,
    // Snapshot is kept even on a SKIP: a skipped set is a deviation whose
    // magnitude is exactly "the whole prescribed set" — the most informative
    // row for autoregulation, not the least.
    target_weight_kg: snapshot.targetWeightKg,
    target_reps: snapshot.targetReps,
    prescribed: snapshot.prescribed,
  };

  // Insert the row. When the client supplies a `client_log_id` (offline outbox
  // replay), a retried flush of an already-persisted set must NOT double-insert
  // or re-run the BW side-effects. We insert and treat a unique-violation on
  // client_log_id (Postgres 23505) as an idempotent success, returning the
  // existing row's id and skipping the side-effects.
  const { data: inserted, error } = await supabase
    .from("set_logs")
    .insert(insertPayload)
    // Return the persisted id so the client overlay can hold the REAL set id
    // (for the edit link) without waiting on a full page revalidation.
    .select("id")
    .single();

  let isNewRow = true;
  let rowId: string | undefined = inserted?.id as string | undefined;

  if (error) {
    if (clientLogId && (error as { code?: string }).code === "23505") {
      // Duplicate replay — fetch the row already persisted under this key.
      const { data: existing } = await supabase
        .from("set_logs")
        .select("id")
        .eq("client_log_id", clientLogId)
        .maybeSingle();
      if (!existing) return { error: error.message };
      rowId = existing.id as string;
      isNewRow = false;
    } else {
      return { error: error.message };
    }
  }
  if (!rowId) return { error: "Insert failed" };

  // Bodyweight Phase 4 — accumulate TUT + clean_rep_history when the
  // logged set was prescribed via a BW main-lift item. Failures here
  // must never block the logging UI. Skipped on a duplicate replay so the
  // TUT counter isn't double-incremented.
  let bwTut: { family: string; tutAccumulated: number } | undefined;
  try {
    if (
      isNewRow &&
      !isSkipped &&
      parsed.data.prescriptionItemIndex != null
    ) {
      const { data: planned, error: plannedError } = await supabase
        .from("planned_sessions")
        .select("prescription")
        .eq("completed_session_id", parsed.data.sessionId)
        .maybeSingle();
      if (plannedError) throw new Error(plannedError.message);
      const items =
        (planned?.prescription as { items?: PrescriptionItem[] } | null)
          ?.items ?? [];
      const item = items[parsed.data.prescriptionItemIndex];
      if (item?.bw) {
        const { applyBwSetSideEffects } = await import(
          "@/lib/sessions/bw-set-logging"
        );
        const rpe = parsed.data.rpe ?? null;
        const rir = rpe != null ? Math.max(0, 10 - rpe) : 2;
        const tutResult = await applyBwSetSideEffects({
          supabase,
          userId: user.id,
          bw: item.bw,
          actualReps: parsed.data.reps ?? null,
          actualSeconds: parsed.data.durationSec ?? null,
          rir,
          cleanForm: rir >= 1,
          setDateIso: new Date().toISOString(),
          skipped: false,
          externalLoadKg: parsed.data.externalLoadKg ?? null,
        });
        bwTut = tutResult ?? undefined;
      }
    }
  } catch (e) {
    console.error("applyBwSetSideEffects failed:", e);
  }

  // A set added to an ALREADY-COMPLETED session (the drawer's ✎ Edit → full
  // session view → "＋ Add a set" flow) has to re-stamp the derived state that
  // was frozen at completion: the actual-ESL stamp and the region ledger. The
  // helper gates itself on `completed_at`, so an in-flight session pays exactly
  // one indexed `sessions` lookup and nothing else — the live-logging hot path
  // below is unchanged. Skipped on a duplicate offline replay (no new row, so
  // nothing derived moved).
  let postCompletionRecompute = false;
  if (isNewRow) {
    try {
      const { recomputed } = await recomputeAfterCompletedSessionMutation({
        supabase,
        sessionId: parsed.data.sessionId,
        userId: user.id,
      });
      postCompletionRecompute = recomputed;
    } catch (e) {
      console.error("post-completion recompute (addStrengthSet) failed:", e);
    }
  }

  // NOTE: intentionally NO `revalidatePath` on the LIVE-session path. The client
  // holds an optimistic overlay of the session's logged sets (with the real id
  // returned below), so a per-set full-page rebuild is wasted work — it re-ran
  // ~15 queries just to record one row. The overlay is the source of truth
  // during the session; the server snapshot refreshes (and the overlay
  // reconciles) at the meaningful points that still revalidate: finish,
  // fill-from-plan, swap, edit, delete, or a navigation/reload. See
  // lib/sessions/optimistic-log.ts + SessionWorkArea.
  //
  // A post-completion add is the opposite case: it is a rare, deliberate write
  // with NO overlay (the overlay only covers prescription-linked logs), and the
  // recompute above just moved `planned_sessions.effective_stress_load`, which
  // Today and Plan both read. Revalidate those.
  if (postCompletionRecompute) {
    revalidatePath("/app");
    revalidatePath("/app/plan");
    revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  }

  return {
    ok: true,
    set: {
      id: rowId,
      movementId: parsed.data.movementId,
      prescriptionItemIndex: parsed.data.prescriptionItemIndex ?? null,
      setKind: parsed.data.setKind,
      skipped: isSkipped,
    },
    ...(bwTut ? { bwTut } : {}),
  };
}

const cardioSchema = z.object({
  sessionId: z.string().uuid(),
  movementId: z.string().uuid().optional().nullable(),
  modality: z.string().trim().min(1).max(40),
  durationSec: z.coerce.number().int().min(1).max(36000),
  distanceKm: z.coerce.number().min(0).max(1000).optional().nullable(),
  avgHrBpm: z.coerce.number().int().min(30).max(240).optional().nullable(),
  avgPaceSecPerKm: z.coerce.number().int().min(60).max(2000).optional().nullable(),
  rpe: z.coerce.number().min(0).max(10).optional().nullable(),
  notes: z.string().trim().max(400).optional().nullable(),
  clientLogId: z.string().uuid().optional().nullable(),
});

export async function addCardioBlock(
  formData: FormData,
): Promise<{ error?: string; ok?: true }> {
  const parsed = cardioSchema.safeParse({
    sessionId: formData.get("sessionId"),
    movementId: formData.get("movementId") || undefined,
    modality: formData.get("modality") || "other",
    durationSec: formData.get("durationSec"),
    distanceKm: formData.get("distanceKm") || undefined,
    avgHrBpm: formData.get("avgHrBpm") || undefined,
    avgPaceSecPerKm: formData.get("avgPaceSecPerKm") || undefined,
    rpe: formData.get("rpe") || undefined,
    notes: formData.get("notes") || undefined,
    clientLogId: formData.get("clientLogId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const { count } = await supabase
    .from("cardio_logs")
    .select("id", { count: "exact", head: true })
    .eq("session_id", parsed.data.sessionId);

  const clientLogId = parsed.data.clientLogId ?? null;
  const { error } = await supabase.from("cardio_logs").insert({
    session_id: parsed.data.sessionId,
    movement_id: parsed.data.movementId ?? null,
    block_index: count ?? 0,
    modality: parsed.data.modality,
    duration_sec: parsed.data.durationSec,
    distance_km: parsed.data.distanceKm ?? null,
    avg_hr_bpm: parsed.data.avgHrBpm ?? null,
    avg_pace_sec_per_km: parsed.data.avgPaceSecPerKm ?? null,
    rpe: parsed.data.rpe ?? null,
    notes: parsed.data.notes ?? null,
    client_log_id: clientLogId,
  });

  // Idempotent replay: a duplicate flush of an already-persisted block is a
  // success, not an error (unique-violation on client_log_id, Postgres 23505).
  if (error && !(clientLogId && (error as { code?: string }).code === "23505")) {
    return { error: error.message };
  }

  try {
    const { recomputed } = await recomputeAfterCompletedSessionMutation({
      supabase,
      sessionId: parsed.data.sessionId,
      userId: user.id,
    });
    if (recomputed) {
      revalidatePath("/app");
      revalidatePath("/app/plan");
    }
  } catch (e) {
    console.error("post-completion recompute (addCardioBlock) failed:", e);
  }
  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true };
}

/**
 * Phase 1 "external cardio" — server action invoked when the user
 * presses "Mark done" on a placeholder `cardio_external` card.
 *
 * Inserts a minimal `cardio_logs` row so the session can register as
 * having a cardio block (the freshness ledger, the
 * `prescription-progress` engine, and the session-complete gate all
 * key off this). We intentionally do NOT auto-create this row at
 * planner-materialisation time — the user has to mark complete (see
 * Phase 1 "Don't" list).
 *
 * The session may not exist yet (the planned-session row is the
 * placeholder until the user logs against it). When `completed_session_id`
 * is null we create the underlying session first so the foreign key
 * resolves; this mirrors the lazy materialisation the regular
 * `addCardioBlock` path relies on (caller passes `sessionId` only
 * after the session row exists).
 */
const markExternalCardioSchema = z.object({
  plannedSessionId: z.string().uuid(),
  itemIndex: z.coerce.number().int().min(0),
  programName: z.string().trim().max(80).optional().nullable(),
});

export async function markExternalCardioComplete(
  formData: FormData,
): Promise<{
  ok?: true;
  error?: string;
  sessionId?: string;
  sessionCompleted?: boolean;
}> {
  const parsed = markExternalCardioSchema.safeParse({
    plannedSessionId: formData.get("plannedSessionId"),
    itemIndex: formData.get("itemIndex"),
    programName: formData.get("programName") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const programName = parsed.data.programName?.trim() || null;
  const notes = programName
    ? `External program: ${programName}`
    : "External program";

  // Resolve / lazily create the underlying session for this planned slot.
  const { data: planned, error: pErr } = await supabase
    .from("planned_sessions")
    .select("id, user_id, title, completed_session_id, prescription")
    .eq("id", parsed.data.plannedSessionId)
    .maybeSingle();
  if (pErr || !planned) {
    return { error: pErr?.message ?? "Planned session not found" };
  }
  if (planned.user_id !== user.id) return { error: "Not your session." };
  const prescription =
    (planned.prescription as Prescription | null | undefined) ?? null;
  const cardioItem = prescription?.items?.[parsed.data.itemIndex];
  if (!cardioItem || !cardioItem.kind.startsWith("cardio_")) {
    return { error: "Cardio prescription not found." };
  }
  const hasStrength = prescriptionItemsHaveStrength(prescription?.items);
  const isPureCardio = !hasStrength;

  let sessionId = planned.completed_session_id as string | null;
  if (sessionId) {
    // A pre-fix delete may have left the planned slot pointing at a
    // soft-deleted in-progress session. Do not append the new external-cardio
    // log to that old attempt; clear the stale link and use the normal lazy
    // materialisation path below. Completed deleted sessions remain a Trash
    // restore concern rather than being silently replaced.
    const { data: linkedSession, error: linkedErr } = await supabase
      .from("sessions")
      .select("id, deleted_at, completed_at")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (linkedErr) return { error: linkedErr.message };
    if (
      linkedSession?.deleted_at != null &&
      linkedSession.completed_at != null
    ) {
      return {
        error: "This session is in Trash. Restore it before marking cardio complete.",
      };
    }
    if (!linkedSession || linkedSession.deleted_at != null) {
      const { error: staleLinkError } = await supabase
        .from("planned_sessions")
        .update({ completed_session_id: null })
        .eq("id", parsed.data.plannedSessionId)
        .eq("user_id", user.id)
        .eq("completed_session_id", sessionId);
      if (staleLinkError) return { error: staleLinkError.message };
      sessionId = null;
    }
  }
  if (!sessionId) {
    const { data: created, error: sErr } = await supabase
      .from("sessions")
      .insert({
        user_id: user.id,
        title: planned.title ?? "External cardio",
        performed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (sErr || !created) {
      return { error: sErr?.message ?? "Could not create session" };
    }
    const { data: linked, error: linkErr } = await supabase
      .from("planned_sessions")
      .update({ completed_session_id: created.id })
      .eq("id", parsed.data.plannedSessionId)
      .eq("user_id", user.id)
      .is("completed_session_id", null)
      .select("completed_session_id")
      .maybeSingle();
    if (linkErr) {
      await supabase.from("sessions").delete().eq("id", created.id);
      return { error: linkErr.message };
    }
    if (linked?.completed_session_id) {
      sessionId = linked.completed_session_id as string;
    } else {
      await supabase.from("sessions").delete().eq("id", created.id);
      const { data: winner, error: winnerErr } = await supabase
        .from("planned_sessions")
        .select("completed_session_id")
        .eq("id", parsed.data.plannedSessionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (winnerErr || !winner?.completed_session_id) {
        return {
          error:
            winnerErr?.message ?? "Could not resolve the started session.",
        };
      }
      sessionId = winner.completed_session_id as string;
    }
  }
  if (!sessionId) return { error: "Could not resolve session." };
  const resolvedSessionId = sessionId;

  // Idempotency guard: if any cardio_log already exists for this
  // session, this is a re-click after refresh (the UI's `done` state
  // is component-local and doesn't survive). Return success without
  // inserting a second row.
  const { count, error: countErr } = await supabase
    .from("cardio_logs")
    .select("id", { count: "exact", head: true })
    .eq("session_id", resolvedSessionId);
  if (countErr) return { error: countErr.message };

  if ((count ?? 0) === 0) {
    const { error: insErr } = await supabase.from("cardio_logs").insert({
      session_id: resolvedSessionId,
      movement_id:
        cardioItem.movementId &&
        z.string().uuid().safeParse(cardioItem.movementId).success
          ? cardioItem.movementId
          : null,
      block_index: 0,
      modality: "other",
      // Prefer the program's target duration (e.g. 60-minute LSS). Legacy
      // placeholders without a duration keep the 1-second unknown sentinel.
      duration_sec:
        cardioItem.durationMin != null && cardioItem.durationMin > 0
          ? Math.round(cardioItem.durationMin * 60)
          : 1,
      notes,
    });
    if (insErr && (insErr as { code?: string }).code !== "23505") {
      return { error: insErr.message };
    }
  }

  if (isPureCardio) {
    const { data: cardioRows, error: durationErr } = await supabase
      .from("cardio_logs")
      .select("duration_sec")
      .eq("session_id", resolvedSessionId);
    if (durationErr) return { error: durationErr.message };
    const durationMin = Math.max(
      1,
      Math.round(
        (cardioRows ?? []).reduce(
          (total, row) => total + Number(row.duration_sec ?? 0),
          0,
        ) / 60,
      ),
    );
    const completion = await completeSessionResult(resolvedSessionId, null);
    if (completion.error) return completion;
    const { error: durationUpdateErr } = await supabase
      .from("sessions")
      .update({ duration_min: durationMin })
      .eq("id", resolvedSessionId)
      .eq("user_id", user.id);
    if (durationUpdateErr) return { error: durationUpdateErr.message };
  }

  revalidatePath(`/app/sessions/${resolvedSessionId}`);
  revalidatePath(`/app/plan`);
  revalidatePath("/app");
  return {
    ok: true,
    sessionId: resolvedSessionId,
    sessionCompleted: isPureCardio,
  };
}

/**
 * Log a cardio session result + mark the session done in one shot.
 *
 * Unlike `addCardioBlock` (a strength-session inline "+ add cardio
 * block" affordance), this is the primary "Finish workout" CTA on
 * pure-cardio sessions. It bypasses the `/complete` interstitial
 * because cardio doesn't need the auto-derived sRPE / duration flow
 * — duration is logged directly and RPE is part of the form.
 *
 * `completed = false` aligns with the existing "skip" semantics: we
 * still write a `cardio_logs` row (so adherence + freshness account
 * for the touch) but leave `sessions.completed_at` null. The caller
 * UI surfaces this as "Skip cardio" rather than a new status.
 *
 * Schema reuse: writes to the existing `cardio_logs` table — see
 * `packages/db/src/schema/cardio-logs.ts`. No migration needed.
 */
const logCardioSessionSchema = z.object({
  sessionId: z.string().uuid(),
  // FormData string → boolean. `z.coerce.boolean()` would treat the
  // string "false" as truthy (`Boolean("false") === true`), so we
  // parse the canonical string forms ourselves.
  completed: z
    .union([z.boolean(), z.string()])
    .default(true)
    .transform((v) => {
      if (typeof v === "boolean") return v;
      const s = v.trim().toLowerCase();
      return !(s === "false" || s === "0" || s === "no" || s === "");
    }),
  actualDurationMin: z.coerce.number().int().min(1).max(600),
  avgRpe: z.coerce.number().min(0).max(10).optional().nullable(),
  notes: z.string().trim().max(400).optional().nullable(),
  avgHrBpm: z.coerce.number().int().min(30).max(240).optional().nullable(),
  // Distance is captured in km in the DB; the form converts from mi
  // when the user's profile is `imperial` before submitting.
  // Min 0.01 (not 0) — zero distance for a distance-tracked session
  // is meaningless and the form's `n > 0` guard already filters zeros.
  distanceKm: z.coerce.number().min(0.01).max(1000).optional().nullable(),
  // Optional movement id from the prescription so the logged row
  // points at the same catalog entry the user was prescribed.
  movementId: z.string().uuid().optional().nullable(),
  modality: z.string().trim().min(1).max(40).default("other"),
}).strict();

export async function logCardioSession(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const parsed = logCardioSessionSchema.safeParse({
    sessionId: formData.get("sessionId"),
    completed: formData.get("completed") ?? "true",
    actualDurationMin: formData.get("actualDurationMin"),
    avgRpe: formData.get("avgRpe") || undefined,
    notes: formData.get("notes") || undefined,
    avgHrBpm: formData.get("avgHrBpm") || undefined,
    distanceKm: formData.get("distanceKm") || undefined,
    movementId: formData.get("movementId") || undefined,
    modality: formData.get("modality") || "other",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  // Ownership check via the session row — RLS would also block but
  // surfacing a clean error message is friendlier than a generic 401.
  const { data: session, error: sErr } = await supabase
    .from("sessions")
    .select("id, user_id, completed_at")
    .eq("id", parsed.data.sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (sErr) return { error: sErr.message };
  if (!session) return { error: "Session not found." };
  if (session.user_id !== user.id) return { error: "Not your session." };

  // review-208 #2 + review-211 #2 — for hybrid sessions, logging the
  // cardio portion must NOT auto-flip the session to completed if no
  // strength sets have been logged. The "is strength prescribed?"
  // predicate is shared with the import-history auto-link path via
  // `sessionPrescribesStrength` so the two surfaces can't drift.
  const [hasStrengthPrescribed, { count: setsLoggedCount }] = await Promise.all([
    sessionPrescribesStrength(supabase, parsed.data.sessionId),
    supabase
      .from("set_logs")
      .select("id", { count: "exact", head: true })
      .eq("session_id", parsed.data.sessionId),
  ]);
  const hasUnloggedStrength =
    hasStrengthPrescribed && (setsLoggedCount ?? 0) === 0;

  // review-208 #1 — idempotent upsert on (session_id, block_index). The
  // finish-workout form always writes block_index=0; ad-hoc cardio
  // blocks added via the "+ add cardio block" flow use higher indices
  // and a different code path. Double-tap / network retry now updates
  // the same row instead of producing a duplicate.
  const { error: upsertErr } = await supabase
    .from("cardio_logs")
    .upsert(
      {
        session_id: parsed.data.sessionId,
        movement_id: parsed.data.movementId ?? null,
        block_index: 0,
        modality: parsed.data.modality,
        duration_sec: parsed.data.actualDurationMin * 60,
        distance_km: parsed.data.distanceKm ?? null,
        avg_hr_bpm: parsed.data.avgHrBpm ?? null,
        rpe: parsed.data.avgRpe ?? null,
        notes: parsed.data.notes ?? null,
      },
      { onConflict: "session_id,block_index" },
    );
  if (upsertErr) return { error: upsertErr.message };

  // Only flip the session to completed when (a) the user marked the
  // cardio completed AND (b) there's no unlogged strength work that
  // would otherwise be silently dropped. Hybrid sessions with strength
  // pending stay in_progress — the strength finish bar takes over.
  if (parsed.data.completed && !session.completed_at && !hasUnloggedStrength) {
    const { error: updErr } = await supabase
      .from("sessions")
      .update({
        completed_at: new Date().toISOString(),
        duration_min: parsed.data.actualDurationMin,
        session_rpe: parsed.data.avgRpe ?? null,
      })
      .eq("id", parsed.data.sessionId);
    if (updErr) return { error: updErr.message };

    // The guarded hook only performs the full ledger rebuild now that
    // completion is persisted; in-flight cardio logging only writes its row.
    try {
      await recomputeAfterCompletedSessionMutation({
        supabase,
        sessionId: parsed.data.sessionId,
        userId: user.id,
      });
    } catch (e) {
      console.error("post-completion recompute (cardio) failed:", e);
    }
    try {
      const { data: linked } = await supabase
        .from("planned_sessions")
        .select("block_id")
        .eq("completed_session_id", parsed.data.sessionId)
        .maybeSingle();
      if (linked?.block_id) {
        await maybeCompleteBlock(supabase, linked.block_id as string);
      }
    } catch (e) {
      console.error("maybeCompleteBlock (cardio) failed:", e);
    }
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true };
}

export async function deleteSet(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!id || !sessionId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");
  const { error } = await supabase.from("set_logs").delete().eq("id", id);
  if (error) throw new Error(error.message);
  try {
    const { recomputed } = await recomputeAfterCompletedSessionMutation({
      supabase,
      sessionId,
      userId: user.id,
      emptyLogBehavior: "zero-actual",
    });
    if (recomputed) {
      revalidatePath("/app");
      revalidatePath("/app/plan");
    }
  } catch (e) {
    console.error("post-completion recompute (deleteSet) failed:", e);
  }
  revalidatePath(`/app/sessions/${sessionId}`);
}

const updateStrengthSetInlineSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  setKind: z.enum(["warmup", "main", "back_off", "accessory", "tendon"]),
  weightKg: z.coerce.number().min(0).max(1000).optional().nullable(),
  reps: z.coerce.number().int().min(0).max(500).optional().nullable(),
  durationSec: z.coerce.number().int().min(0).max(7200).optional().nullable(),
  distanceM: z.coerce.number().int().min(0).max(50000).optional().nullable(),
  rpe: z.coerce.number().min(0).max(10).optional().nullable(),
  externalLoadKg: z.coerce.number().min(-100).max(200).optional().nullable(),
});

export type UpdateStrengthSetInlineResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Update or restore a prescribed strength slot without leaving the logger.
 * Restoring a skipped row clears its skip metadata while preserving the stable
 * prescription_item_index link, so progress navigation never creates a duplicate.
 */
export async function updateStrengthSetInline(
  formData: FormData,
): Promise<UpdateStrengthSetInlineResult> {
  const parsed = updateStrengthSetInlineSchema.safeParse({
    id: formData.get("id"),
    sessionId: formData.get("sessionId"),
    setKind: formData.get("setKind") || "main",
    weightKg: formData.get("weightKg") || undefined,
    reps: formData.get("reps") || undefined,
    durationSec: formData.get("durationSec") || undefined,
    distanceM: formData.get("distanceM") || undefined,
    rpe: formData.get("rpe") || undefined,
    externalLoadKg: formData.get("externalLoadKg") ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid set update",
    };
  }
  const { reps, durationSec, distanceM } = parsed.data;
  if (!reps && !durationSec && !distanceM) {
    return {
      ok: false,
      error: "Log at least reps, a hold duration, or a distance.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { data: existing, error: existingError } = await supabase
    .from("set_logs")
    .select("set_kind, skipped, skip_reason, prescription_item_index")
    .eq("id", parsed.data.id)
    .eq("session_id", parsed.data.sessionId)
    .maybeSingle();
  if (existingError) return { ok: false, error: existingError.message };
  if (!existing) return { ok: false, error: "Set not found." };

  let updateQuery = supabase
    .from("set_logs")
    .update({
      set_kind: parsed.data.setKind,
      weight_kg: parsed.data.weightKg ?? null,
      reps: parsed.data.reps ?? null,
      duration_sec: parsed.data.durationSec ?? null,
      distance_m: parsed.data.distanceM ?? null,
      rpe: parsed.data.rpe ?? null,
      skipped: false,
      skip_reason: null,
    })
    .eq("id", parsed.data.id)
    .eq("session_id", parsed.data.sessionId);
  if (existing.skipped) {
    // Only one concurrent restoration may claim the skipped → performed
    // transition and its bodyweight progression side effects.
    updateQuery = updateQuery.eq("skipped", true);
  }
  const { data, error } = await updateQuery.select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Set not found." };

  if (existing.skipped && existing.prescription_item_index != null) {
    try {
      const { data: planned, error: plannedError } = await supabase
        .from("planned_sessions")
        .select("prescription")
        .eq("completed_session_id", parsed.data.sessionId)
        .maybeSingle();
      if (plannedError) throw new Error(plannedError.message);
      const items =
        (planned?.prescription as { items?: PrescriptionItem[] } | null)
          ?.items ?? [];
      const item = items[existing.prescription_item_index];
      if (item?.bw) {
        const { applyBwSetSideEffects } = await import(
          "@/lib/sessions/bw-set-logging"
        );
        const rir =
          parsed.data.rpe != null ? Math.max(0, 10 - parsed.data.rpe) : 2;
        await applyBwSetSideEffects({
          supabase,
          userId: user.id,
          bw: item.bw,
          actualReps: parsed.data.reps ?? null,
          actualSeconds: parsed.data.durationSec ?? null,
          rir,
          cleanForm: rir >= 1,
          setDateIso: new Date().toISOString(),
          skipped: false,
          externalLoadKg: parsed.data.externalLoadKg ?? null,
          throwOnError: true,
        });
      }
    } catch (e) {
      console.error(
        "applyBwSetSideEffects (updateStrengthSetInline) failed:",
        e,
      );
      const { error: rollbackError } = await supabase
        .from("set_logs")
        .update({
          set_kind: existing.set_kind,
          weight_kg: 0,
          reps: 0,
          duration_sec: null,
          distance_m: null,
          rpe: null,
          skipped: true,
          skip_reason: existing.skip_reason,
        })
        .eq("id", parsed.data.id)
        .eq("session_id", parsed.data.sessionId)
        .eq("skipped", false);
      if (rollbackError) {
        console.error(
          "restore rollback (updateStrengthSetInline) failed:",
          rollbackError,
        );
      }
      return {
        ok: false,
        error: rollbackError
          ? "The set was restored, but bodyweight progression couldn't be saved. Reload before editing it."
          : "Couldn't restore bodyweight progression. The set was left skipped; retry.",
      };
    }
  }

  try {
    const { recomputed } = await recomputeAfterCompletedSessionMutation({
      supabase,
      sessionId: parsed.data.sessionId,
      userId: user.id,
    });
    if (recomputed) {
      revalidatePath("/app");
      revalidatePath("/app/plan");
    }
  } catch (e) {
    console.error("post-completion recompute (updateStrengthSetInline) failed:", e);
  }
  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true };
}

const editSetSchema = z.object({
  id: z.string().uuid(),
  setKind: z.enum(["warmup", "main", "back_off", "accessory", "tendon"]),
  weightKg: z.coerce.number().min(0).max(1000).optional().nullable(),
  reps: z.coerce.number().int().min(0).max(500).optional().nullable(),
  durationSec: z.coerce.number().int().min(0).max(7200).optional().nullable(),
  distanceM: z.coerce.number().int().min(0).max(50000).optional().nullable(),
  rpe: z.coerce.number().min(0).max(10).optional().nullable(),
  notes: z.string().trim().max(400).optional().nullable(),
});

export async function editSet(formData: FormData): Promise<void> {
  const parsed = editSetSchema.safeParse({
    id: formData.get("id"),
    setKind: formData.get("setKind") || "main",
    weightKg: formData.get("weightKg") || undefined,
    reps: formData.get("reps") || undefined,
    durationSec: formData.get("durationSec") || undefined,
    distanceM: formData.get("distanceM") || undefined,
    rpe: formData.get("rpe") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const { reps, durationSec, distanceM } = parsed.data;
  if (!reps && !durationSec && !distanceM) {
    throw new Error("Log at least reps, a hold duration, or a distance.");
  }

  // The weight field is entered in the user's display unit; convert to kg for
  // storage. `units` is a hidden field on the edit form (defaults metric).
  const editUnits: WeightUnit = formData.get("units") === "imperial" ? "imperial" : "metric";
  const weightKgStored =
    parsed.data.weightKg == null ? null : toKg(parsed.data.weightKg, editUnits);

  const sessionId = String(formData.get("sessionId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase
    .from("set_logs")
    .update({
      set_kind: parsed.data.setKind,
      weight_kg: weightKgStored,
      reps: parsed.data.reps ?? null,
      duration_sec: parsed.data.durationSec ?? null,
      distance_m: parsed.data.distanceM ?? null,
      rpe: parsed.data.rpe ?? null,
      notes: parsed.data.notes ?? null,
    })
    .eq("id", parsed.data.id);

  if (error) throw new Error(error.message);
  // A completed session's logged rows are editable from the read-only card
  // (`ReadOnlySetList` → this route), which is exactly the flow the drawer's
  // ✎ Edit now funnels users into. Correcting a set on a FINISHED session moves
  // both the actual-ESL stamp and the region ledger, so re-stamp via the shared
  // post-completion helper. On an in-flight session it is a single indexed read
  // that returns without touching either — same no-op posture as the previous
  // `requireCompleted` default.
  try {
    if (sessionId) {
      const {
        data: { user },
      } = await getAuthUser();
      if (user) {
        const { recomputed } = await recomputeAfterCompletedSessionMutation({
          supabase,
          sessionId,
          userId: user.id,
        });
        if (recomputed) {
          revalidatePath("/app");
          revalidatePath("/app/plan");
        }
      }
    }
  } catch (e) {
    console.error("post-completion recompute (editSet) failed:", e);
  }
  if (sessionId) revalidatePath(`/app/sessions/${sessionId}`);
  redirect(`/app/sessions/${sessionId}`);
}

const editCardioSchema = z.object({
  id: z.string().uuid(),
  durationSec: z.coerce.number().int().min(1).max(36000),
  distanceKm: z.coerce.number().min(0).max(1000).optional().nullable(),
  avgHrBpm: z.coerce.number().int().min(30).max(240).optional().nullable(),
  avgPaceSecPerKm: z.coerce.number().int().min(60).max(2000).optional().nullable(),
  rpe: z.coerce.number().min(0).max(10).optional().nullable(),
  notes: z.string().trim().max(400).optional().nullable(),
});

export async function editCardio(formData: FormData): Promise<void> {
  const parsed = editCardioSchema.safeParse({
    id: formData.get("id"),
    durationSec: formData.get("durationSec"),
    distanceKm: formData.get("distanceKm") || undefined,
    avgHrBpm: formData.get("avgHrBpm") || undefined,
    avgPaceSecPerKm: formData.get("avgPaceSecPerKm") || undefined,
    rpe: formData.get("rpe") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const sessionId = String(formData.get("sessionId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase
    .from("cardio_logs")
    .update({
      duration_sec: parsed.data.durationSec,
      distance_km: parsed.data.distanceKm ?? null,
      avg_hr_bpm: parsed.data.avgHrBpm ?? null,
      avg_pace_sec_per_km: parsed.data.avgPaceSecPerKm ?? null,
      rpe: parsed.data.rpe ?? null,
      notes: parsed.data.notes ?? null,
    })
    .eq("id", parsed.data.id);

  if (error) throw new Error(error.message);
  try {
    if (sessionId) {
      const {
        data: { user },
      } = await getAuthUser();
      if (user) {
        const { recomputed } = await recomputeAfterCompletedSessionMutation({
          supabase,
          sessionId,
          userId: user.id,
        });
        if (recomputed) {
          revalidatePath("/app");
          revalidatePath("/app/plan");
        }
      }
    }
  } catch (e) {
    console.error("post-completion recompute (editCardio) failed:", e);
  }
  if (sessionId) revalidatePath(`/app/sessions/${sessionId}`);
  redirect(`/app/sessions/${sessionId}`);
}

export async function deleteCardio(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!id || !sessionId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");
  const { error } = await supabase.from("cardio_logs").delete().eq("id", id);
  if (error) throw new Error(error.message);
  try {
    const { recomputed } = await recomputeAfterCompletedSessionMutation({
      supabase,
      sessionId,
      userId: user.id,
      emptyLogBehavior: "zero-actual",
    });
    if (recomputed) {
      revalidatePath("/app");
      revalidatePath("/app/plan");
    }
  } catch (e) {
    console.error("post-completion recompute (deleteCardio) failed:", e);
  }
  revalidatePath(`/app/sessions/${sessionId}`);
}

const completeSchema = z.object({
  sessionId: z.string().uuid(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function completeSession(formData: FormData): Promise<void> {
  const parsed = completeSchema.safeParse({
    sessionId: formData.get("sessionId"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const res = await completeSessionResult(parsed.data.sessionId, parsed.data.notes ?? null);
  if (res.error) {
    if (res.error === "not-signed-in") redirect("/login");
    throw new Error(res.error);
  }
  // Redirect to the session with `?completed=1` rather than the bare URL. The
  // Finish button sits at the END of the (long) logging page, so a redirect to
  // the identical URL left the user scrolled at the bottom with the read-only
  // cards still looking like the logging view — the "Session complete!" summary
  // up top went unseen and the finish felt like a no-op. A changed URL forces a
  // real top-of-page navigation so the summary is the first thing they see.
  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  redirect(`/app/sessions/${parsed.data.sessionId}?completed=1`);
}

/**
 * Redirect-free core of session completion, shared by the form action
 * (`completeSession`, which redirects to the summary) and the offline outbox
 * flusher (which replays it in the background on reconnect and must NOT
 * navigate). Returns a plain result; all the heavy recompute / side-effects are
 * best-effort and never block the completed_at stamp. Re-runnable: a replay
 * just re-stamps completed_at and recomputes, so duplicate flushes are safe.
 */
export async function completeSessionResult(
  sessionId: string,
  notes: string | null,
): Promise<{ ok?: true; error?: string }> {
  const idCheck = z.string().uuid().safeParse(sessionId);
  if (!idCheck.success) return { error: "Invalid session id" };

  const supabase = await createClient();
  // The RLS-protected RPC validates ownership, derives session RPE and duration,
  // and stamps completion. Returning the owning user id avoids a separate
  // GoTrue lookup while keeping the explicit ownership gate inside Postgres.
  const { data: userId, error } = await supabase.rpc(
    "complete_training_session",
    {
      p_session_id: sessionId,
      p_notes: notes ?? null,
    },
  );
  if (error) return { error: error.message };
  if (!userId) {
    const {
      data: { user },
    } = await getAuthUser();
    return { error: user ? "Session not found." : "not-signed-in" };
  }

  // Stats ledgers, TM suggestions and BW diagnostics do not affect the
  // completion stamp or the summary that follows. Run them after the response
  // and in parallel so Finish remains a one-tap interaction instead of waiting
  // for several full-history recomputations.
  after(async () => {
    // Reuse the captured Supabase client. Dynamic request APIs such as
    // `cookies()` are no longer available once `after()` begins.
    const timezonePromise = supabase
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => data?.timezone ?? "UTC");
    await Promise.all([
      recomputeAfterCompletedSessionMutation({
        supabase,
        sessionId,
        userId,
      }).catch((e) => {
        console.error("post-completion recompute (completion) failed:", e);
      }),
      (async () => {
        const { data: linked } = await supabase
          .from("planned_sessions")
          .select("block_id")
          .eq("completed_session_id", sessionId)
          .maybeSingle();
        if (!linked?.block_id) return;
        await maybeCompleteBlock(supabase, linked.block_id as string);
        const { applyProgramProgression } = await import(
          "@/lib/platform/progression"
        );
        await applyProgramProgression({
          supabase,
          userId,
          sessionId,
          blockId: linked.block_id as string,
        });
      })().catch((e) => {
        console.error("block completion/progression failed:", e);
      }),
      (async () => {
        const timezone = await timezonePromise;
        const { applyBwSessionCompletionSideEffects } = await import(
          "@/lib/sessions/bw-set-logging"
        );
        await applyBwSessionCompletionSideEffects({
          supabase,
          userId,
          sessionId,
          timezone,
        });
        const { captureBwDiagnosticsSnapshot } = await import(
          "@/lib/planner/bw-diagnostics-snapshot"
        );
        await captureBwDiagnosticsSnapshot({ supabase, userId });
        revalidatePath("/app/settings/bodyweight-progression");
      })().catch((e) => {
        console.error("BW completion side-effects failed:", e);
      }),
    ]);
    revalidatePath("/app");
    revalidatePath("/app/stats");
  });

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/stats");
  revalidatePath(`/app/sessions/${sessionId}`);
  return { ok: true };
}

export async function recomputeRegionStateAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  await recomputeRegionState(supabase, user.id, await getUserTimezone(user.id));
  revalidatePath("/app");
  revalidatePath("/app/settings");
}

export async function deleteSession(
  formData: FormData,
): Promise<{ ok: true; sessionId: string; restoreUrl: string } | { ok: false; error: string }> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing session id." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Soft-delete: SET deleted_at = NOW() instead of removing the row.
  // RLS (sessions_update_self) restricts this to rows where
  // user_id = auth.uid(), so the explicit `eq("user_id", ...)` is
  // belt-and-suspenders defense. AGENTS.md DC-K4: destructive actions
  // are reversible by default — the calling UI surfaces the Undo
  // banner via the returned restoreUrl.
  const { error } = await supabase
    .from("sessions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  // `region_state` is a materialised aggregate used by freshness and
  // load-balance stats. Rebuild it after removing a completed session so a
  // soft-deleted attempt cannot continue contributing stale load.
  try {
    await recomputeRegionState(supabase, user.id, await getUserTimezone(user.id));
  } catch (e) {
    // Deletion itself succeeded; an aggregate refresh failure must not make
    // the user retry the destructive action and create confusing results.
    console.error("recomputeRegionState (deleteSession) failed:", e);
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/plan/history");
  revalidatePath("/app/sessions");
  revalidatePath("/app/stats");
  revalidatePath("/app/settings/trash");
  return { ok: true, sessionId: id, restoreUrl: `/api/sessions/${id}/restore` };
}

/**
 * Restore a soft-deleted session — flips `deleted_at` back to NULL.
 * RLS (sessions_update_self) covers ownership. Called both from the
 * Undo banner (via the API route) and from the Trash page Recover
 * button.
 */
export async function restoreSession(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "Missing session id." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("sessions")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  // Mirror of `deleteSession`: `recomputeRegionState` only walks
  // `completed_at IS NOT NULL AND deleted_at IS NULL`, so the delete
  // dropped this session's load out of the aggregate. Undo/Recover has to
  // put it back or freshness + load balance stay wrong until some
  // unrelated event triggers the next recompute.
  try {
    await recomputeRegionState(supabase, user.id, await getUserTimezone(user.id));
  } catch (e) {
    // The restore itself succeeded; an aggregate refresh failure must not
    // make the user retry and think the session is still in Trash.
    console.error("recomputeRegionState (restoreSession) failed:", e);
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/plan/history");
  revalidatePath("/app/sessions");
  revalidatePath("/app/stats");
  revalidatePath("/app/settings/trash");
  return { ok: true };
}

/**
 * Permanently delete a session — hard `.delete()`. Only callable from
 * the Trash page after the user has typed the session's date as a
 * type-to-confirm. Cascades via the FK in migration 0003
 * (set_logs.session_id ON DELETE CASCADE, cardio_logs.session_id ON
 * DELETE CASCADE). RLS (sessions_delete_self) covers ownership.
 */
export async function permanentlyDeleteSession(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "Missing session id." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/plan/history");
  revalidatePath("/app/sessions");
  revalidatePath("/app/stats");
  revalidatePath("/app/settings/trash");
  return { ok: true };
}

/**
 * "Same as planned" — pre-fill set_logs from the linked planned_session
 * prescription (Phase 1 B1).
 *
 * Idempotent by design: for each strength PrescriptionItem (`main`,
 * `back_off`, `accessory`, `tendon`, `warmup`) we already have rows for
 * (movement_id × set_kind), we DO NOT insert duplicates. Cardio items
 * are ignored — they go through the cardio block flow (B2 / Phase 2).
 *
 * Tapping twice is a no-op once everything is in place. We fan the
 * `sets` count out into separate set_logs rows so the per-set log
 * surface and PR detection behave the same as if the user had tapped
 * "Log set" N times manually.
 */
const fillFromPlanSchema = z.object({
  sessionId: z.string().uuid(),
});

type SetInsert = {
  session_id: string;
  movement_id: string;
  set_index: number;
  set_kind: PlannedSetKind;
  weight_kg: number | null;
  reps: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  prescription_item_index: number | null;
  client_log_id: string;
  // ADR 0070 — this path resolves the prescription itself, so the snapshot is
  // the same value it already computes for the prefill, stored durably instead
  // of being overwritten by the user's first edit.
  target_weight_kg: number | null;
  target_reps: number | null;
  prescribed: PrescribedSnapshot | null;
};

export async function fillSessionFromPlan(
  formData: FormData,
): Promise<{ ok?: true; error?: string; inserted?: number }> {
  const parsed = fillFromPlanSchema.safeParse({
    sessionId: formData.get("sessionId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  // Resolve the linked plan + TM dict in parallel so the cost is one
  // round-trip per data source.
  const [plannedRes, existingRes, tmsRes, profileRes] = await Promise.all([
    supabase
      .from("planned_sessions")
      .select(
        "id, prescription, week_index, day_index, training_blocks!inner(started_on)",
      )
      .eq("completed_session_id", parsed.data.sessionId)
      .maybeSingle(),
    supabase
      .from("set_logs")
      .select(
        "movement_id, set_kind, set_index, prescription_item_index, client_log_id",
      )
      .eq("session_id", parsed.data.sessionId),
    supabase
      .from("training_maxes")
      .select(TM_RESOLUTION_SELECT)
      .eq("user_id", user.id),
    supabase
      .from("profiles")
      .select(
        "tm_percent_default, barbell_kg, trap_bar_kg, plate_inventory_kg, equipment, bodyweight_kg, warmup_scheme",
      )
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const planned = plannedRes.data as {
    id: string;
    prescription: Prescription | null;
    week_index: number;
    day_index: number;
    training_blocks:
      | { started_on: string }
      | { started_on: string }[]
      | null;
  } | null;
  if (!planned || !planned.prescription) {
    return { error: "No planned session is linked to this log." };
  }

  // Build a tm lookup by movement_id for percentTm resolution. The training
  // max = stored 1RM × effective TM% (per-movement override, else the profile
  // default, else 90), rounded to the plate increment — the same number
  // `getTrainingMaxContext` hands the live logger, so the materialised load and
  // the displayed one cannot disagree by a plate.
  const defaultPct = Number(profileRes.data?.tm_percent_default ?? 90);
  const equipment = resolveEquipment(profileRes.data);
  const tmByMovementId = new Map<string, number>();
  for (const row of (tmsRes.data ?? []) as Array<{
    movement_id: string;
    one_rm_kg: number | string | null;
    tm_percent: number | string | null;
  }>) {
    const oneRm = Number(row.one_rm_kg);
    if (!Number.isFinite(oneRm) || oneRm <= 0) continue;
    const pct = row.tm_percent == null ? defaultPct : Number(row.tm_percent);
    const tm = roundToPlate((oneRm * pct) / 100);
    if (Number.isFinite(tm) && tm > 0) tmByMovementId.set(row.movement_id, tm);
  }

  // Resolve the session's calendar date from the plan slot so an
  // accepted taper/recovery scales the materialised set_logs the same
  // way the renderers (queries.ts) scale what the user sees.
  const blockRel = planned.training_blocks;
  const block = Array.isArray(blockRel) ? blockRel[0] : blockRel;
  const base = applyAutoregVolumeScale(planned.prescription);
  let items = base.items ?? [];
  if (block) {
    const slotDate = dayDate(block.started_on, planned.week_index, planned.day_index);
    const mods = await getActiveModifications(
      user.id,
      new Date(`${slotDate}T00:00:00Z`),
    );
    items = applyModificationsToPrescription(base, mods).items ?? [];
  }
  const inserts: SetInsert[] = [];
  // Weighted pull-ups / dips are anchored on a bodyweight-inclusive max, so a
  // percentage of one is a TOTAL. Without bodyweight the added load can't be
  // resolved at all, and without knowing which movements those are the total
  // would go straight onto the belt.
  const bodyweightRaw = profileRes.data?.bodyweight_kg;
  const bodyweightNum = bodyweightRaw == null ? NaN : Number(bodyweightRaw);
  const bodyweightKg = Number.isFinite(bodyweightNum) && bodyweightNum > 0 ? bodyweightNum : null;
  const systemLoadByMovementId = await loadSystemLoadMovementIds(
    supabase,
    items.map((item) => item.movementId),
  );
  // Warm-ups materialised while `body_weight_loaded` stood in for "this max
  // counts bodyweight" stored a bodyweight-subtracted absolute for ordinary
  // lifts. Restate them before anything reads a load, so the fill writes the
  // same number the logger shows.
  items = repairLegacySystemLoadWarmups(items, {
    isSystemLoadMovement: (movementId) => systemLoadByMovementId.get(movementId),
    bodyweightKg,
    trainingMaxKg: (movementId) => tmByMovementId.get(movementId),
    rampFractions: legacyWarmupRampFractions(profileRes.data?.warmup_scheme),
  });
  const missingSets = planMissingPrescriptionSets(
    parsed.data.sessionId,
    items,
    (existingRes.data ?? []) as ExistingPlannedSet[],
  );
  for (const missing of missingSets) {
    const item = items[missing.itemIndex] as PrescriptionItem;
    const work = resolvePrescriptionSetWork(item);

    // Resolve target weight: percentTm × TM, rounded to plate. When no
    // TM is set we leave weight null — the user will be nudged by the
    // empty input, not by a guessed default.
    const tm = tmByMovementId.get(item.movementId);
    // Same canonical resolver the focus view uses, so a displayed
    // warm-up load and the persisted one cannot diverge (a `null`
    // trap bar / `0` barbell means no bar floor on either side).
    const warmupBarWeightKg =
      item.kind === "warmup"
        ? resolveBarWeightKg(item.movementSlug, equipment.bars)
        : null;
    const warmupLoadOptions = {
      barWeightKg: warmupBarWeightKg ?? undefined,
      availablePlateWeightsKg: equipment.plates,
    };
    const systemLoad = isSystemLoadItem(item, systemLoadByMovementId);
    const roundKg = (kg: number) =>
      item.kind === "warmup" ? roundWarmupLoadKg(kg, warmupLoadOptions) : roundToPlate(kg);
    const weight = resolveTargetLoadKg(item, {
      tmKg: tm ?? null,
      ...(systemLoad ? { isSystemLoad: true } : {}),
      bodyweightKg,
      roundKg,
      // A hand-entered rehab / external-cardio load is stored verbatim.
      ...(item.kind === "warmup" ? { roundAbsoluteKg: roundKg } : {}),
    });

    // ADR 0070 — the prescribed snapshot. This path IS the prescription
    // resolver, so the snapshot is exactly what the prefill shows. Derived
    // through the shared resolver (plan §6.9) so it matches the live logger.
    const snapshot = resolvePrescribedSnapshot(item, {
      tmKg: tm ?? null,
      basis: item.intensityLabel?.includes("1RM") ? "1RM" : "TM",
      ...(systemLoad ? { isSystemLoad: true } : {}),
      bodyweightKg,
      roundToPlate,
      setKind: missing.setKind,
    });

    inserts.push({
      session_id: parsed.data.sessionId,
      movement_id: item.movementId,
      set_index: missing.setIndex,
      set_kind: missing.setKind,
      weight_kg: weight,
      reps: work.reps,
      duration_sec: work.durationSec,
      distance_m: work.distanceM,
      prescription_item_index: missing.itemIndex,
      client_log_id: plannedSetClientId(
        parsed.data.sessionId,
        missing.itemIndex,
        missing.copyIndex,
        item.movementId,
        missing.setKind,
      ),
      target_weight_kg: snapshot.targetWeightKg,
      target_reps: snapshot.targetReps,
      prescribed: snapshot.prescribed,
    });
  }

  if (inserts.length === 0) {
    return { ok: true, inserted: 0 };
  }

  const { error } = await supabase.from("set_logs").upsert(inserts, {
    onConflict: "client_log_id",
    ignoreDuplicates: true,
  });
  if (error) return { error: error.message };

  try {
    const { recomputed } = await recomputeAfterCompletedSessionMutation({
      supabase,
      sessionId: parsed.data.sessionId,
      userId: user.id,
    });
    if (recomputed) {
      revalidatePath("/app");
      revalidatePath("/app/plan");
    }
  } catch (e) {
    console.error("post-completion recompute (fillSessionFromPlan) failed:", e);
  }
  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true, inserted: inserts.length };
}

const updateTitleSchema = z.object({
  sessionId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
});

/**
 * Rename a workout. The title is purely a user-facing label (DB tables
 * and routes use the immutable session id), so this only writes
 * `sessions.title`. RLS-scoped to the owner. Latest write wins.
 */
export async function updateSessionTitle(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const parsed = updateTitleSchema.safeParse({
    sessionId: formData.get("sessionId"),
    title: formData.get("title"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("sessions")
    .update({ title: parsed.data.title })
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true };
}

const updateNotesSchema = z.object({
  sessionId: z.string().uuid(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Phase 1 C1 — append/replace the session.notes from the post-session
 * summary card. We deliberately overwrite rather than append; the card
 * is meant for quick reflections (one block of text) and the existing
 * `/complete` flow already allows pre-completion notes. The latest
 * write wins.
 */
export async function updateSessionNotes(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const parsed = updateNotesSchema.safeParse({
    sessionId: formData.get("sessionId"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("sessions")
    .update({ notes: parsed.data.notes ?? null })
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true };
}

const updatePlannedNotesSchema = z.object({
  id: z.string().uuid(),
  notes: z.string().max(2000),
});

/**
 * Cross-device sync (PR Z1) — persist the plan-drawer notes the user
 * types about a *planned* (not yet completed) session. Previously
 * stored only in `localStorage` under `plan-notes:<id>` and therefore
 * invisible on every other device. See `hybrid-sync-audit.md` §3a +
 * migration 0055.
 *
 * No `revalidatePath` — the drawer is a client component that already
 * reflects the in-memory draft; revalidating would discard pending
 * edits on neighbouring drawers. The next full page load reads the
 * fresh DB value via `getPlannedDays`.
 */
export async function updatePlannedSessionNotes(
  id: string,
  notes: string,
): Promise<{ ok?: true; error?: string }> {
  const parsed = updatePlannedNotesSchema.safeParse({ id, notes });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const supabase = await createClient();
  const trimmed = parsed.data.notes.trim();
  const { error } = await supabase
    .from("planned_sessions")
    .update({ notes: trimmed === "" ? null : trimmed })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  return { ok: true };
}

const swapItemSchema = z.object({
  plannedSessionId: z.string().uuid(),
  itemIndex: z.coerce.number().int().min(0).max(64),
  newMovementId: z.string().uuid(),
  reason: z.string().max(280).optional(),
});

/**
 * Phase 2 A2 — swap a single prescription item on today's planned session.
 *
 * Mutates the ``prescription.items[itemIndex]`` JSONB in place: replaces
 * ``movementId`` / ``movementSlug`` / ``movementName`` with the picked
 * candidate, and records the original movement under ``meta.swappedFrom``
 * so analytics can later see "user swapped X% of prescribed work" and
 * the UI can surface a "Swapped" badge with the prior name on hover.
 *
 * Only affects today's prescription — no implicit "always do floor press"
 * propagation. A future "always swap" preference is a separate feature.
 *
 * Per DC-K4 ("override-and-warn, never silent overrule") the swap also
 * lands a row in `engine_override_events` with the original / new
 * movement slugs and the optional user reason. The legacy
 * `meta.swappedFrom` write stays — kept backwards-compatible for the
 * Phase 5 movement-page swap history.
 *
 * Returns the updated prescription so the client can paint instantly.
 */
export async function swapPrescriptionItem(
  formData: FormData,
): Promise<{ ok?: true; error?: string; prescription?: Prescription }> {
  const parsed = swapItemSchema.safeParse({
    plannedSessionId: formData.get("plannedSessionId"),
    itemIndex: formData.get("itemIndex"),
    newMovementId: formData.get("newMovementId"),
    reason: (formData.get("reason") as string | null) ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const [{ data: plannedRow, error: pErr }, { data: newMov, error: mErr }] = await Promise.all([
    supabase
      .from("planned_sessions")
      .select(
        "id, user_id, block_id, week_index, day_index, prescription, training_blocks!inner(archetype, started_on)",
      )
      .eq("id", parsed.data.plannedSessionId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("movements")
      .select("id, slug, display_name")
      .eq("id", parsed.data.newMovementId)
      .maybeSingle(),
  ]);
  if (pErr) return { error: pErr.message };
  if (!plannedRow) return { error: "Planned session not found." };
  if (mErr) return { error: mErr.message };
  if (!newMov) return { error: "Replacement movement not found." };

  const prescription = (plannedRow.prescription as Prescription | null) ?? { items: [] };
  if (parsed.data.itemIndex >= (prescription.items?.length ?? 0)) {
    return { error: "Item index out of range." };
  }

  const originalItem = prescription.items[parsed.data.itemIndex];
  const originalSlug = originalItem?.movementSlug ?? null;

  let nextPrescription: Prescription;
  try {
    nextPrescription = applyPrescriptionSwap(prescription, {
      itemIndex: parsed.data.itemIndex,
      newMovement: {
        id: newMov.id as string,
        slug: newMov.slug as string,
        displayName: newMov.display_name as string,
      },
    });
  } catch (e) {
    return { error: (e as Error).message };
  }

  const { error: uErr } = await supabase
    .from("planned_sessions")
    .update({ prescription: nextPrescription })
    .eq("id", parsed.data.plannedSessionId)
    .eq("user_id", user.id);
  if (uErr) return { error: uErr.message };

  // DC-K4 audit-log write — best-effort, fire-and-forget. Even if it
  // fails the legacy `meta.swappedFrom` JSONB write above survives so
  // the swap is still observable to the engine page (degraded mode).
  const block = (plannedRow as unknown as {
    training_blocks?: { archetype?: string; started_on?: string };
  }).training_blocks;
  const startedOn = block?.started_on;
  const weekIndex = plannedRow.week_index as number;
  const dayIndex = plannedRow.day_index as number;
  let weekday: number | undefined;
  if (startedOn) {
    const startMs = Date.parse(`${startedOn}T12:00:00Z`);
    if (!Number.isNaN(startMs)) {
      const dayMs = startMs + (weekIndex * 7 + dayIndex) * 86_400_000;
      const d = new Date(dayMs);
      weekday = ((d.getUTCDay() + 6) % 7) + 1;
    }
  }
  await recordOverrideEvent(supabase, {
    userId: user.id,
    eventType: "swap",
    plannedSessionId: parsed.data.plannedSessionId,
    blockId: (plannedRow.block_id as string | null) ?? null,
    originalMovementSlug: originalSlug,
    newMovementSlug: (newMov.slug as string) ?? null,
    reason: parsed.data.reason ?? null,
    context: {
      archetype: block?.archetype,
      weekIndex,
      dayIndex,
      weekday,
    },
  });

  // Revalidate Today + any in-progress session that links to this plan.
  revalidatePath("/app");
  const { data: linked } = await supabase
    .from("planned_sessions")
    .select("completed_session_id")
    .eq("id", parsed.data.plannedSessionId)
    .maybeSingle();
  if (linked?.completed_session_id) {
    revalidatePath(`/app/sessions/${linked.completed_session_id}`);
  }

  return { ok: true, prescription: nextPrescription };
}

/* ─────────────────────────────────────────────────────────────────────
 * Quick-workout entry points (Today page → off-plan ad-hoc session).
 *
 * Quick workouts are STRENGTH-ONLY. Two actions back the Today-page
 * "Quick workout" card + bottom sheet:
 *   - `startQuickStrengthSession` — empty session, user adds movements
 *   - `repeatRecentSession`       — clone the strength shape (movements)
 *                                   of a recent completed session
 *
 * Cardio is intentionally NOT a quick-workout option: in-app ad-hoc
 * cardio capture was removed, so cardio is logged against a planned
 * cardio slot (or via "log an activity") rather than started here.
 *
 * Both are intentionally distinct from `startSession` so the "ad-hoc"
 * classification stays explicit at the call site. They do NOT link the
 * new row to any `planned_sessions.completed_session_id` — an off-plan
 * workout never marks today's planned slot as complete. The load +
 * region recompute paths (recomputeActualSessionLoad,
 * recomputeRegionState) walk completed sessions regardless of planned
 * linkage, so the ad-hoc session shows up in fatigue accounting without
 * touching the planned-day ledger.
 *
 * Schema reuse only — no migration. `sessions` and the
 * `add_session_movement` RPC are all pre-existing.
 *
 * Navigation contract: both RETURN the new session id rather than calling
 * `redirect()`. The Today-page sheet then navigates client-side via
 * `router.push`, which engages the `/app/sessions/[id]` `loading.tsx`
 * skeleton instantly. A server-action `redirect()` does NOT show that
 * loading boundary — it blocks the caller's `useTransition` until the full
 * destination RSC is ready, which is what made "Starting…" hang.
 * ──────────────────────────────────────────────────────────────────── */

const startQuickStrengthSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
  })
  .strict();

export type StartQuickStrengthInput = {
  title?: string;
};

export async function startQuickStrengthSession(
  input: StartQuickStrengthInput = {},
): Promise<string> {
  const parsed = startQuickStrengthSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: created, error: sErr } = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      title: parsed.data.title?.trim() || "Quick workout",
    })
    .select("id")
    .single();
  if (sErr || !created) throw new Error(sErr?.message ?? "Could not create session");

  revalidatePath("/app");
  return created.id;
}

const repeatRecentSchema = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();

export type RepeatRecentInput = {
  sessionId: string;
};

/**
 * Clone the *shape* of a completed session into a fresh ad-hoc session.
 *
 * Quick workouts are strength-only, so this clones STRENGTH shape only:
 *   - The list of distinct `movement_ids` referenced by the source's
 *     `session_movements` (preferred) or `set_logs` (fallback for older
 *     sessions that pre-date the explicit session_movements row).
 *
 * What does NOT get copied:
 *   - `set_logs` (so the new session starts with zero work logged)
 *   - Cardio blocks — quick workouts are strength-only, so cardio is
 *     never cloned here.
 *     (Recent candidates are already filtered to strength sessions, so a
 *     source session reaching this path has strength movements to clone.)
 *   - Any planned_session linkage (this is an off-plan ad-hoc row)
 *   - Externally-sourced cardio fields (external_source, etc.)
 *
 * The source session must be owned by the current user; RLS + the
 * explicit `user_id` filter both enforce this.
 */
export async function repeatRecentSession(input: RepeatRecentInput): Promise<string> {
  const parsed = repeatRecentSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // 1. Verify ownership of the source (RLS-respect + defence-in-depth).
  const { data: source, error: srcErr } = await supabase
    .from("sessions")
    .select("id, title, user_id")
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (srcErr) throw new Error(srcErr.message);
  if (!source) throw new Error("Session not found.");

  // 2. Read strength shape — session_movements (preferred) + fallback
  // set_logs for movements when session_movements is empty.
  const [{ data: smRows }, { data: slRows }] = await Promise.all([
    supabase
      .from("session_movements")
      .select("movement_id, sort_order")
      .eq("session_id", source.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("set_logs")
      .select("movement_id")
      .eq("session_id", source.id),
  ]);

  const distinctMovementIds: string[] = [];
  const seen = new Set<string>();
  for (const r of smRows ?? []) {
    const id = r.movement_id as string | null;
    if (id && !seen.has(id)) {
      seen.add(id);
      distinctMovementIds.push(id);
    }
  }
  if (distinctMovementIds.length === 0) {
    for (const r of slRows ?? []) {
      const id = r.movement_id as string | null;
      if (id && !seen.has(id)) {
        seen.add(id);
        distinctMovementIds.push(id);
      }
    }
  }

  // 3. Create the new ad-hoc session.
  const { data: created, error: insErr } = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      title: source.title ?? "Quick workout",
    })
    .select("id")
    .single();
  if (insErr || !created) throw new Error(insErr?.message ?? "Could not create session");

  // 4. Fan out movements via the atomic RPC (same path the in-session
  // "+ add movement" picker uses, so sort_order assignment stays
  // race-safe).
  for (const movementId of distinctMovementIds) {
    const { error: rpcErr } = await supabase.rpc("add_session_movement", {
      p_session_id: created.id,
      p_movement_id: movementId,
      p_user_id: user.id,
    });
    if (rpcErr) throw new Error(rpcErr.message);
  }

  revalidatePath("/app");
  return created.id;
}

/* ─────────────────────────────────────────────────────────────────────
 * Quick-generate — freshness-aware deterministic strength session.
 *
 * Unlike `startQuickStrengthSession` (empty session, user adds movements),
 * this BUILDS a ready-to-log strength session via the prescription engine:
 *   - resolves the user's archetype from their active (or most recent) block,
 *   - routes the main lift to the freshest pattern (16-muscle freshness),
 *   - fills accessories with a freshness-masked target map,
 *   - trims to a Short (~30 min) or Normal (~60 min) duration budget.
 *
 * Deterministic — no AI. RLS: user-scoped client + explicit user_id filters +
 * Zod `.strict()`. Off-plan: never links to a planned_sessions slot.
 * ──────────────────────────────────────────────────────────────────── */

const generateQuickStrengthSchema = z
  .object({
    length: z.enum(["short", "normal"]),
  })
  .strict();

export type GenerateQuickStrengthInput = {
  length: QuickLength;
};

export async function generateQuickStrengthSession(
  input: GenerateQuickStrengthInput,
): Promise<string> {
  const parsed = generateQuickStrengthSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const tz = await getUserTimezone();
  // Fresh per-generate seed so each "Generate" rotates the main lift + accessory
  // picks (deterministic given the seed; varies per click). See ADR 0029.
  const variationSeed = Math.floor(Math.random() * 1_000_000);
  const plan = await resolveQuickStrengthPlan(supabase, user.id, {
    length: parsed.data.length,
    tz,
    seed: variationSeed,
  });
  if (!plan.ok) throw new Error(plan.error);

  // Store the generated prescription ON the session (off-plan — no
  // planned_sessions linkage). The session page renders the grouped MAIN
  // LIFTS / ACCESSORY WORK layout and the "0 of N" progress counter from this,
  // identical to a planned workout. We deliberately do NOT pre-insert set_logs:
  // those would read as already-logged. The user logs each set interactively,
  // and the per-set target weight (%TM × TM) is computed at render time.
  const prescription: Prescription = {
    items: expandPrescriptionSetItems(plan.items),
  };
  const { data: created, error: insErr } = await supabase
    .from("sessions")
    .insert({ user_id: user.id, title: plan.title, prescription })
    .select("id")
    .single();
  if (insErr || !created) {
    throw new Error(insErr?.message ?? "Could not create session");
  }

  revalidatePath("/app");
  return created.id;
}

/* ────────────────────────────────────────────────────────────────────
 * generateQuickHyroxSession — on-demand HYROX conditioning workout.
 *
 *   - per-generation station checklist (overrides profile equipment for today);
 *   - ~30 / ~60 min budget;
 *   - adaptive format: circuit / compromised / erg / run, chosen by which formats
 *     the checklist enables and which is most overdue vs its programmed cadence;
 *   - experience + division from the user's active-or-most-recent HYROX instance
 *     (default intermediate / open).
 *
 * Deterministic. RLS: user-scoped client + explicit user_id filters + Zod
 * `.strict()`. Off-plan: never links a planned_sessions slot. The format is
 * stamped on `prescription.meta.hyroxQuickFormat` so future generations can read
 * recency. The session logs through the generic cardio surface (one block).
 * ──────────────────────────────────────────────────────────────────── */

const HYROX_QUICK_STATIONS = [
  "run",
  "ski_erg",
  "rower",
  "sled",
  "sandbag",
  "wall_ball",
  "farmers",
  "burpees",
] as const;

const generateQuickHyroxSchema = z
  .object({
    length: z.enum(["short", "normal"]),
    stations: z.array(z.enum(HYROX_QUICK_STATIONS)).min(1),
  })
  .strict();

export type GenerateQuickHyroxInput = {
  length: QuickLength;
  stations: HyroxQuickStation[];
};

export async function generateQuickHyroxSession(
  input: GenerateQuickHyroxInput,
): Promise<string> {
  const parsed = generateQuickHyroxSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const plan = await resolveQuickHyroxPlan(supabase, user.id, {
    length: parsed.data.length,
    stations: [...parsed.data.stations],
  });
  if (!plan.ok) throw new Error(plan.error);

  const prescription: Prescription = {
    items: plan.items,
    meta: { hyroxQuickFormat: plan.format, hyroxQuickView: plan.view },
  };
  const { data: createdHyrox, error: insHyroxErr } = await supabase
    .from("sessions")
    .insert({ user_id: user.id, title: plan.title, prescription })
    .select("id")
    .single();
  if (insHyroxErr || !createdHyrox) {
    throw new Error(insHyroxErr?.message ?? "Could not create session");
  }

  revalidatePath("/app");
  return createdHyrox.id;
}
