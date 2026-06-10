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
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { buildPlatformContext } from "./context";
import { getProgramEngine } from "./registry";
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
  if (new Set(weekdays).size !== weekdays.length) {
    return { ok: false, error: "Training weekdays must be distinct." };
  }

  const engine = getProgramEngine(programId);
  if (!engine) return { ok: false, error: `Unknown program '${programId}'.` };

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();

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
      notes: `${engine.meta.name} — platform program`,
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
