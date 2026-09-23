import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isBlockProgramKind, type BlockProgramKind } from "@hta/domain";
import { isMissingScheduleFunction, ScheduleUnavailableError } from "@/lib/schedule/storage";

export async function requireIndependentPrograms(client: SupabaseClient): Promise<void> {
  const result = await client.rpc("independent_programs_ready");
  if (isMissingScheduleFunction(result.error, "independent_programs_ready")) throw new ScheduleUnavailableError();
  if (result.error || result.data !== true) throw new Error("Could not check program setup. Try again.");
}

const activeProgramSchema = z.object({
  id: z.string().uuid(), notes: z.string().nullable(), started_on: z.string(),
  program_id: z.string().nullable(), program_kind: z.enum(["strength", "running", "hybrid"]).nullable(),
});
export type OwnedActiveProgram = z.infer<typeof activeProgramSchema>;

export async function loadOwnedActivePrograms(client: SupabaseClient, userId: string): Promise<OwnedActiveProgram[]> {
  const result = await client.from("training_blocks").select("id,notes,started_on,program_id,program_kind")
    .eq("user_id", userId).eq("status", "active").is("deleted_at", null);
  if (result.error) throw new Error("Could not read your programs. Try again.");
  const programs = z.array(activeProgramSchema).parse(result.data);
  const kinds = programs.map((program) => program.program_kind);
  if (new Set(kinds).size !== kinds.length || (programs.length > 1 && kinds.includes(null))) {
    throw new Error("The active programs need to be reconciled before making changes.");
  }
  return programs;
}

export function selectProgramTarget(
  programs: readonly OwnedActiveProgram[], kind: BlockProgramKind, editBlockId?: string,
): OwnedActiveProgram | null {
  if (editBlockId) {
    const target = programs.find((program) => program.id === editBlockId);
    if (!target) throw new Error("This program is no longer active.");
    if (target.program_kind !== null && target.program_kind !== kind) throw new Error("Keep the original program type when editing.");
    return target;
  }
  if (programs.some((program) => program.program_kind === null)) {
    throw new Error("End the older program before starting independent programs.");
  }
  return programs.find((program) => program.program_kind === kind) ?? null;
}

export function requireBlockProgramKind(value: unknown): BlockProgramKind {
  if (!isBlockProgramKind(value)) throw new Error("Choose Strength, Running or Hybrid.");
  return value;
}
