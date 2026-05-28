/**
 * Pure model-validation helpers, factored out of `actions.ts` so they
 * can be unit-tested without dragging the `"use server"` action
 * surface (and its `next/headers` / supabase / vault imports) into
 * the test runner.
 *
 * `setByoaiKey` composes these with a live fetch to the provider's
 * `/models` endpoint.
 */

import {
  findCuratedOption,
  validateCustomModelId,
} from "./providers/model-catalogue";
import type { LlmProviderName } from "./providers/types";

export type ValidateModelOk = { ok: true };
export type ValidateModelErr = { ok: false; reason: string };
export type ValidateModelResult = ValidateModelOk | ValidateModelErr;

/**
 * Validate the chosen model. Two modes:
 *
 *   1. Curated — the ID matches an entry in MODEL_OPTIONS for the
 *      provider. We trust the catalogue; no remote check needed.
 *   2. Custom — the ID is a free-form string. We require it to
 *      appear in the provider's list-models response so we don't
 *      persist a model the user's key can't actually invoke.
 *
 * `model = null` (or empty) is "use the default" and always succeeds.
 */
export function validateChosenModel(
  provider: LlmProviderName,
  model: string | null | undefined,
  liveModelIds: string[],
): ValidateModelResult {
  if (model == null) return { ok: true };
  const trimmed = model.trim();
  if (trimmed.length === 0) return { ok: true };

  if (findCuratedOption(provider, trimmed)) return { ok: true };

  const shape = validateCustomModelId(trimmed);
  if (!shape.ok) return { ok: false, reason: shape.reason };

  if (!liveModelIds.includes(trimmed)) {
    return {
      ok: false,
      reason: `Your API key works, but the model ID '${trimmed}' was not found on your account. Check spelling or your provider's model list.`,
    };
  }
  return { ok: true };
}
