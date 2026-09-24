import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { programTemplateField } from "@/lib/platform/setup-audit";

const slotFields = "id,position,program_id,template_ref,emphasis,intent_note,planned_weeks,status,block_id";
const slotSchema = z.object({
  id: z.string().uuid(), position: z.number().int().nonnegative(),
  program_id: z.string(), template_ref: z.string().nullable(), emphasis: z.string(),
  intent_note: z.string().nullable(), planned_weeks: z.number().nullable(),
  status: z.enum(["planned", "active", "done", "skipped"]), block_id: z.string().uuid().nullable(),
});
const seasonSchema = z.object({
  id: z.string().uuid(), goal_type: z.string().nullable(),
  target_date: z.string().nullable(), target_event_id: z.string().uuid().nullable(),
});

export interface SeasonProgramOrigin {
  target: z.infer<typeof slotSchema>;
  snapshot: {
    id: string;
    season: z.infer<typeof seasonSchema>;
    blocks: z.infer<typeof slotSchema>[];
  };
  predecessor: {
    id: string; status: string; deleted_at: string | null; notes: string | null;
  } | null;
}

export async function loadSeasonProgramOrigin(
  client: SupabaseClient, userId: string, slotId: string,
): Promise<SeasonProgramOrigin> {
  if (!z.string().uuid().safeParse(slotId).success) throw new Error("This roadmap block is unavailable.");
  const targetResult = await client.from("season_blocks").select("season_id")
    .eq("id", slotId).eq("user_id", userId).maybeSingle();
  if (targetResult.error) throw new Error("Could not read the roadmap block. Try again.");
  const target = z.object({ season_id: z.string().uuid() }).nullable().parse(targetResult.data);
  if (!target) throw new Error("This roadmap block is unavailable.");
  const seasonResult = await client.from("training_seasons")
    .select("id,goal_type,target_date,target_event_id")
    .eq("id", target.season_id).eq("user_id", userId).eq("status", "active")
    .is("deleted_at", null).maybeSingle();
  if (seasonResult.error) throw new Error("Could not read your season. Try again.");
  const season = seasonSchema.nullable().parse(seasonResult.data);
  if (!season) throw new Error("This season is no longer active.");
  const slotsResult = await client.from("season_blocks").select(slotFields)
    .eq("season_id", season.id).eq("user_id", userId).order("position");
  if (slotsResult.error) throw new Error("Could not read the roadmap. Try again.");
  const slots = z.array(slotSchema).safeParse(slotsResult.data);
  if (!slots.success) throw new Error("The roadmap changed. Refresh it or start without the roadmap.");
  const next = slots.data.find((slot) => slot.status === "planned");
  const active = slots.data.filter((slot) => slot.status === "active");
  if (!next || next.id !== slotId || next.block_id !== null || active.length > 1) {
    throw new Error("Choose the next planned roadmap block or start without the roadmap.");
  }
  let predecessor: SeasonProgramOrigin["predecessor"] = null;
  if (active.length) {
    if (!active[0]!.block_id) throw new Error("The roadmap changed. Refresh it or start without the roadmap.");
    const blockResult = await client.from("training_blocks").select("id,status,deleted_at,notes")
      .eq("id", active[0]!.block_id).eq("user_id", userId).maybeSingle();
    if (blockResult.error) throw new Error("Could not read the current roadmap program. Try again.");
    predecessor = z.object({
      id: z.string().uuid(), status: z.string(), deleted_at: z.string().nullable(), notes: z.string().nullable(),
    }).nullable().parse(blockResult.data);
    if (!predecessor) throw new Error("The current roadmap program is unavailable. Start without the roadmap.");
  }
  return { target: next, snapshot: { id: slotId, season, blocks: slots.data }, predecessor };
}

export function assertSeasonProgramSetup(
  origin: SeasonProgramOrigin, programId: string, values: Record<string, unknown>,
): void {
  const field = programTemplateField(programId);
  if (origin.target.program_id !== programId ||
    (origin.target.template_ref !== null && (!field || values[field] !== origin.target.template_ref))) {
    throw new Error("Restore the roadmap's program and template or start without the roadmap.");
  }
}

export function assertSeasonProgramReplacement(origin: SeasonProgramOrigin, replacementId?: string): void {
  const previous = origin.predecessor;
  if (previous?.status === "active" && previous.deleted_at === null && previous.id !== replacementId) {
    throw new Error(`End or complete ${previous.notes?.trim() || "the current program"} before advancing its roadmap.`);
  }
}
