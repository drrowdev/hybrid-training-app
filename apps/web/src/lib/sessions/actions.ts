"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { recomputeRegionState } from "@/lib/engine/region-ledger";
import { maybeCompleteBlock } from "@/lib/planner/completion";
import { getUserTimezone } from "@/lib/planner/queries";
import { roundToPlate } from "@/lib/planner/archetypes";
import type { Prescription, PrescriptionItem } from "@hta/db";

const checkInSchema = z.object({
  fatigue: z.coerce.number().int().min(1).max(5).nullable().optional(),
  soreness: z.coerce.number().int().min(1).max(5).nullable().optional(),
  title: z.string().trim().max(120).optional(),
});

/** Create a new session and redirect to its detail page. */
export async function startSession(formData: FormData): Promise<void> {
  const parsed = checkInSchema.safeParse({
    fatigue: formData.get("fatigue") || undefined,
    soreness: formData.get("soreness") || undefined,
    title: formData.get("title") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      fatigue: parsed.data.fatigue ?? null,
      soreness: parsed.data.soreness ?? null,
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
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { reps, durationSec, distanceM } = parsed.data;
  if (!reps && !durationSec && !distanceM) {
    return { error: "Log at least reps, a hold duration, or a distance." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
    weight_kg: parsed.data.weightKg ?? null,
    reps: parsed.data.reps ?? null,
    duration_sec: parsed.data.durationSec ?? null,
    distance_m: parsed.data.distanceM ?? null,
    rpe: parsed.data.rpe ?? null,
    notes: parsed.data.notes ?? null,
  });

  if (error) return { error: error.message };

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
  } = await supabase.auth.getUser();
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

export async function deleteSet(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!id || !sessionId) return;

  const supabase = await createClient();
  await supabase.from("set_logs").delete().eq("id", id);
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
  if (sessionId) revalidatePath(`/app/sessions/${sessionId}`);
  redirect(`/app/sessions/${sessionId}`);
}

export async function deleteCardio(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!id || !sessionId) return;

  const supabase = await createClient();
  await supabase.from("cardio_logs").delete().eq("id", id);
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
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Auto-derive session RPE from per-set RPEs (volume-weighted).
  // Auto-derive duration from the gap between first and last set timestamps.
  // No user prompt — keeps the wrap-up flow to a single tap.
  const { data: sets } = await supabase
    .from("set_logs")
    .select("weight_kg, reps, rpe, created_at")
    .eq("session_id", parsed.data.sessionId);
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
  // start time by startSessionFromPlan / startCheckInSession).
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

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  redirect(`/app/sessions/${parsed.data.sessionId}`);
}

export async function recomputeRegionStateAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  } = await supabase.auth.getUser();
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
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("sessions")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  revalidatePath("/app/sessions");
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
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  revalidatePath("/app/sessions");
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
  } = await supabase.auth.getUser();
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

  for (const item of items as PrescriptionItem[]) {
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
  } = await supabase.auth.getUser();
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

const stravaAutofillSchema = z.object({
  sessionId: z.string().uuid(),
  cardioLogId: z.string().uuid(),
});

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
  } = await supabase.auth.getUser();
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
