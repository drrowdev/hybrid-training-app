import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isBlockProgramKind, type BlockProgramKind } from "@hta/domain";
import { isMissingScheduleFunction, ScheduleUnavailableError } from "@/lib/schedule/storage";

export async function independentProgramsAvailable(client: SupabaseClient): Promise<boolean> {
  const result = await client.rpc("independent_programs_ready");
  if (isMissingScheduleFunction(result.error, "independent_programs_ready")) return false;
  if (result.error || result.data !== true) throw new Error("Could not check program setup. Try again.");
  return true;
}

export async function requireIndependentPrograms(client: SupabaseClient): Promise<void> {
  if (!await independentProgramsAvailable(client)) throw new ScheduleUnavailableError();
}

const activeProgramSchema = z.object({
  id: z.string().uuid(), notes: z.string().nullable(), started_on: z.string(),
  program_id: z.string().nullable(), program_kind: z.enum(["strength", "running", "hybrid"]).nullable(),
});
export type OwnedActiveProgram = z.infer<typeof activeProgramSchema>;

export function assertActiveProgramKinds(programs: readonly { program_kind: BlockProgramKind | null }[]): void {
  const kinds = programs.map((program) => program.program_kind);
  if (new Set(kinds).size !== kinds.length || (programs.length > 1 && kinds.includes(null))) {
    throw new Error("The active programs need to be reconciled before making changes.");
  }
}

export async function loadOwnedActivePrograms(client: SupabaseClient, userId: string): Promise<OwnedActiveProgram[]> {
  const result = await client.from("training_blocks").select("id,notes,started_on,program_id,program_kind")
    .eq("user_id", userId).eq("status", "active").is("deleted_at", null);
  if (result.error) throw new Error("Could not read your programs. Try again.");
  const programs = z.array(activeProgramSchema).parse(result.data);
  assertActiveProgramKinds(programs);
  return programs;
}

export async function loadBlockProgramKinds(
  client: Pick<SupabaseClient, "from">, userId: string, blockIds: readonly string[],
): Promise<ReadonlyMap<string, BlockProgramKind | null>> {
  const ids = Array.from(new Set(blockIds));
  if (ids.length === 0) return new Map();
  // Legacy installations have no discriminator column; select(*) keeps those reads supported.
  const result = await client.from("training_blocks").select("*").eq("user_id", userId).in("id", ids);
  if (result.error) throw new Error("Could not read the workout's program. Try again.");
  const rows = z.array(z.object({
    id: z.string(), program_kind: z.enum(["strength", "running", "hybrid"]).nullable().optional(),
  })).parse(result.data);
  const kinds = new Map(rows.map((row) => [row.id, row.program_kind ?? null]));
  if (ids.some((id) => !kinds.has(id))) throw new Error("The workout's program is unavailable.");
  return kinds;
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
