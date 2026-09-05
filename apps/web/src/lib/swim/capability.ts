import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRpc } from "../supabase/rpc-errors";

export type SwimCapability = {
  storageAvailable: boolean;
  setupEnabled: boolean;
};

/** Setup rollout is independent of access to already-recorded swimming. */
export async function getSwimCapability(
  client: SupabaseClient,
): Promise<SwimCapability> {
  const { data, error } = await client.rpc("swim_storage_ready");
  if (error) {
    if (isMissingRpc(error)) {
      return { storageAvailable: false, setupEnabled: false };
    }
    throw new Error(`Swimming availability: ${error.message}`, { cause: error });
  }
  if (data !== true) {
    throw new Error("Swimming storage returned an invalid capability response.");
  }
  return {
    storageAvailable: true,
    setupEnabled: process.env.POOL_SWIMMING_ENABLED === "true",
  };
}

export async function requireSwimStorage(client: SupabaseClient): Promise<void> {
  const capability = await getSwimCapability(client);
  if (!capability.storageAvailable) {
    throw new Error("Swimming storage is not available.");
  }

}

export async function swimSchemaAvailable(client: SupabaseClient): Promise<boolean> {
  return (await getSwimCapability(client)).storageAvailable;
}

export async function requireSwimSetup(client: SupabaseClient): Promise<void> {
  const capability = await getSwimCapability(client);
  if (!capability.setupEnabled) {
    throw new Error("Swimming setup is not available.");
  }
}
