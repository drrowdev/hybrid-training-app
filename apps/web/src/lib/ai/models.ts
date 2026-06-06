/**
 * BYOAI model catalogue — the curated set of models the picker offers per
 * provider, plus each provider's default.
 *
 * Why a curated list (not the provider's live /models list): the providers'
 * model endpoints return dozens of dated snapshots and legacy ids; a short
 * hand-picked list is clearer for the user and keeps us on models we know the
 * app's tool-calling works against. The Anthropic ids here were verified live.
 *
 * Staleness safety: if a listed id is later retired by the provider, the chat
 * now surfaces a clear "model unavailable" error (classifyProviderError maps
 * 404 → bad-input) rather than an opaque failure — and the user can pick
 * another. Keep this list current as providers rotate models.
 *
 * Verification: the Anthropic ids were confirmed against the live /v1/models
 * endpoint (Opus 4.8 / Sonnet 4.6 / Haiku 4.5 are the current generation). The
 * OpenAI ids (GPT-5.5 flagship, GPT-5.4 mini) and Gemini ids (Gemini 3.5 Flash
 * — the documented stable id — and 3.5 Pro) were confirmed against each
 * provider's official model docs (June 2026); both OpenAI ids are documented as
 * supporting Chat Completions + function calling + streaming, which the app's
 * providers use. Keep this list current as providers rotate models.
 */
export type ProviderName = "anthropic" | "openai" | "gemini";

export type ModelOption = {
  /** The exact id sent to the provider API. */
  id: string;
  /** Human label shown in the picker. */
  label: string;
};

export const MODEL_CATALOGUE: Record<ProviderName, ModelOption[]> = {
  anthropic: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (recommended)" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8 (most capable)" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest / cheapest)" },
  ],
  openai: [
    { id: "gpt-5.4-mini", label: "GPT-5.4 mini (recommended)" },
    { id: "gpt-5.5", label: "GPT-5.5 (most capable)" },
  ],
  gemini: [
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash (recommended)" },
    { id: "gemini-3.5-pro", label: "Gemini 3.5 Pro (most capable)" },
  ],
};

/** The default model per provider — the first catalogue entry. */
export const DEFAULT_MODEL: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.4-mini",
  gemini: "gemini-3.5-flash",
};

/** True when `model` is a known catalogue id for `provider`. */
export function isKnownModel(provider: ProviderName, model: string): boolean {
  return MODEL_CATALOGUE[provider].some((m) => m.id === model);
}

/**
 * Resolve the model to actually use: the stored choice when it's a known id for
 * the provider, otherwise the provider's default. Guards against a stored model
 * left over from a different provider (e.g. after switching providers).
 */
export function resolveModel(
  provider: ProviderName,
  stored: string | null | undefined,
): string {
  if (stored && isKnownModel(provider, stored)) return stored;
  return DEFAULT_MODEL[provider];
}
