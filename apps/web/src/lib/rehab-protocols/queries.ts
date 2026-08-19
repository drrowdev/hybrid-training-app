/**
 * Reads for the rehab-protocol library.
 *
 * TOLERATES A MISSING TABLE ON PURPOSE. This repo deploys app-first,
 * database-second (see the deploy-order guard in ci.yml), so the build that
 * introduces these reads is already serving traffic before migration 0134 runs.
 * PostgREST fails the whole request on an unknown relation, so every read here
 * treats "relation does not exist" as an empty library. The effect is that the
 * app behaves exactly as it did before the feature until the migration lands.
 */
import { cache } from "react";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import type { SessionLink } from "@/lib/platform/session-links";
import type { LibraryProtocol } from "@/lib/platform/rehab-library";

export type RehabProtocolItem = {
  movementId: string;
  movementName: string;
  side?: "both" | "left" | "right";
  sets: number;
  reps?: number;
  holdSeconds?: number;
  targetWeightKg?: number;
  instructions?: string;
};

export type RehabProtocolRow = {
  id: string;
  name: string;
  items: RehabProtocolItem[];
  links: SessionLink[];
  revision: number;
  updatedAt: string;
  /** Display names of the live programs currently using this protocol. */
  usedBy: string[];
};

/** Postgres "undefined_table" / PostgREST "unknown relation" — 0134 hasn't run. */
export function isMissingTable(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .* does not exist/i.test(error.message ?? "")
  );
}

type RawProtocol = {
  id: string;
  name: string;
  definition: { items?: RehabProtocolItem[]; links?: SessionLink[] } | null;
  revision: number;
  updated_at: string;
};

function toRow(raw: RawProtocol, usedBy: string[]): RehabProtocolRow {
  return {
    id: raw.id,
    name: raw.name,
    items: raw.definition?.items ?? [],
    links: raw.definition?.links ?? [],
    revision: raw.revision,
    updatedAt: raw.updated_at,
    usedBy,
  };
}

/**
 * The user's whole library, plus which live programs use each protocol.
 * "Live" means an active, non-deleted program instance.
 */
export const listRehabProtocols = cache(async function listRehabProtocols(): Promise<
  RehabProtocolRow[]
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("rehab_protocols")
    .select("id, name, definition, revision, updated_at")
    .eq("user_id", user.id)
    .order("name");
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message);
  }

  const { data: bindings, error: bindingError } = await supabase
    .from("program_rehab_bindings")
    .select(
      "rehab_protocol_id, program_instances!inner(display_name, status, deleted_at)",
    )
    .eq("user_id", user.id);
  if (bindingError && !isMissingTable(bindingError)) {
    throw new Error(bindingError.message);
  }

  const usedBy = new Map<string, string[]>();
  for (const binding of bindings ?? []) {
    const instance = (
      Array.isArray(binding.program_instances)
        ? binding.program_instances[0]
        : binding.program_instances
    ) as
      | { display_name?: string | null; status?: string; deleted_at?: string | null }
      | null;
    if (!instance || instance.status !== "active" || instance.deleted_at != null) {
      continue;
    }
    const names = usedBy.get(binding.rehab_protocol_id) ?? [];
    const label = instance.display_name ?? "your program";
    if (!names.includes(label)) names.push(label);
    usedBy.set(binding.rehab_protocol_id, names);
  }

  return (data ?? []).map((raw) =>
    toRow(raw as RawProtocol, usedBy.get((raw as RawProtocol).id) ?? []),
  );
});

/** One protocol, for the editor. */
export async function getRehabProtocol(id: string): Promise<RehabProtocolRow | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("rehab_protocols")
    .select("id, name, definition, revision, updated_at")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(error.message);
  }
  return data ? toRow(data as RawProtocol, []) : null;
}

/**
 * The library rows + bindings the resolver needs, for a set of program
 * instances. Empty structures mean "leave those programs exactly as they are".
 */
export async function loadRehabBindingsFor(
  programInstanceIds: readonly string[],
): Promise<{
  bindingsByInstance: Record<string, Record<string, string>>;
  library: LibraryProtocol[];
}> {
  const empty = { bindingsByInstance: {}, library: [] };
  if (programInstanceIds.length === 0) return empty;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return empty;

  const { data: bindings, error } = await supabase
    .from("program_rehab_bindings")
    .select("program_instance_id, local_protocol_id, rehab_protocol_id")
    .eq("user_id", user.id)
    .in("program_instance_id", [...programInstanceIds]);
  if (error) {
    if (isMissingTable(error)) return empty;
    throw new Error(error.message);
  }
  if (!bindings || bindings.length === 0) return empty;

  const { data: protocols, error: protocolError } = await supabase
    .from("rehab_protocols")
    .select("id, name, definition, revision, updated_at")
    .eq("user_id", user.id)
    .in("id", [...new Set(bindings.map((b) => b.rehab_protocol_id))]);
  if (protocolError) {
    if (isMissingTable(protocolError)) return empty;
    throw new Error(protocolError.message);
  }

  const bindingsByInstance: Record<string, Record<string, string>> = {};
  for (const binding of bindings) {
    const forInstance = (bindingsByInstance[binding.program_instance_id] ??= {});
    forInstance[binding.local_protocol_id] = binding.rehab_protocol_id;
  }

  return {
    bindingsByInstance,
    library: (protocols ?? []).map((raw) => {
      const row = raw as RawProtocol;
      return {
        id: row.id,
        name: row.name,
        items: row.definition?.items ?? [],
        links: row.definition?.links ?? [],
      };
    }),
  };
}
