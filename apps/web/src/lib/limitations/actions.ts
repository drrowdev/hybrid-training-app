"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { loadPickerCatalog } from "@/lib/planner/picker-catalog";
import { readLimitationsContext } from "@/lib/planner/limitations-context";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import {
  applyPrescriptionUpdates,
  getActiveBlockRemainingSessions,
} from "@/lib/planner/remaining-sessions";
import { buildLimitationResponse, buildSelectedUpdates } from "./response";
import { REGIONS, resolveRegion } from "./region";
import {
  limitationFormSchema,
  type LimitationActionResult,
  type LimitationFormInput,
} from "./schema";

/**
 * Best-effort region inference for new rows added through the
 * /app/recovery/injuries muscle picker, which doesn't ask the user
 * for a region. The engine's existing DC-V safety gates still read
 * `limitations.region`, so a row with no region is invisible to them.
 *
 * The muscle→region map and the inference / resolution helpers live in
 * `./region` (a pure module) so they can be unit-tested and reused.
 */

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

  const region = resolveRegion(
    parsed.data.region,
    parsed.data.affectedMuscles,
  );

  const { data, error } = await supabase
    .from("limitations")
    .insert({
      user_id: user.id,
      kind: parsed.data.kind,
      severity: parsed.data.severity,
      region,
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
  const region = resolveRegion(
    parsed.data.region,
    parsed.data.affectedMuscles,
  );
  const { error } = await supabase
    .from("limitations")
    .update({
      kind: parsed.data.kind,
      severity: parsed.data.severity,
      region,
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

// ─── ADR 0014: mid-block limitation response ───────────────────────
//
// After a limitation is created / edited mid-block, the already-
// materialized future sessions can still load the newly-flagged tissue.
// `applyLimitationResponse` re-derives the deterministic remediation
// plan from the user's CURRENT live state (never trusting a client
// payload) and persists every safe swap / drop. Warn-only main-lift
// offenders are surfaced in the UI but deliberately left untouched.

export type ApplyLimitationResult =
  | { ok: true; swapped: number; dropped: number; sessions: number }
  | { ok: false; error: string };

/** Form-friendly wrapper (Next form actions require Promise<void>). */
export async function applyLimitationResponse(): Promise<void> {
  await applyLimitationResponseResult();
}

export async function applyLimitationResponseResult(): Promise<ApplyLimitationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const active = await getActiveBlockRemainingSessions(supabase, user.id);
  if (!active || active.remaining.length === 0) {
    return { ok: true, swapped: 0, dropped: 0, sessions: 0 };
  }

  const ctx = await readLimitationsContext(supabase, user.id);
  const hasLimits =
    ctx.blockedRegions.size > 0 ||
    ctx.blockedMuscles.size > 0 ||
    ctx.blockedMovementIds.size > 0;
  if (!hasLimits) return { ok: true, swapped: 0, dropped: 0, sessions: 0 };

  const catalog = await loadPickerCatalog(supabase);
  const { data: legacyProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  const legacyEquipment = resolveEquipment(legacyProfile ?? null);
  const plan = buildLimitationResponse(active.remaining, catalog, ctx, legacyEquipment);
  if (plan.updates.length === 0) {
    return { ok: true, swapped: 0, dropped: 0, sessions: 0 };
  }

  const { updated, error } = await applyPrescriptionUpdates(
    supabase,
    user.id,
    active.blockId,
    plan.updates,
  );
  if (error) return { ok: false, error };

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/sessions");
  revalidatePath("/app/settings/limitations");
  revalidatePath("/app/recovery/injuries");

  return {
    ok: true,
    swapped: plan.swaps.length,
    dropped: plan.drops.length,
    sessions: updated,
  };
}

/**
 * Per-item variant of the apply action (ADR 0014 review UX). The review card
 * sends the set of swap/drop keys the user kept checked, plus an optional map of
 * per-movement target choices. We RE-DERIVE the full plan from the user's
 * current live state — never trusting the client for the content of any change —
 * then `buildSelectedUpdates` narrows it to the approved keys and honours a
 * chosen target only when it's one of the engine-offered alternatives. Unknown
 * keys / choices are ignored, so the client can only ever apply a subset of what
 * the engine independently deemed safe. An empty selection is a no-op.
 */
export async function applyLimitationResponseSelection(
  selectedKeys: string[],
  choices: Record<string, string> = {},
): Promise<ApplyLimitationResult> {
  const parsed = z
    .array(z.string().min(1).max(120))
    .max(1000)
    .safeParse(selectedKeys);
  if (!parsed.success) return { ok: false, error: "Invalid selection" };
  const parsedChoices = z
    .record(z.string().min(1).max(80), z.string().min(1).max(80))
    .safeParse(choices);
  if (!parsedChoices.success) return { ok: false, error: "Invalid choices" };
  const selected = new Set(parsed.data);
  const choiceMap = new Map(Object.entries(parsedChoices.data));
  if (selected.size === 0) {
    return { ok: true, swapped: 0, dropped: 0, sessions: 0 };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const active = await getActiveBlockRemainingSessions(supabase, user.id);
  if (!active || active.remaining.length === 0) {
    return { ok: true, swapped: 0, dropped: 0, sessions: 0 };
  }

  const ctx = await readLimitationsContext(supabase, user.id);
  const hasLimits =
    ctx.blockedRegions.size > 0 ||
    ctx.blockedMuscles.size > 0 ||
    ctx.blockedMovementIds.size > 0;
  if (!hasLimits) return { ok: true, swapped: 0, dropped: 0, sessions: 0 };

  const catalog = await loadPickerCatalog(supabase);
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  const equipment = resolveEquipment(profile ?? null);
  const plan = buildLimitationResponse(active.remaining, catalog, ctx, equipment);
  const { updates, swapped, dropped } = buildSelectedUpdates(
    active.remaining,
    plan,
    selected,
    choiceMap,
  );
  if (updates.length === 0) {
    return { ok: true, swapped: 0, dropped: 0, sessions: 0 };
  }

  const { updated, error } = await applyPrescriptionUpdates(
    supabase,
    user.id,
    active.blockId,
    updates,
  );
  if (error) return { ok: false, error };

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/sessions");
  revalidatePath("/app/settings/limitations");
  revalidatePath("/app/recovery/injuries");

  return { ok: true, swapped, dropped, sessions: updated };
}
