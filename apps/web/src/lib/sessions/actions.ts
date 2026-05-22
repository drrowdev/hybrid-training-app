"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { recomputeRegionState } from "@/lib/engine/region-ledger";
import { getUserTimezone } from "@/lib/planner/queries";

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

  revalidatePath("/app");
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

export async function deleteSession(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("sessions").delete().eq("id", id);
  revalidatePath("/app");
  redirect("/app");
}
