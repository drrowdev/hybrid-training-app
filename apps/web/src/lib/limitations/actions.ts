"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  limitationFormSchema,
  type LimitationActionResult,
  type LimitationFormInput,
} from "./schema";

const REGIONS = [
  "foot_ankle_calf",
  "knee",
  "hamstring_posterior",
  "adductor_groin",
  "lumbar_trunk",
  "shoulder_scapular",
  "elbow_forearm",
] as const;

/**
 * Best-effort region inference for new rows added through the
 * /app/recovery/injuries muscle picker, which doesn't ask the user
 * for a region. The engine's existing DC-V safety gates still read
 * `limitations.region`, so a row with no region is invisible to them.
 *
 * Mapping is intentionally lossy (16 muscles → 7 regions). Picks the
 * first match in the user's selection; if no muscle maps cleanly we
 * leave `region` null and rely on the muscle/movement arrays.
 */
const MUSCLE_TO_REGION: Record<string, (typeof REGIONS)[number]> = {
  calves: "foot_ankle_calf",
  quads: "knee",
  hamstrings: "hamstring_posterior",
  glutes: "hamstring_posterior",
  adductors: "adductor_groin",
  erectors: "lumbar_trunk",
  core: "lumbar_trunk",
  obliques: "lumbar_trunk",
  shoulders: "shoulder_scapular",
  traps: "shoulder_scapular",
  lats: "shoulder_scapular",
  back: "shoulder_scapular",
  chest: "shoulder_scapular",
  biceps: "elbow_forearm",
  triceps: "elbow_forearm",
  forearms: "elbow_forearm",
};

function inferRegion(muscles: string[]): (typeof REGIONS)[number] | null {
  for (const m of muscles) {
    const r = MUSCLE_TO_REGION[m];
    if (r) return r;
  }
  return null;
}

const limitationSchema = z.object({
  region: z.enum(REGIONS),
  severity: z.enum(["mild", "moderate", "severe"]),
  startedAt: z.string().date().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function addLimitation(formData: FormData): Promise<void> {
  const parsed = limitationSchema.safeParse({
    region: formData.get("region"),
    severity: formData.get("severity"),
    startedAt: formData.get("startedAt") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("limitations").insert({
    user_id: user.id,
    region: parsed.data.region,
    severity: parsed.data.severity,
    started_at: parsed.data.startedAt || new Date().toISOString(),
    notes: parsed.data.notes ?? null,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/app");
  revalidatePath("/app/settings/limitations");
}

const editSchema = z.object({
  id: z.string().uuid(),
  severity: z.enum(["mild", "moderate", "severe"]).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function editLimitation(formData: FormData): Promise<void> {
  const parsed = editSchema.safeParse({
    id: formData.get("id"),
    severity: formData.get("severity") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const updates: Record<string, unknown> = {};
  if (parsed.data.severity !== undefined) updates.severity = parsed.data.severity;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

  const { error } = await supabase
    .from("limitations")
    .update(updates)
    .eq("id", parsed.data.id);
  if (error) throw new Error(error.message);

  revalidatePath("/app/settings/limitations");
}

export async function resolveLimitation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("limitations")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/app");
  revalidatePath("/app/settings/limitations");
}

export async function reopenLimitation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("limitations")
    .update({ resolved_at: null })
    .eq("id", id);
  revalidatePath("/app");
  revalidatePath("/app/settings/limitations");
}

export async function deleteLimitation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("limitations").delete().eq("id", id);
  revalidatePath("/app/settings/limitations");
  revalidatePath("/app/recovery/injuries");
}

// ─── New /app/recovery/injuries shape ──────────────────────────────
//
// The settings-page form actions above only know about `region`,
// `severity`, and `notes`. The new self-serve page (PR #__ — this
// branch) feeds a richer object through `createLimitation` /
// `updateLimitation`: kind, muscles[], movement-ids[], expected
// duration. We expose those as typed server actions taking a plain
// object so the client modal doesn't have to encode/decode FormData
// for arrays. The Zod schema lives in ./schema so it can be imported
// from both client and server modules.

export async function createLimitation(
  input: LimitationFormInput,
): Promise<LimitationActionResult> {
  const parsed = limitationFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const inferred = inferRegion(parsed.data.affectedMuscles);

  const { data, error } = await supabase
    .from("limitations")
    .insert({
      user_id: user.id,
      kind: parsed.data.kind,
      severity: parsed.data.severity,
      region: inferred,
      affected_muscles: parsed.data.affectedMuscles,
      affected_movement_ids: parsed.data.affectedMovementIds,
      allowed_movement_ids: parsed.data.allowedMovementIds,
      affected_side: parsed.data.affectedSide,
      notes: parsed.data.notes ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }

  // Append-only audit row for the lifecycle timeline (migration 0070).
  // Best-effort: if the events insert fails we still return ok so the
  // limitation isn't orphaned UX-wise. Errors are logged for ops.
  const eventInsert = await supabase.from("limitation_events").insert({
    limitation_id: data.id,
    user_id: user.id,
    kind: "started",
  });
  if (eventInsert.error) {
    console.warn(
      "[limitations] started-event insert failed",
      eventInsert.error.message,
    );
  }

  revalidatePath("/app");
  revalidatePath("/app/recovery/injuries");
  revalidatePath("/app/settings/limitations");
  return { ok: true, id: data.id };
}

export async function updateLimitation(
  id: string,
  input: LimitationFormInput,
): Promise<LimitationActionResult> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  const parsed = limitationFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const inferred = inferRegion(parsed.data.affectedMuscles);
  const { error } = await supabase
    .from("limitations")
    .update({
      kind: parsed.data.kind,
      severity: parsed.data.severity,
      region: inferred,
      affected_muscles: parsed.data.affectedMuscles,
      affected_movement_ids: parsed.data.affectedMovementIds,
      allowed_movement_ids: parsed.data.allowedMovementIds,
      affected_side: parsed.data.affectedSide,
      notes: parsed.data.notes ?? null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/app");
  revalidatePath("/app/recovery/injuries");
  revalidatePath("/app/settings/limitations");
  return { ok: true, id };
}

/**
 * Replace the per-exercise allow-list on an existing limitation. The
 * "Engine will block" preview in AddLimitationModal writes through
 * this after the limitation is created so each toggle is a single
 * round-trip, no event row needed.
 */
export async function updateLimitationAllowedMovements(
  id: string,
  allowedIds: string[],
): Promise<LimitationActionResult> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  const arr = z.array(z.string().uuid()).max(80).safeParse(allowedIds);
  if (!arr.success) return { ok: false, error: "Invalid movement ids" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("limitations")
    .update({ allowed_movement_ids: arr.data })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app");
  revalidatePath("/app/recovery/injuries");
  return { ok: true, id };
}

/**
 * Mark a limitation resolved. Idempotent — if `resolved_at` is
 * already set we do not write a second event. Inserts a
 * `limitation_events` row `kind='resolved'` with the optional note.
 */
export async function resolveLimitationById(
  id: string,
  note?: string,
): Promise<LimitationActionResult> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: existing, error: readErr } = await supabase
    .from("limitations")
    .select("id, resolved_at")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!existing) return { ok: false, error: "Not found" };
  if (existing.resolved_at !== null) {
    // Idempotent — already resolved, no-op.
    return { ok: true, id };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("limitations")
    .update({ resolved_at: now })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const eventInsert = await supabase.from("limitation_events").insert({
    limitation_id: id,
    user_id: user.id,
    kind: "resolved",
    occurred_at: now,
    note: note ?? null,
  });
  if (eventInsert.error) {
    console.warn(
      "[limitations] resolved-event insert failed",
      eventInsert.error.message,
    );
  }

  revalidatePath("/app");
  revalidatePath("/app/recovery/injuries");
  revalidatePath("/app/settings/limitations");
  return { ok: true, id };
}

/**
 * Reopen a previously-resolved limitation. Idempotent — if
 * `resolved_at` is already NULL we do not write a second event.
 */
export async function reopenLimitationById(
  id: string,
  note?: string,
): Promise<LimitationActionResult> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: existing, error: readErr } = await supabase
    .from("limitations")
    .select("id, resolved_at")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!existing) return { ok: false, error: "Not found" };
  if (existing.resolved_at === null) {
    // Idempotent — already active, no-op.
    return { ok: true, id };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("limitations")
    .update({ resolved_at: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const eventInsert = await supabase.from("limitation_events").insert({
    limitation_id: id,
    user_id: user.id,
    kind: "reopened",
    occurred_at: now,
    note: note ?? null,
  });
  if (eventInsert.error) {
    console.warn(
      "[limitations] reopened-event insert failed",
      eventInsert.error.message,
    );
  }

  revalidatePath("/app");
  revalidatePath("/app/recovery/injuries");
  revalidatePath("/app/settings/limitations");
  return { ok: true, id };
}

export async function deleteLimitationById(
  id: string,
): Promise<LimitationActionResult> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("limitations").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/recovery/injuries");
  revalidatePath("/app/settings/limitations");
  return { ok: true, id };
}
