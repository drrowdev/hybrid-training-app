"use server";

/**
 * createProgramInstance — deploy a platform program for the signed-in user.
 *
 * This is the write path that replaces the archetype `createBlock` for platform
 * programs. It is intentionally NOT wired to any UI yet (the program picker
 * lands in a later PR); shipping it standalone keeps the change reviewable and
 * means no platform block can be created in prod until the picker is wired.
 *
 * Flow (all under the signed-in user's RLS — never the service role):
 *   buildPlatformContext  → engine.setup → buildProgramInstanceWrite
 *   → insert training_blocks → insert planned_sessions
 *   → seed training_maxes.tm_percent → insert program_instances
 *   → archive any prior active block + program instance.
 *
 * Guardrails: explicit auth check, Zod `.strict()` on input, user-scoped client,
 * and best-effort cleanup so a partial failure never leaves an orphan block.
 *
 * A platform block stores its identity in `training_blocks.program_id` /
 * `program_family` (archetype is left NULL); `program_instances` links to it via
 * `block_id` and holds the serialised engine instance.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { ARCHETYPES } from "@/lib/planner/archetypes";
import type { HybridInstance } from "@/lib/programs/hybrid/engine";
import { buildPlatformContext } from "./context";
import { getProgramEngine, getNativeProgramEngine, isNativeProgram } from "./registry";
import { buildProgramInstanceWrite } from "./program-instance";

const WEEKDAY = z.number().int().min(0).max(6);

const createProgramInstanceSchema = z
  .object({
    programId: z.string().min(1),
    /** Engine setup values (template, cycle structure, …) — engine-specific. */
    setupValues: z.record(z.unknown()).default({}),
    /** Strength weekdays (0 = Mon … 6 = Sun), one per session in a program-week. */
    weekdays: z.array(WEEKDAY).min(1).max(7),
    /** Block start date, YYYY-MM-DD. */
    startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startedOn must be YYYY-MM-DD"),
    /** Plate rounding override (kg); defaults to 2.5. */
    roundingKg: z.number().positive().optional(),
  })
  .strict();

export type CreateProgramInstanceInput = z.input<typeof createProgramInstanceSchema>;

export type CreateProgramInstanceResult =
  | { ok: true; blockId: string; programInstanceId: string; skipped: number }
  | { ok: false; error: string };

export async function createProgramInstance(
  input: CreateProgramInstanceInput,
): Promise<CreateProgramInstanceResult> {
  const parsed = createProgramInstanceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { programId, setupValues, weekdays, startedOn, roundingKg } = parsed.data;

  // Reject duplicate weekdays — they'd collide on the (week, day, slot) unique key.
  // (Native programs own their own calendar and ignore `weekdays`, but the check
  // is harmless and keeps the input contract uniform.)
  if (new Set(weekdays).size !== weekdays.length) {
    return { ok: false, error: "Training weekdays must be distinct." };
  }

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Same user-scoped client (RLS) for BOTH paths — never the service role.
  const supabase = await createClient();

  if (isNativeProgram(programId)) {
    return createNativeProgramInstance(supabase, user, {
      programId,
      setupValues,
      weekdays,
      startedOn,
      ...(roundingKg != null ? { roundingKg } : {}),
    });
  }
  return createForeignProgramInstance(supabase, user, {
    programId,
    setupValues,
    weekdays,
    startedOn,
    ...(roundingKg != null ? { roundingKg } : {}),
  });
}

/** Parsed, validated deploy input shared by both write paths. */
interface DeployArgs {
  programId: string;
  setupValues: Record<string, unknown>;
  weekdays: number[];
  startedOn: string;
  roundingKg?: number;
}

/**
 * Foreign per-session engine deploy (5/3/1, Tactical Barbell, Green Protocol).
 * Behaviour is byte-identical to the pre-refactor inline flow.
 */
async function createForeignProgramInstance(
  supabase: SupabaseClient,
  user: User,
  { programId, setupValues, weekdays, startedOn, roundingKg }: DeployArgs,
): Promise<CreateProgramInstanceResult> {
  const engine = getProgramEngine(programId);
  if (!engine) return { ok: false, error: `Unknown program '${programId}'.` };

  // Shared strength state → engine setup → materialised plan + TM alignment.
  let write;
  let instance: unknown;
  try {
    const { ctx, resolveMovement } = await buildPlatformContext(supabase, user.id, {
      ...(roundingKg != null ? { roundingKg } : {}),
    });
    instance = engine.setup({ values: setupValues }, ctx);
    write = buildProgramInstanceWrite({
      engine,
      instance,
      ctx,
      resolveMovement,
      weekdays,
      startedOn,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Setup failed" };
  }

  if (write.sessions.length === 0) {
    return { ok: false, error: "This program produced no sessions — check your training maxes." };
  }

  // 1) training_blocks — platform block: archetype NULL, identity in program_* columns.
  const { data: block, error: blockErr } = await supabase
    .from("training_blocks")
    .insert({
      user_id: user.id,
      archetype: null,
      program_id: programId,
      program_family: engine.meta.family,
      started_on: startedOn,
      weeks: write.weeks,
      status: "active",
      days_per_week: write.daysPerWeek,
      day_index_overrides: write.dayIndexOverrides,
      notes: engine.meta.name,
    })
    .select("id")
    .single();
  if (blockErr || !block) {
    return { ok: false, error: blockErr?.message ?? "Failed to create block" };
  }
  const blockId = block.id as string;

  // 2) planned_sessions
  const rows = write.sessions.map((s) => ({
    block_id: blockId,
    user_id: user.id,
    week_index: s.weekIndex,
    day_index: s.dayIndex,
    slot: s.slot,
    title: s.title,
    role: s.role,
    prescription: s.prescription,
    session_modality: s.sessionModality,
    effective_stress_load: s.effectiveStressLoad,
  }));
  const { error: psErr } = await supabase.from("planned_sessions").insert(rows);
  if (psErr) {
    await supabase.from("training_blocks").delete().eq("id", blockId);
    return { ok: false, error: `Couldn't create planned sessions: ${psErr.message}` };
  }

  // 3) seed training_maxes.tm_percent so the engine's % render correct weights.
  //    tm_percent lives on the SHARED training_maxes (per user+movement, not
  //    block-scoped), so capture the prior values first and restore them on any
  //    later failure — a half-applied seed would corrupt the user's strength
  //    state for future programs.
  const movementIds = write.tmPercents.map((s) => s.movementId);
  const priorTmPercent = new Map<string, number | string | null>();
  if (movementIds.length > 0) {
    const { data: priorRows, error: priorErr } = await supabase
      .from("training_maxes")
      .select("movement_id, tm_percent")
      .eq("user_id", user.id)
      .in("movement_id", movementIds);
    if (priorErr) {
      await supabase.from("planned_sessions").delete().eq("block_id", blockId);
      await supabase.from("training_blocks").delete().eq("id", blockId);
      return { ok: false, error: `Couldn't read training maxes: ${priorErr.message}` };
    }
    for (const r of priorRows ?? []) {
      priorTmPercent.set(r.movement_id as string, (r.tm_percent as number | string | null) ?? null);
    }
  }
  const restoreTmPercents = async () => {
    for (const seed of write.tmPercents) {
      await supabase
        .from("training_maxes")
        .update({ tm_percent: priorTmPercent.get(seed.movementId) ?? null })
        .eq("user_id", user.id)
        .eq("movement_id", seed.movementId);
    }
  };
  const rollbackBlock = async () => {
    await restoreTmPercents();
    await supabase.from("planned_sessions").delete().eq("block_id", blockId);
    await supabase.from("training_blocks").delete().eq("id", blockId);
  };

  for (const seed of write.tmPercents) {
    const { error: tmErr } = await supabase
      .from("training_maxes")
      .update({ tm_percent: seed.tmPercent })
      .eq("user_id", user.id)
      .eq("movement_id", seed.movementId);
    if (tmErr) {
      await rollbackBlock();
      return { ok: false, error: `Couldn't align training maxes: ${tmErr.message}` };
    }
  }

  // 4) program_instances (the source of truth for program identity).
  const { data: pi, error: piErr } = await supabase
    .from("program_instances")
    .insert({
      user_id: user.id,
      program_id: programId,
      program_family: engine.meta.family,
      instance,
      setup_input: { values: setupValues, weekdays, startedOn },
      block_id: blockId,
      status: "active",
    })
    .select("id")
    .single();
  if (piErr || !pi) {
    await rollbackBlock();
    return { ok: false, error: piErr?.message ?? "Failed to create program instance" };
  }

  // 5) archive any prior active block + program instance (one active at a time).
  await supabase
    .from("training_blocks")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("id", blockId);
  await supabase
    .from("program_instances")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("id", pi.id);

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/stats");

  return { ok: true, blockId, programInstanceId: pi.id as string, skipped: write.skipped.length };
}

/**
 * Native (block-level) engine deploy — Hybrid (ADR 0046 Phase 2).
 *
 * Mirrors the foreign path's guardrails EXACTLY: same user-scoped client, the
 * same explicit `user_id` ownership match on every query, and complete rollback
 * on every failure path. The differences are structural, not security:
 *   - the engine materialises the WHOLE block at once (`materializeNative`),
 *     reusing the shared `assembleBlockSessions` rows directly, and
 *   - it does NOT seed `training_maxes.tm_percent`: Hybrid renders %TM off the
 *     user's real training maxes (exactly like the legacy archetype path), so
 *     there is no engine-derived TM basis to seed.
 *
 * `weekdays` is ignored here — Hybrid owns its weekly calendar (archetype +
 * daysPerWeek), like Green Protocol. The block's `weeks`, `days_per_week` and
 * `day_index_overrides` come from the engine instance.
 */
async function createNativeProgramInstance(
  supabase: SupabaseClient,
  user: User,
  { programId, setupValues, weekdays, startedOn, roundingKg }: DeployArgs,
): Promise<CreateProgramInstanceResult> {
  const engine = getNativeProgramEngine(programId)!;

  // Setup → instance. `setupHybrid` reads `values.startedOn`, so inject it.
  // ctx is built uniformly with the foreign path (Hybrid's setup ignores it).
  // The native registry is generic (`unknown` instance); this branch owns the
  // Hybrid contract, so we read the instance as a `HybridInstance`.
  //
  // `focusMuscles` is a 0–2 array, but the generic picker renders it as a
  // single-select and sends a bare string — coerce so deploy doesn't throw in
  // the array schema (rich multi-select UX is a later step).
  const values: Record<string, unknown> = { ...setupValues, startedOn };
  if (typeof values.focusMuscles === "string") {
    const fm = values.focusMuscles.trim();
    values.focusMuscles = fm ? [fm] : [];
  }
  let instance: HybridInstance;
  try {
    const { ctx } = await buildPlatformContext(supabase, user.id, {
      ...(roundingKg != null ? { roundingKg } : {}),
    });
    instance = engine.setup({ values }, ctx) as HybridInstance;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Setup failed" };
  }

  // Derive the block shape from the instance (Hybrid owns its own calendar).
  const archetypeId = instance.archetypeId as keyof typeof ARCHETYPES;
  const archetype = ARCHETYPES[archetypeId];
  if (!archetype) return { ok: false, error: `Unknown goal preset '${String(archetypeId)}'.` };
  const weeks = archetype.weeks;
  const daysPerWeek = instance.daysPerWeek;
  const dayIndexOverrides = instance.dayIndexOverrides;

  // 1) training_blocks — platform block: archetype NULL, identity in program_* columns.
  const { data: block, error: blockErr } = await supabase
    .from("training_blocks")
    .insert({
      user_id: user.id,
      archetype: null,
      program_id: programId,
      program_family: engine.meta.family,
      started_on: startedOn,
      weeks,
      status: "active",
      days_per_week: daysPerWeek,
      day_index_overrides: dayIndexOverrides,
      notes: engine.meta.name,
    })
    .select("id")
    .single();
  if (blockErr || !block) {
    return { ok: false, error: blockErr?.message ?? "Failed to create block" };
  }
  const blockId = block.id as string;

  const deleteBlock = async () => {
    await supabase.from("training_blocks").delete().eq("id", blockId).eq("user_id", user.id);
  };
  const rollbackBlock = async () => {
    await supabase.from("planned_sessions").delete().eq("block_id", blockId).eq("user_id", user.id);
    await deleteBlock();
  };

  // 2) materialise the WHOLE block via the shared assembly path.
  const mat = await engine.materializeNative(instance, supabase, user.id, blockId);
  if (!mat.ok) {
    await deleteBlock();
    return { ok: false, error: mat.error };
  }
  if (mat.rows.length === 0) {
    await deleteBlock();
    return { ok: false, error: "This program produced no sessions — check your training maxes." };
  }

  // 3) planned_sessions — rows already carry block_id/user_id/snake_case columns.
  const { error: psErr } = await supabase.from("planned_sessions").insert(mat.rows);
  if (psErr) {
    await deleteBlock();
    return { ok: false, error: `Couldn't create planned sessions: ${psErr.message}` };
  }

  // NOTE: no training_maxes.tm_percent seed — Hybrid reads the user's real TMs.

  // 4) program_instances (the source of truth for program identity).
  const { data: pi, error: piErr } = await supabase
    .from("program_instances")
    .insert({
      user_id: user.id,
      program_id: programId,
      program_family: engine.meta.family,
      instance,
      setup_input: { values: setupValues, weekdays, startedOn },
      block_id: blockId,
      status: "active",
    })
    .select("id")
    .single();
  if (piErr || !pi) {
    await rollbackBlock();
    return { ok: false, error: piErr?.message ?? "Failed to create program instance" };
  }

  // 5) archive any prior active block + program instance (one active at a time).
  await supabase
    .from("training_blocks")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("id", blockId);
  await supabase
    .from("program_instances")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("id", pi.id);

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/stats");

  return { ok: true, blockId, programInstanceId: pi.id as string, skipped: 0 };
}

/**
 * Dismiss a pending program recommendation (the Today banner's "Got it"). RLS
 * scopes the update to the signed-in user; the explicit user_id match is
 * belt-and-suspenders.
 */
export async function dismissProgramRecommendation(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid id" };

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("program_recommendations")
    .update({ status: "dismissed", resolved_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("user_id", user.id)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  return { ok: true };
}
