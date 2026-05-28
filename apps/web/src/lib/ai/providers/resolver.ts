/**
 * getProviderForUser — server-side resolver.
 *
 * Reads the caller's profile, decrypts their BYOAI key (via the
 * service-role vault helper), instantiates the right provider, and
 * returns it. Returns null when the user hasn't completed BYOAI
 * setup (no provider or no key configured).
 *
 * **Server-only.** The vault helper requires the service-role
 * Supabase client + `AI_KEY_ENCRYPTION_KEY`; calling this from a
 * client component will fail noisily at import time.
 */
import { createAdmin } from "@/lib/supabase/server";
import { decryptByoaiKey } from "../vault";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OpenAiProvider } from "./openai";
import type { LlmProvider, LlmProviderName } from "./types";

function isProviderName(v: unknown): v is LlmProviderName {
  return v === "anthropic" || v === "openai" || v === "gemini";
}

export async function getProviderForUser(
  userId: string,
): Promise<LlmProvider | null> {
  const admin = createAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("byoai_provider, byoai_key_vault_id")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return null;
  const provider = profile.byoai_provider;
  const vaultId = profile.byoai_key_vault_id;
  if (!isProviderName(provider) || !vaultId) return null;

  const apiKey = await decryptByoaiKey(userId, vaultId);
  if (!apiKey) return null;

  switch (provider) {
    case "anthropic":
      return new AnthropicProvider({ apiKey });
    case "openai":
      return new OpenAiProvider({ apiKey });
    case "gemini":
      return new GeminiProvider({ apiKey });
  }
}
