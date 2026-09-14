"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getAuthUser } from "../supabase/server";
import { hashSwimImportKey, makeSwimImportKey } from "./import-key";
import { swimImportStorageAvailable } from "./import-storage";

type Failure = { ok: false; error: string };

export async function connectSwimDashboard(): Promise<Failure | { ok: true; id: string; key: string }> {
  if (process.env.SWIM_IMPORT_ENABLED !== "true") return { ok: false, error: "Swimming imports are not available yet." };
  const { data: { user } } = await getAuthUser();
  if (!user) return { ok: false, error: "Sign in to connect your dashboard." };
  const client = await createClient();
  if (!await swimImportStorageAvailable(client)) return { ok: false, error: "Swimming imports are not available yet." };
  const key = makeSwimImportKey();
  const { data, error } = await client.rpc("swim_import_connect", { p_hash: hashSwimImportKey(key) });
  if (error) {
    return { ok: false, error: error.code === "23505"
      ? "Disconnect the current dashboard before creating a new key."
      : "Your dashboard could not be connected. Try again." };
  }
  const id = z.string().uuid().safeParse(data);
  if (!id.success) return { ok: false, error: "The connection response was incomplete. Reload before trying again." };
  revalidatePath("/app/settings/swimming");
  return { ok: true, id: id.data, key };
}

export async function disconnectSwimDashboard(id: string): Promise<Failure | { ok: true }> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Choose a valid connection." };
  const { data: { user } } = await getAuthUser();
  if (!user) return { ok: false, error: "Sign in to disconnect your dashboard." };
  const client = await createClient();
  if (!await swimImportStorageAvailable(client)) return { ok: false, error: "Swimming imports are not available yet." };
  const { data, error } = await client.rpc("swim_import_disconnect", { p_id: id });
  if (error || data !== true) return { ok: false, error: "Your dashboard could not be disconnected. Try again." };
  revalidatePath("/app/settings/swimming");
  return { ok: true };
}
