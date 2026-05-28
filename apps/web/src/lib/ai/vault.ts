/**
 * BYOAI key vault helpers — pgcrypto fallback path.
 *
 * ADR 0002 specifies Supabase Vault as the at-rest cipher. We took
 * the pgcrypto fallback (see migration 0069 header for the rationale).
 * The application-layer API below is identical to what it would be
 * with Vault, so swapping in `vault.create_secret` / `vault.decrypted_secrets`
 * later is a localised change in this file with no schema impact.
 *
 * **Server-only.** All three helpers create a service-role Supabase
 * client and read `AI_KEY_ENCRYPTION_KEY` from `process.env`. They
 * MUST NEVER be imported into a client component or a route reachable
 * from the browser; the typed return contract returns the decrypted
 * key only from `decryptByoaiKey`, which itself is consumed only by
 * the server-side resolver.
 */
import { createAdmin } from "@/lib/supabase/server";

function getMasterKey(): string {
  const k = process.env.AI_KEY_ENCRYPTION_KEY;
  if (!k || k.length < 16) {
    throw new Error(
      "AI_KEY_ENCRYPTION_KEY is not set (or shorter than 16 chars). " +
        "Refusing to store/decrypt BYOAI keys without it.",
    );
  }
  return k;
}

export async function storeByoaiKey(
  userId: string,
  _provider: "anthropic" | "openai" | "gemini",
  plaintextKey: string,
): Promise<{ vaultId: string }> {
  if (!plaintextKey || plaintextKey.length < 8) {
    throw new Error("BYOAI plaintext key is missing or implausibly short");
  }
  const admin = createAdmin();
  const { data, error } = await admin.rpc("byoai_store_key", {
    p_user_id: userId,
    p_plaintext: plaintextKey,
    p_master_key: getMasterKey(),
  });
  if (error || !data) {
    throw new Error(`byoai_store_key failed: ${error?.message ?? "no id"}`);
  }
  return { vaultId: String(data) };
}

export async function decryptByoaiKey(
  vaultId: string,
): Promise<string | null> {
  const admin = createAdmin();
  const { data, error } = await admin.rpc("byoai_decrypt_key", {
    p_vault_id: vaultId,
    p_master_key: getMasterKey(),
  });
  if (error) {
    throw new Error(`byoai_decrypt_key failed: ${error.message}`);
  }
  return typeof data === "string" ? data : null;
}

export async function clearByoaiKey(vaultId: string): Promise<void> {
  const admin = createAdmin();
  const { error } = await admin.rpc("byoai_clear_key", {
    p_vault_id: vaultId,
  });
  if (error) {
    throw new Error(`byoai_clear_key failed: ${error.message}`);
  }
}
