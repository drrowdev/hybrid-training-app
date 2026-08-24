"use server";

/**
 * Settings-side CRUD for the rehab-protocol library, plus the sync that pushes
 * an edit into the live program.
 *
 * HOW SYNC WORKS, AND WHY IT LOOKS LIKE THIS
 *
 * A protocol edit does NOT get its own bespoke plan-rewriting code. It re-runs
 * the wizard's existing "edit this program" path (`createProgramInstance` with
 * `editBlockId`) using the program's own stored setup, with only the rehab
 * resolved from the library. That path is already hardened for exactly the
 * hazards a rehab edit creates:
 *
 *   - forward-only: past calendar slots are frozen (`planForwardOnlyRewrite`),
 *   - started or skipped rows are preserved, never rebuilt,
 *   - `removedEmbeddedRehabSourceRefs` tombstones survive, so a day whose rehab
 *     the user deleted stays deleted,
 *   - the whole rewrite goes through `rewrite_planned_sessions_atomically`,
 *   - it UPDATES `program_instances` in place rather than archiving and
 *     re-inserting, so binding rows keep pointing at the right instance.
 *
 * Writing a second rewrite path would mean re-earning all of that.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getBlockEditContext } from "@/lib/platform/edit-context";
import { createProgramInstance } from "@/lib/platform/actions";
import {
  resolutionChangesProgram,
  resolveRehabLibrary,
  type LibraryProtocol,
} from "@/lib/platform/rehab-library";
import { parseRehabProtocolInput } from "./schema";
import { isMissingTable } from "./queries";

export type ProtocolActionResult =
  | { ok: true; id: string; syncedPrograms: string[] }
  | { ok: false; error: string };

const idSchema = z.string().uuid();

const MISSING_TABLE_MESSAGE =
  "Rehab protocols aren't available yet. Try again shortly.";

/** Create a protocol. Never attached to a program until the wizard attaches it. */
export async function createRehabProtocol(raw: unknown): Promise<ProtocolActionResult> {
  const parsed = parseRehabProtocolInput(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("rehab_protocols")
    .insert({
      user_id: user.id,
      name: parsed.value.name,
      definition: parsed.value.definition,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (isMissingTable(error)) return { ok: false, error: MISSING_TABLE_MESSAGE };
    return { ok: false, error: error?.message ?? "Couldn't save that protocol." };
  }

  revalidatePath("/app/settings/rehab-protocols");
  return { ok: true, id: data.id as string, syncedPrograms: [] };
}

/**
 * Update a protocol, then push it into every live program that uses it.
 *
 * The library write and the plan rewrite are separate statements, so a failure
 * between them would leave Settings ahead of the plan. That is the safe
 * direction to fail: the next successful save re-syncs from the library, and
 * `resolutionChangesProgram` makes a re-sync a no-op when the plan already
 * matches. The alternative — rewriting plans first — could leave a plan running
 * a definition the library never accepted.
 */
export async function updateRehabProtocol(
  id: string,
  raw: unknown,
): Promise<ProtocolActionResult> {
  if (!idSchema.safeParse(id).success) {
    return { ok: false, error: "Unknown protocol." };
  }
  const parsed = parseRehabProtocolInput(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: existing, error: readError } = await supabase
    .from("rehab_protocols")
    .select("revision")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) {
    if (isMissingTable(readError)) return { ok: false, error: MISSING_TABLE_MESSAGE };
    return { ok: false, error: readError.message };
  }
  if (!existing) return { ok: false, error: "Unknown protocol." };

  // Compare-and-set on `revision`: two Settings tabs saving at once must not
  // both fan out, or the plan could end up matching the older definition.
  const { data: updated, error: writeError } = await supabase
    .from("rehab_protocols")
    .update({
      name: parsed.value.name,
      definition: parsed.value.definition,
      revision: (existing.revision as number) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("revision", existing.revision as number)
    .select("id")
    .maybeSingle();
  if (writeError) return { ok: false, error: writeError.message };
  if (!updated) {
    return {
      ok: false,
      error: "That protocol changed somewhere else. Reopen it and redo your edit.",
    };
  }

  const synced = await syncProtocolIntoLivePrograms(id);
  if (!synced.ok) return synced;

  revalidatePath("/app/settings/rehab-protocols");
  revalidatePath("/app");
  revalidatePath("/app/plan");
  return { ok: true, id, syncedPrograms: synced.programs };
}

/** Copy a protocol. Unattached, so nothing syncs. */
export async function duplicateRehabProtocol(
  id: string,
): Promise<ProtocolActionResult> {
  if (!idSchema.safeParse(id).success) {
    return { ok: false, error: "Unknown protocol." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: source, error } = await supabase
    .from("rehab_protocols")
    .select("name, definition")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: MISSING_TABLE_MESSAGE };
    return { ok: false, error: error.message };
  }
  if (!source) return { ok: false, error: "Unknown protocol." };

  return createRehabProtocol({
    name: `${(source.name as string).slice(0, 108)} (copy)`,
    definition: source.definition,
  });
}

/**
 * Delete a protocol.
 *
 * The FK on `program_rehab_bindings` is ON DELETE RESTRICT, so a protocol a
 * program depends on cannot be removed even if this check races a concurrent
 * deploy. The lookup below exists only to name the program in the message.
 */
export async function deleteRehabProtocol(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!idSchema.safeParse(id).success) {
    return { ok: false, error: "Unknown protocol." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("rehab_protocols")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    if (isMissingTable(error)) return { ok: false, error: MISSING_TABLE_MESSAGE };
    if (error.code === "23503") {
      const { data: users } = await supabase
        .from("program_rehab_bindings")
        .select("program_instances!inner(display_name)")
        .eq("rehab_protocol_id", id)
        .eq("user_id", user.id);
      const names = (users ?? [])
        .map((row) => {
          const instance = (
            Array.isArray(row.program_instances)
              ? row.program_instances[0]
              : row.program_instances
          ) as { display_name?: string | null } | null;
          return instance?.display_name ?? null;
        })
        .filter((name): name is string => !!name);
      const label = names.length > 0 ? names.join(", ") : "a program";
      return {
        ok: false,
        error: `In use by ${label}. Remove it from the program before deleting.`,
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/app/settings/rehab-protocols");
  return { ok: true };
}

/**
 * Push a protocol into every live program bound to it.
 *
 * Returns the display names of the programs it actually changed. A program
 * whose plan already matches the library is skipped, so an edit that does not
 * affect a given program never rewrites its sessions.
 */
async function syncProtocolIntoLivePrograms(
  protocolId: string,
): Promise<{ ok: true; programs: string[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: bindings, error } = await supabase
    .from("program_rehab_bindings")
    .select(
      "program_instance_id, program_instances!inner(id, block_id, display_name, status, deleted_at)",
    )
    .eq("rehab_protocol_id", protocolId)
    .eq("user_id", user.id);
  if (error) {
    if (isMissingTable(error)) return { ok: true, programs: [] };
    return { ok: false, error: error.message };
  }

  const live = (bindings ?? [])
    .map((row) => {
      const instance = (
        Array.isArray(row.program_instances)
          ? row.program_instances[0]
          : row.program_instances
      ) as {
        id?: string;
        block_id?: string | null;
        display_name?: string | null;
        status?: string;
        deleted_at?: string | null;
      } | null;
      return instance;
    })
    .filter(
      (instance): instance is { id: string; block_id: string; display_name: string | null } =>
        !!instance &&
        instance.status === "active" &&
        instance.deleted_at == null &&
        typeof instance.block_id === "string" &&
        typeof instance.id === "string",
    );

  const changed: string[] = [];
  for (const instance of live) {
    const result = await syncOneProgram(instance.id, instance.block_id);
    if (!result.ok) return result;
    if (result.changed) changed.push(instance.display_name ?? "your program");
  }
  return { ok: true, programs: changed };
}

async function syncOneProgram(
  programInstanceId: string,
  blockId: string,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const context = await getBlockEditContext(blockId);
  // No editable context means the block isn't in a state the wizard could edit
  // either (wrong program, archived, missing instance state). Leave it alone.
  if (!context) return { ok: true, changed: false };
  // A block can carry rehab through the envelope with no customization at all,
  // so the presence of a customization is not what makes it syncable.
  if (!context.customization && !context.rehabSchedule) {
    return { ok: true, changed: false };
  }

  const { bindingsByInstance, library } = await loadBindings([programInstanceId]);
  const bindings = bindingsByInstance[programInstanceId] ?? {};
  if (Object.keys(bindings).length === 0) return { ok: true, changed: false };

  const source = {
    ...(context.customization ? { customization: context.customization } : {}),
    ...(context.rehabSchedule ? { rehabSchedule: context.rehabSchedule } : {}),
  };
  const linksBySeries = context.sessionLinks?.bySeries ?? {};
  if (!resolutionChangesProgram(source, linksBySeries, bindings, library)) {
    return { ok: true, changed: false };
  }

  const resolved = resolveRehabLibrary(source, linksBySeries, bindings, library);
  if (resolved.missing.length > 0) {
    return {
      ok: false,
      error: "Couldn't read one of this program's protocols. Nothing was changed.",
    };
  }

  const result = await createProgramInstance({
    programId: context.programId,
    setupValues: context.setupValues,
    weekdays: context.strengthWeekdays,
    cardioWeekdays: context.cardioWeekdays,
    startedOn: context.startedOn,
    startWeekIndex: context.programStartWeekIndex,
    accessories: { enabled: context.accessoriesEnabled },
    ...(resolved.customization ? { customization: resolved.customization } : {}),
    ...(resolved.rehabSchedule ? { rehabSchedule: resolved.rehabSchedule } : {}),
    sessionLinks: { version: 1, bySeries: resolved.linksBySeries },
    editBlockId: blockId,
    // Echoed back deliberately. The edit path REPLACES a program's bindings
    // with exactly what it is sent, so omitting them here deleted every one —
    // the first sync worked and no later one ever did.
    rehabBindings: Object.entries(bindings).map(
      ([localProtocolId, rehabProtocolId]) => ({
        localProtocolId,
        rehabProtocolId,
      }),
    ),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, changed: true };
}

/** Split out so the sync path and the read path share one shape. */
async function loadBindings(programInstanceIds: string[]): Promise<{
  bindingsByInstance: Record<string, Record<string, string>>;
  library: LibraryProtocol[];
}> {
  const { loadRehabBindingsFor } = await import("./queries");
  return loadRehabBindingsFor(programInstanceIds);
}
