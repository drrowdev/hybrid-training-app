import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isMissingRpc } from "../supabase/rpc-errors";
import { swimImportEvidenceSchema } from "./import-evidence";

export const connectionColumns = "id,created_at,revoked_at";
export const importColumns = "id,activity_id,revision,evidence,received_at";
const connectionSchema = z.object({
  id: z.string().uuid(), created_at: z.string(), revoked_at: z.string().nullable(),
}).strict();
const importSchema = z.object({
  id: z.string().uuid(), activity_id: z.string(), revision: z.number().int().positive(),
  evidence: swimImportEvidenceSchema, received_at: z.string(),
}).strict();
export type SwimConnection = z.infer<typeof connectionSchema>;
export type ImportedSwim = z.infer<typeof importSchema>;

export async function swimImportStorageAvailable(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc("swim_import_storage_ready")
    .abortSignal(AbortSignal.timeout(10_000));
  if (error) {
    if (isMissingRpc(error)) return false;
    throw new Error("Swimming imports could not be loaded.");
  }
  if (data !== true) throw new Error("Swimming imports returned an invalid response.");
  return true;
}

export async function loadSwimImports(client: SupabaseClient, userId: string) {
  const available = await swimImportStorageAvailable(client);
  if (!available) return { available, enabled: false, connections: [], imports: [] };
  const [connections, imports] = await Promise.all([
    client.from("swim_connections").select(connectionColumns).eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(20),
    client.from("swim_imports").select(importColumns).eq("user_id", userId)
      .order("received_at", { ascending: false }).limit(50),
  ]);
  if (connections.error || imports.error) throw new Error("Swimming imports could not be loaded.");
  const parsedConnections = z.array(connectionSchema).safeParse(connections.data);
  const parsedImports = z.array(importSchema).safeParse(imports.data);
  if (!parsedConnections.success || !parsedImports.success) {
    throw new Error("Swimming imports returned an invalid response.");
  }
  return {
    available, enabled: process.env.SWIM_IMPORT_ENABLED === "true",
    connections: parsedConnections.data, imports: parsedImports.data,
  };
}
