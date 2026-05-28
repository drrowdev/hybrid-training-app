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
import { getDefaultModel } from "./model-catalogue";
import { OpenAiProvider } from "./openai";
import type { LlmProvider, LlmProviderName } from "./types";

function isProviderName(v: unknown): v is LlmProviderName {
  return v === "anthropic" || v === "openai" || v === "gemini";
}

/**
 * Pick the model to hand the provider constructor: the saved
 * `byoai_model` if set (curated id OR custom string), otherwise the
 * Recommended-tier default from the catalogue.
 */
export function resolveModel(
  provider: LlmProviderName,
  saved: string | null | undefined,
): string {
  if (typeof saved === "string") {
    const trimmed = saved.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return getDefaultModel(provider);
}

export async function getProviderForUser(
  userId: string,
): Promise<LlmProvider | null> {
  const admin = createAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("byoai_provider, byoai_key_vault_id, byoai_model")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return null;
  const provider = profile.byoai_provider;
  const vaultId = profile.byoai_key_vault_id;
  if (!isProviderName(provider) || !vaultId) return null;

  const apiKey = await decryptByoaiKey(userId, vaultId);
  if (!apiKey) return null;

  const model = resolveModel(
    provider,
    profile.byoai_model as string | null | undefined,
  );

  switch (provider) {
    case "anthropic":
      return new AnthropicProvider({ apiKey, model });
    case "openai":
      return new OpenAiProvider({ apiKey, model });
    case "gemini":
      return new GeminiProvider({ apiKey, model });
  }
}
