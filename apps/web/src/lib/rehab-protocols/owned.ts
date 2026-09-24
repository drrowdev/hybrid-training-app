import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { rehabProtocolDefinitionSchema } from "./schema";

const rowSchema = z.object({
  id: z.string().uuid(), name: z.string(), revision: z.number().int().positive(),
  definition: rehabProtocolDefinitionSchema,
});

export async function loadOwnedRehabProtocols(client: SupabaseClient, userId: string, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  const result = await client.from("rehab_protocols").select("id,name,revision,definition").eq("user_id", userId).in("id", unique);
  if (result.error) throw new Error("Could not read your rehab protocols. Try again.");
  const rows = z.array(rowSchema).parse(result.data);
  if (rows.length !== unique.length) throw new Error("A rehab protocol is no longer available. Choose it again from your library.");
  return rows.map((row) => ({ id: row.id, name: row.name, revision: row.revision, ...row.definition }));
}
