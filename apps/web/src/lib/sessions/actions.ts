"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { recomputeRegionState } from "@/lib/engine/region-ledger";
import { recomputeActualSessionLoad } from "@/lib/engine/recompute-actual-session-load";
import { maybeCompleteBlock } from "@/lib/planner/completion";
import { getUserTimezone } from "@/lib/planner/queries";
import { roundToPlate } from "@/lib/planner/archetypes";
import type { Prescription, PrescriptionItem } from "@hta/db";
import { applyPrescriptionSwap } from "./prescription-mutations";
import { recordOverrideEvent } from "@/lib/engine/overrides";

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
});

export async function addStrengthSet(
  formData: FormData,
): Promise<{ error?: string; ok?: true }> {
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

  const { count } = await supabase
    .from("set_logs")
    .select("id", { count: "exact", head: true })
    .eq("session_id", parsed.data.sessionId);

  const { error } = await supabase.from("set_logs").insert({
    session_id: parsed.data.sessionId,
    movement_id: parsed.data.movementId,
    set_index: count ?? 0,
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
  });

  if (error) return { error: error.message };

  // Bodyweight Phase 4 — accumulate TUT + clean_rep_history when the
  // logged set was prescribed via a BW main-lift item. Failures here
  // must never block the logging UI.
  try {
    if (
      !isSkipped &&
      parsed.data.prescriptionItemIndex != null
    ) {
      const { data: planned } = await supabase
        .from("planned_sessions")
        .select("prescription")
        .eq("completed_session_id", parsed.data.sessionId)
        .maybeSingle();
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
        });
      }
    }
  } catch (e) {
    console.error("applyBwSetSideEffects failed:", e);
  }

  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true };
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
  });

  if (error) return { error: error.message };

  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true };
}

/**
 * Phase 1 "external cardio" — server action invoked when the user
 * presses "Mark complete" on a placeholder `cardio_external` card.
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
  programName: z.string().trim().max(80).optional().nullable(),
});

export async function markExternalCardioComplete(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const parsed = markExternalCardioSchema.safeParse({
    plannedSessionId: formData.get("plannedSessionId"),
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
    .select("id, user_id, title, completed_session_id")
    .eq("id", parsed.data.plannedSessionId)
    .maybeSingle();
  if (pErr || !planned) {
    return { error: pErr?.message ?? "Planned session not found" };
  }
  if (planned.user_id !== user.id) return { error: "Not your session." };

  let sessionId = planned.completed_session_id as string | null;
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
    sessionId = created.id;
    await supabase
      .from("planned_sessions")
      .update({ completed_session_id: sessionId })
      .eq("id", parsed.data.plannedSessionId);
  }

  // Idempotency guard: if any cardio_log already exists for this
  // session, this is a re-click after refresh (the UI's `done` state
  // is component-local and doesn't survive). Return success without
  // inserting a second row.
  const { count } = await supabase
    .from("cardio_logs")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);

  if ((count ?? 0) > 0) {
    revalidatePath(`/app/sessions/${sessionId}`);
    revalidatePath(`/app/plan`);
    return { ok: true };
  }

  const { error: insErr } = await supabase.from("cardio_logs").insert({
    session_id: sessionId,
    movement_id: null,
    block_index: 0,
    modality: "other",
    // 1-second sentinel keeps the row valid against the duration_sec
    // NOT NULL / >0 constraint while signalling "duration unknown" to
    // any consumer that filters on it. Stats counts the day as
    // adherent via `run-plan-adherence` regardless.
    duration_sec: 1,
    notes,
  });
  if (insErr) return { error: insErr.message };

  revalidatePath(`/app/sessions/${sessionId}`);
  revalidatePath(`/app/plan`);
  return { ok: true };
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
  distanceKm: z.coerce.number().min(0).max(1000).optional().nullable(),
  // Optional movement id from the prescription so the logged row
  // points at the same catalog entry the user was prescribed.
  movementId: z.string().uuid().optional().nullable(),
  modality: z.string().trim().min(1).max(40).default("other"),
});

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

  const { count } = await supabase
    .from("cardio_logs")
    .select("id", { count: "exact", head: true })
    .eq("session_id", parsed.data.sessionId);

  const { error: insErr } = await supabase.from("cardio_logs").insert({
    session_id: parsed.data.sessionId,
    movement_id: parsed.data.movementId ?? null,
    block_index: count ?? 0,
    modality: parsed.data.modality,
    duration_sec: parsed.data.actualDurationMin * 60,
    distance_km: parsed.data.distanceKm ?? null,
    avg_hr_bpm: parsed.data.avgHrBpm ?? null,
    rpe: parsed.data.avgRpe ?? null,
    notes: parsed.data.notes ?? null,
  });
  if (insErr) return { error: insErr.message };

  if (parsed.data.completed && !session.completed_at) {
    const { error: updErr } = await supabase
      .from("sessions")
      .update({
        completed_at: new Date().toISOString(),
        duration_min: parsed.data.actualDurationMin,
        session_rpe: parsed.data.avgRpe ?? null,
      })
      .eq("id", parsed.data.sessionId);
    if (updErr) return { error: updErr.message };

    // Recompute downstream load + region state, mirroring the
    // strength-completion side effects in `completeSession`. Failures
    // here must not block the user from finishing.
    try {
      await recomputeActualSessionLoad({
        supabase,
        sessionId: parsed.data.sessionId,
        requireCompleted: false,
      });
    } catch (e) {
      console.error("recomputeActualSessionLoad (cardio) failed:", e);
    }
    try {
      await recomputeRegionState(
        supabase,
        user.id,
        await getUserTimezone(user.id),
      );
    } catch (e) {
      console.error("recomputeRegionState (cardio) failed:", e);
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
  await supabase.from("set_logs").delete().eq("id", id);
  // Re-stamp planned_sessions.effective_stress_load when this session
  // is already completed. requireCompleted gates the no-op for
  // in-flight sessions.
  try {
    await recomputeActualSessionLoad({ supabase, sessionId });
  } catch (e) {
    console.error("recomputeActualSessionLoad (deleteSet) failed:", e);
  }
  revalidatePath(`/app/sessions/${sessionId}`);
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

  const sessionId = String(formData.get("sessionId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase
    .from("set_logs")
    .update({
      set_kind: parsed.data.setKind,
      weight_kg: parsed.data.weightKg ?? null,
      reps: parsed.data.reps ?? null,
      duration_sec: parsed.data.durationSec ?? null,
      distance_m: parsed.data.distanceM ?? null,
      rpe: parsed.data.rpe ?? null,
      notes: parsed.data.notes ?? null,
    })
    .eq("id", parsed.data.id);

  if (error) throw new Error(error.message);
  try {
    if (sessionId) await recomputeActualSessionLoad({ supabase, sessionId });
  } catch (e) {
    console.error("recomputeActualSessionLoad (editSet) failed:", e);
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
    if (sessionId) await recomputeActualSessionLoad({ supabase, sessionId });
  } catch (e) {
    console.error("recomputeActualSessionLoad (editCardio) failed:", e);
  }
  if (sessionId) revalidatePath(`/app/sessions/${sessionId}`);
  redirect(`/app/sessions/${sessionId}`);
}

export async function deleteCardio(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!id || !sessionId) return;

  const supabase = await createClient();
  await supabase.from("cardio_logs").delete().eq("id", id);
  try {
    await recomputeActualSessionLoad({ supabase, sessionId });
  } catch (e) {
    console.error("recomputeActualSessionLoad (deleteCardio) failed:", e);
  }
  revalidatePath(`/app/sessions/${sessionId}`);
}

const completeSchema = z.object({
  sessionId: z.string().uuid(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Volume-weighted mean of per-set RPEs.
 * Sets without RPE or without tonnage are excluded.
 * Returns null when no usable sets exist.
 */
function deriveSessionRpe(
  sets: Array<{ weight_kg: number | null; reps: number | null; rpe: number | null }>,
): number | null {
  let weighted = 0;
  let totalVolume = 0;
  for (const s of sets) {
    if (s.rpe == null) continue;
    const w = Number(s.weight_kg ?? 0);
    const r = Number(s.reps ?? 0);
    const vol = w * r;
    if (vol <= 0) continue;
    weighted += Number(s.rpe) * vol;
    totalVolume += vol;
  }
  if (totalVolume <= 0) return null;
  return Math.round((weighted / totalVolume) * 10) / 10; // 1 decimal
}

/**
 * Elapsed minutes between the first and last set timestamp.
 * Capped at 3 h to swallow "user paused the app mid-session" edge cases.
 * Returns null when fewer than 2 sets are logged.
 */
function deriveDurationMin(timestamps: string[]): number | null {
  if (timestamps.length < 2) return null;
  const sorted = [...timestamps].sort();
  const first = new Date(sorted[0]!).getTime();
  const last = new Date(sorted[sorted.length - 1]!).getTime();
  const minutes = Math.round((last - first) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.min(minutes, 180);
}

export async function completeSession(formData: FormData): Promise<void> {
  const parsed = completeSchema.safeParse({
    sessionId: formData.get("sessionId"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // Auto-derive session RPE from per-set RPEs (volume-weighted).
  // Auto-derive duration from the gap between first and last set timestamps.
  // No user prompt — keeps the wrap-up flow to a single tap.
  const { data: sets } = await supabase
    .from("set_logs")
    .select("weight_kg, reps, rpe, created_at")
    .eq("session_id", parsed.data.sessionId)
    .eq("skipped", false);
  const setRows = sets ?? [];

  const derivedRpe = deriveSessionRpe(
    setRows.map((s) => ({
      weight_kg: s.weight_kg == null ? null : Number(s.weight_kg),
      reps: s.reps == null ? null : Number(s.reps),
      rpe: s.rpe == null ? null : Number(s.rpe),
    })),
  );
  const derivedDuration = deriveDurationMin(setRows.map((s) => s.created_at as string));

  const { error } = await supabase
    .from("sessions")
    .update({
      session_rpe: derivedRpe,
      duration_min: derivedDuration,
      notes: parsed.data.notes ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.sessionId);

  if (error) throw new Error(error.message);

  // Finding 1 fix — recompute planned_sessions.effective_stress_load
  // from the logged set_logs + cardio_logs now that the session has
  // been stamped completed_at. Best-effort: any failure here must
  // never block the user from marking the session complete (the
  // helper itself try/catches; this is belt-and-suspenders).
  try {
    await recomputeActualSessionLoad({
      supabase,
      sessionId: parsed.data.sessionId,
      requireCompleted: false,
    });
  } catch (e) {
    console.error("recomputeActualSessionLoad (completion) failed:", e);
  }

  // DC-C14: rematerialise the per-region ledger now that this session is
  // counted. Idempotent; failures here shouldn't block the user from
  // marking the session complete, so we swallow + log.
  try {
    await recomputeRegionState(supabase, user.id, await getUserTimezone(user.id));
  } catch (e) {
    console.error("recomputeRegionState failed:", e);
  }

  // Auto-complete the block if this completion fills the last
  // un-touched planned_session. Resolve the block via the
  // planned_session linked to THIS session (link is established at
  // start time by startSessionFromPlan / startSessionDirect).
  // Failures here must never block the completion itself.
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
    console.error("maybeCompleteBlock failed:", e);
  }

  // After completion, scan for AMRAP top sets that warrant a TM bump
  // suggestion. Never auto-overwrites; only writes pending rows that the
  // user resolves from the Today banner. Failures here must never block
  // session completion.
  try {
    const { generateTmSuggestionsForSession } = await import(
      "@/lib/training-maxes/actions"
    );
    await generateTmSuggestionsForSession(parsed.data.sessionId);
  } catch (e) {
    console.error("generateTmSuggestionsForSession failed:", e);
  }

  // Bodyweight Phase 4 — bump weeks_at_node + evaluate TUT-gated
  // progression for each BW family in this session. Inserts a
  // bw_progression_events row when the gate opens.
  try {
    const { applyBwSessionCompletionSideEffects } = await import(
      "@/lib/sessions/bw-set-logging"
    );
    await applyBwSessionCompletionSideEffects({
      supabase,
      userId: user.id,
      sessionId: parsed.data.sessionId,
      timezone: await getUserTimezone(user.id),
    });
    revalidatePath("/app/settings/bodyweight-progression");
  } catch (e) {
    console.error("applyBwSessionCompletionSideEffects failed:", e);
  }

  // Bodyweight Phase 6 — capture a diagnostics snapshot after the
  // side-effects hook so any newly-opened gate, fresh TUT, or fresh
  // weeks_at_node is reflected in the stored payload. Non-blocking.
  try {
    const { captureBwDiagnosticsSnapshot } = await import(
      "@/lib/planner/bw-diagnostics-snapshot"
    );
    await captureBwDiagnosticsSnapshot({ supabase, userId: user.id });
  } catch (e) {
    console.error("captureBwDiagnosticsSnapshot (completion) failed:", e);
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/stats");
  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  redirect(`/app/sessions/${parsed.data.sessionId}`);
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

  revalidatePath("/app");
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

  revalidatePath("/app");
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
  set_kind: "warmup" | "main" | "back_off" | "accessory" | "tendon";
  weight_kg: number | null;
  reps: number | null;
  prescription_item_index: number | null;
};

const STRENGTH_KINDS: ReadonlyArray<SetInsert["set_kind"]> = [
  "warmup",
  "main",
  "back_off",
  "accessory",
  "tendon",
];

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
  const [plannedRes, existingRes, tmsRes] = await Promise.all([
    supabase
      .from("planned_sessions")
      .select("id, prescription")
      .eq("completed_session_id", parsed.data.sessionId)
      .maybeSingle(),
    supabase
      .from("set_logs")
      .select("movement_id, set_kind, set_index")
      .eq("session_id", parsed.data.sessionId),
    supabase
      .from("training_maxes")
      .select("movement_id, value_kg, movements!inner(slug)")
      .eq("user_id", user.id),
  ]);

  const planned = plannedRes.data as { id: string; prescription: Prescription | null } | null;
  if (!planned || !planned.prescription) {
    return { error: "No planned session is linked to this log." };
  }

  // Build a tm lookup by movement_id for percentTm resolution.
  const tmByMovementId = new Map<string, number>();
  for (const row of (tmsRes.data ?? []) as Array<{ movement_id: string; value_kg: number | string }>) {
    const v = Number(row.value_kg);
    if (Number.isFinite(v) && v > 0) tmByMovementId.set(row.movement_id, v);
  }

  // Group existing set_logs by (movement_id, set_kind) so the
  // idempotency check is O(1) per planned item.
  const existingByKey = new Map<string, number>();
  for (const r of (existingRes.data ?? []) as Array<{ movement_id: string; set_kind: string }>) {
    const key = `${r.movement_id}::${r.set_kind}`;
    existingByKey.set(key, (existingByKey.get(key) ?? 0) + 1);
  }

  const items = planned.prescription.items ?? [];
  let nextIndex = (existingRes.data ?? []).length;
  const inserts: SetInsert[] = [];

  for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
    const item = items[itemIdx] as PrescriptionItem;
    if (!STRENGTH_KINDS.includes(item.kind as SetInsert["set_kind"])) continue;
    const setKind = item.kind as SetInsert["set_kind"];
    const setCount = Math.max(1, item.sets ?? 1);
    const reps = item.reps ?? null;

    // Resolve target weight: percentTm × TM, rounded to plate. When no
    // TM is set we leave weight null — the user will be nudged by the
    // empty input, not by a guessed default.
    const tm = tmByMovementId.get(item.movementId);
    let weight: number | null = null;
    if (typeof item.percentTm === "number" && tm) {
      weight = roundToPlate(tm * (item.percentTm / 100));
    }

    const key = `${item.movementId}::${setKind}`;
    const alreadyHave = existingByKey.get(key) ?? 0;
    const need = Math.max(0, setCount - alreadyHave);
    for (let i = 0; i < need; i++) {
      inserts.push({
        session_id: parsed.data.sessionId,
        movement_id: item.movementId,
        set_index: nextIndex++,
        set_kind: setKind,
        weight_kg: weight,
        reps,
        prescription_item_index: itemIdx,
      });
    }
    // Update the existing map so the same movement appearing twice in
    // the plan (rare but possible) doesn't double-count.
    existingByKey.set(key, alreadyHave + need);
  }

  if (inserts.length === 0) {
    return { ok: true, inserted: 0 };
  }

  const { error } = await supabase.from("set_logs").insert(inserts);
  if (error) return { error: error.message };

  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true, inserted: inserts.length };
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

/**
 * Phase 2 C2 — apply Strava autofill.
 *
 * Looks up a previously-synced Strava cardio_logs row (verified to be
 * owned by the user via RLS-aware join), then inserts a new cardio_logs
 * row on the target session copying the duration / distance / HR / RPE.
 *
 * We deliberately copy ``strava_activity_id`` and ``external_source``
 * onto the new row so analytics (region ledger, mileage ramps) can
 * still see the Strava attribution. The original Strava-imported session
 * remains untouched; deduping it is a Phase 3 follow-up.
 */
const stravaAutofillSchema = z.object({
  sessionId: z.string().uuid(),
  cardioLogId: z.string().uuid(),
});

export async function applyStravaAutofill(
  formData: FormData,
): Promise<{ ok?: true; error?: string; cardioLogId?: string }> {
  const parsed = stravaAutofillSchema.safeParse({
    sessionId: formData.get("sessionId"),
    cardioLogId: formData.get("cardioLogId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  // Fetch the source row through a user-id join so RLS rules out
  // someone else's activity. ``external_source = 'strava'`` is the
  // narrow contract for this action.
  const { data: srcRaw, error: srcErr } = await supabase
    .from("cardio_logs")
    .select(
      "id, modality, duration_sec, distance_km, avg_hr_bpm, max_hr_bpm, avg_pace_sec_per_km, rpe, strava_activity_id, external_source, sessions!inner(user_id, deleted_at)",
    )
    .eq("id", parsed.data.cardioLogId)
    .eq("external_source", "strava")
    .eq("sessions.user_id", user.id)
    .is("sessions.deleted_at", null)
    .maybeSingle();
  if (srcErr) return { error: srcErr.message };
  if (!srcRaw) return { error: "Strava activity not found." };

  const src = srcRaw as {
    id: string;
    modality: string;
    duration_sec: number;
    distance_km: number | string | null;
    avg_hr_bpm: number | null;
    max_hr_bpm: number | null;
    avg_pace_sec_per_km: number | null;
    rpe: number | string | null;
    strava_activity_id: string | null;
    external_source: string | null;
  };

  // Verify the target session is owned by the user before inserting.
  const { data: target, error: tErr } = await supabase
    .from("sessions")
    .select("id, user_id, deleted_at")
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (tErr) return { error: tErr.message };
  if (!target) return { error: "Session not found." };

  const { count } = await supabase
    .from("cardio_logs")
    .select("id", { count: "exact", head: true })
    .eq("session_id", parsed.data.sessionId);

  const { data: inserted, error: insErr } = await supabase
    .from("cardio_logs")
    .insert({
      session_id: parsed.data.sessionId,
      block_index: count ?? 0,
      modality: src.modality,
      duration_sec: src.duration_sec,
      distance_km: src.distance_km,
      avg_hr_bpm: src.avg_hr_bpm,
      max_hr_bpm: src.max_hr_bpm,
      avg_pace_sec_per_km: src.avg_pace_sec_per_km,
      rpe: src.rpe,
      strava_activity_id: src.strava_activity_id,
      external_source: src.external_source,
      notes: "Autofilled from Strava",
    })
    .select("id")
    .maybeSingle();
  if (insErr) return { error: insErr.message };

  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true, cardioLogId: inserted?.id };
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
