"use server";

/**
 * Season server actions (ADR 0051 Phase 0). CRUD over the Season roadmap, all
 * user-scoped (RLS): explicit auth + `user_id` ownership match on every write,
 * Zod `.strict()` input, user-scoped Supabase client (never service-role).
 *
 * Phase 0 is data-only sequencing — no materialisation, no event anchor, no
 * balance floors. Activation (wiring a block into the program wizard) and the
 * Season-aware nudge land in a later slice.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { isMissingRpc } from "@/lib/supabase/rpc-errors";
import {
  MAX_SEASON_BLOCKS,
  SEASON_EMPHASIS_VALUES,
  applyReorder,
} from "./season-logic";

export type SeasonActionResult =
  | { ok: true; seasonId?: string }
  | { ok: false; error: string };

const emphasisSchema = z.enum(
  SEASON_EMPHASIS_VALUES as unknown as [string, ...string[]],
);

const blockInputSchema = z
  .object({
    programId: z.string().min(1).max(64),
    templateRef: z.string().max(64).nullish(),
    emphasis: emphasisSchema.default("base"),
    intentNote: z.string().max(280).nullish(),
    plannedWeeks: z.number().int().min(1).max(24).nullish(),
  })
  .strict();

const goalSchema = z
  .object({
    goalType: z.enum(["event", "theme"]),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    targetEventId: z.string().uuid().nullish(),
  })
  .strict();

const createSeasonSchema = z
  .object({
    name: z.string().min(1).max(80),
    blocks: z.array(blockInputSchema).min(1).max(MAX_SEASON_BLOCKS),
    goal: goalSchema.nullish(),
  })
  .strict();

function revalidateSeason() {
  revalidatePath("/app/plan");
  revalidatePath("/app");
}

/**
 * Create a new active Season from an ordered list of blocks. Archives any prior
 * active Season (one active per user, like program_instances). Blocks are
 * inserted at contiguous positions 0..n.
 */
export async function createSeason(input: unknown): Promise<SeasonActionResult> {
  const parsed = createSeasonSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const { data: seasonId, error } = await supabase.rpc(
    "create_training_season_atomically",
    {
      p_name: parsed.data.name,
      p_goal: {
        goalType: parsed.data.goal?.goalType ?? null,
        targetDate: parsed.data.goal?.targetDate ?? null,
        targetEventId: parsed.data.goal?.targetEventId ?? null,
      },
      p_blocks: parsed.data.blocks.map((block, position) => ({
        position,
        program_id: block.programId,
        template_ref: block.templateRef ?? null,
        emphasis: block.emphasis,
        intent_note: block.intentNote ?? null,
        planned_weeks: block.plannedWeeks ?? null,
      })),
    },
  );
  if (error && !isMissingRpc(error)) {
    return {
      ok: false,
      error: error?.message ?? "Couldn't create the season.",
    };
  }
  if (isMissingRpc(error)) {
    const { error: abandonError } = await supabase
      .from("training_seasons")
      .update({ status: "abandoned", updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("status", "active");
    if (abandonError) return { ok: false, error: abandonError.message };

    const { data: legacySeason, error: seasonError } = await supabase
      .from("training_seasons")
      .insert({
        user_id: user.id,
        name: parsed.data.name,
        status: "active",
        ...(parsed.data.goal
          ? {
              goal_type: parsed.data.goal.goalType,
              target_date: parsed.data.goal.targetDate ?? null,
              target_event_id: parsed.data.goal.targetEventId ?? null,
            }
          : {}),
      })
      .select("id")
      .single();
    if (seasonError || !legacySeason) {
      return { ok: false, error: seasonError?.message ?? "Couldn't create the season." };
    }
    const legacySeasonId = legacySeason.id as string;
    const { error: blocksError } = await supabase.from("season_blocks").insert(
      parsed.data.blocks.map((block, position) => ({
        season_id: legacySeasonId,
        user_id: user.id,
        position,
        program_id: block.programId,
        template_ref: block.templateRef ?? null,
        emphasis: block.emphasis,
        intent_note: block.intentNote ?? null,
        planned_weeks: block.plannedWeeks ?? null,
        status: "planned" as const,
      })),
    );
    if (blocksError) {
      const { error: cleanupError } = await supabase
        .from("training_seasons")
        .delete()
        .eq("id", legacySeasonId)
        .eq("user_id", user.id);
      return {
        ok: false,
        error: cleanupError
          ? `Couldn't add the blocks: ${blocksError.message} (${cleanupError.message})`
          : `Couldn't add the blocks: ${blocksError.message}`,
      };
    }
    revalidateSeason();
    return { ok: true, seasonId: legacySeasonId };
  }
  if (!seasonId) {
    return { ok: false, error: "Couldn't create the season." };
  }

  revalidateSeason();
  return { ok: true, seasonId: seasonId as string };
}

const addBlockSchema = z
  .object({ seasonId: z.string().uuid() })
  .merge(blockInputSchema)
  .strict();

/** Append a planned block to the end of a Season (respects the look-ahead cap). */
export async function addSeasonBlock(input: unknown): Promise<SeasonActionResult> {
  const parsed = addBlockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const { data: existing, error: exErr } = await supabase
    .from("season_blocks")
    .select("position")
    .eq("season_id", parsed.data.seasonId)
    .eq("user_id", user.id)
    .order("position", { ascending: false })
    .limit(1);
  if (exErr) return { ok: false, error: exErr.message };
  const count = existing?.length ? (existing[0]!.position as number) + 1 : 0;
  if (count >= MAX_SEASON_BLOCKS) {
    return { ok: false, error: `A season can hold at most ${MAX_SEASON_BLOCKS} blocks.` };
  }

  const { error } = await supabase.from("season_blocks").insert({
    season_id: parsed.data.seasonId,
    user_id: user.id,
    position: count,
    program_id: parsed.data.programId,
    template_ref: parsed.data.templateRef ?? null,
    emphasis: parsed.data.emphasis,
    intent_note: parsed.data.intentNote ?? null,
    planned_weeks: parsed.data.plannedWeeks ?? null,
    status: "planned",
  });
  if (error) return { ok: false, error: error.message };
  revalidateSeason();
  return { ok: true };
}

const updateBlockSchema = z
  .object({
    blockId: z.string().uuid(),
    programId: z.string().min(1).max(64).optional(),
    templateRef: z.string().max(64).nullish(),
    emphasis: emphasisSchema.optional(),
    intentNote: z.string().max(280).nullish(),
    plannedWeeks: z.number().int().min(1).max(24).nullish(),
  })
  .strict();

/** Edit a PLANNED block's program / template / emphasis / note. */
export async function updateSeasonBlock(input: unknown): Promise<SeasonActionResult> {
  const parsed = updateBlockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (parsed.data.programId !== undefined) patch.program_id = parsed.data.programId;
  if (parsed.data.templateRef !== undefined) patch.template_ref = parsed.data.templateRef ?? null;
  if (parsed.data.emphasis !== undefined) patch.emphasis = parsed.data.emphasis;
  if (parsed.data.intentNote !== undefined) patch.intent_note = parsed.data.intentNote ?? null;
  if (parsed.data.plannedWeeks !== undefined) patch.planned_weeks = parsed.data.plannedWeeks ?? null;
  if (Object.keys(patch).length === 0) return { ok: true };

  // Only PLANNED blocks are editable — never rewrite an active/done block.
  const { error } = await supabase
    .from("season_blocks")
    .update(patch)
    .eq("id", parsed.data.blockId)
    .eq("user_id", user.id)
    .eq("status", "planned");
  if (error) return { ok: false, error: error.message };
  revalidateSeason();
  return { ok: true };
}

const removeBlockSchema = z.object({ blockId: z.string().uuid() }).strict();

/** Remove a planned block, then renumber the remaining blocks to stay gap-free. */
export async function removeSeasonBlock(input: unknown): Promise<SeasonActionResult> {
  const parsed = removeBlockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const { data: row, error: rErr } = await supabase
    .from("season_blocks")
    .select("season_id, status")
    .eq("id", parsed.data.blockId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (rErr) return { ok: false, error: rErr.message };
  if (!row) return { ok: false, error: "Block not found." };
  if (row.status !== "planned") return { ok: false, error: "Only upcoming blocks can be removed." };
  const seasonId = row.season_id as string;

  const { error: dErr } = await supabase
    .from("season_blocks")
    .delete()
    .eq("id", parsed.data.blockId)
    .eq("user_id", user.id);
  if (dErr) return { ok: false, error: dErr.message };

  await renumberSeason(supabase, user.id, seasonId);
  revalidateSeason();
  return { ok: true };
}

const reorderSchema = z
  .object({
    seasonId: z.string().uuid(),
    orderedBlockIds: z.array(z.string().uuid()).min(1).max(MAX_SEASON_BLOCKS),
  })
  .strict();

/** Reorder a Season's blocks to the given full ordering (two-phase to dodge the unique key). */
export async function reorderSeasonBlocks(input: unknown): Promise<SeasonActionResult> {
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const { data: rows, error: rErr } = await supabase
    .from("season_blocks")
    .select("id")
    .eq("season_id", parsed.data.seasonId)
    .eq("user_id", user.id);
  if (rErr) return { ok: false, error: rErr.message };
  const currentIds = (rows ?? []).map((r) => r.id as string);

  let target: Map<string, number>;
  try {
    target = applyReorder(currentIds, parsed.data.orderedBlockIds);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid order" };
  }

  // Phase 1: park every row at a negative position so the unique(season,pos)
  // constraint can't collide mid-update. Phase 2: write the final positions.
  for (const id of currentIds) {
    await supabase
      .from("season_blocks")
      .update({ position: -1000 - (target.get(id) ?? 0) })
      .eq("id", id)
      .eq("user_id", user.id);
  }
  for (const [id, pos] of target) {
    const { error } = await supabase
      .from("season_blocks")
      .update({ position: pos })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return { ok: false, error: error.message };
  }

  revalidateSeason();
  return { ok: true };
}

const setGoalSchema = z
  .object({
    seasonId: z.string().uuid(),
    /** null clears the goal anchor. */
    goal: goalSchema.nullable(),
  })
  .strict();

/**
 * Set or clear a Season's goal anchor (ADR 0051 Phase 1). Passing `goal: null`
 * clears it. User-scoped (RLS) + active-season guard. Pure metadata — no
 * materialisation, no taper change (the taper stays ADR 0008's when a peak
 * block activates near the event).
 */
export async function setSeasonGoal(input: unknown): Promise<SeasonActionResult> {
  const parsed = setGoalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const patch = parsed.data.goal
    ? {
        goal_type: parsed.data.goal.goalType,
        target_date: parsed.data.goal.targetDate ?? null,
        target_event_id: parsed.data.goal.targetEventId ?? null,
        updated_at: new Date().toISOString(),
      }
    : {
        goal_type: null,
        target_date: null,
        target_event_id: null,
        updated_at: new Date().toISOString(),
      };

  const { error } = await supabase
    .from("training_seasons")
    .update(patch)
    .eq("id", parsed.data.seasonId)
    .eq("user_id", user.id)
    .eq("status", "active");
  if (error) return { ok: false, error: error.message };
  revalidateSeason();
  return { ok: true };
}

const abandonSchema = z.object({ seasonId: z.string().uuid() }).strict();
/** End a Season (status = abandoned). Does not touch any materialised blocks. */
export async function abandonSeason(input: unknown): Promise<SeasonActionResult> {
  const parsed = abandonSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const { error } = await supabase
    .from("training_seasons")
    .update({ status: "abandoned", updated_at: new Date().toISOString() })
    .eq("id", parsed.data.seasonId)
    .eq("user_id", user.id)
    .eq("status", "active");
  if (error) return { ok: false, error: error.message };
  revalidateSeason();
  return { ok: true };
}

/** Renumber a season's blocks to contiguous 0..n by current position order. */
async function renumberSeason(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  seasonId: string,
): Promise<void> {
  const { data: rows } = await supabase
    .from("season_blocks")
    .select("id, position")
    .eq("season_id", seasonId)
    .eq("user_id", userId)
    .order("position", { ascending: true });
  const ordered = (rows ?? []).map((r) => r.id as string);
  // Park negative then re-seat, same collision-safe two-phase as reorder.
  for (let i = 0; i < ordered.length; i++) {
    await supabase
      .from("season_blocks")
      .update({ position: -1000 - i })
      .eq("id", ordered[i]!)
      .eq("user_id", userId);
  }
  for (let i = 0; i < ordered.length; i++) {
    await supabase
      .from("season_blocks")
      .update({ position: i })
      .eq("id", ordered[i]!)
      .eq("user_id", userId);
  }
}

const setEnabledSchema = z.object({ enabled: z.boolean() }).strict();

/**
 * Toggle the Season-planning opt-in (profiles.season_planning_enabled). Off by
 * default; this is the only thing that surfaces the Season tab. Turning it off
 * leaves any existing Season data intact (just hidden).
 */
export async function setSeasonPlanningEnabled(input: unknown): Promise<SeasonActionResult> {
  const parsed = setEnabledSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ season_planning_enabled: parsed.data.enabled })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/settings/training");
  revalidatePath("/app/plan");
  return { ok: true };
}
