"use server";

/**
 * AI settings server actions.
 *
 * `setByoaiKey`   — store + audit. Validates the key with a tiny
 *                   zero-cost provider probe before writing it, and
 *                   (when a model is supplied) verifies that the
 *                   chosen model ID appears in the same list-models
 *                   response.
 * `clearByoaiKey` — clears the vault entry, nulls profile cols,
 *                   audits.
 * `setAiOptIn`    — flips `profiles.ai_opt_in_at` between now() and
 *                   null.
 *
 * Auth pattern mirrors `apps/web/src/lib/limitations/actions.ts`.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { clearByoaiKey as clearVault, storeByoaiKey as storeVault } from "./vault";
import { setKeySchema } from "./schema";
import type { ProviderName } from "./schema";
import { validateChosenModel } from "./validate-model";

export type AiActionResult =
  | { ok: true }
  | { ok: false; errors: string[] };

type ValidateKeyOk = { ok: true; modelIds: string[] };
type ValidateKeyErr = { ok: false; reason: string };
type ValidateKeyResult = ValidateKeyOk | ValidateKeyErr;

/**
 * Cheap pre-flight: send a tiny request to the provider's list-models
 * endpoint. If it 401s we surface "auth-failed" before persisting.
 * Each provider's models endpoint is documented as a zero-token,
 * zero-cost GET. On success we also return the list of model IDs the
 * key has access to so the caller can validate a user-picked model.
 */
async function validateKey(
  provider: ProviderName,
  key: string,
): Promise<ValidateKeyResult> {
  try {
    if (provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
      });
      if (r.status === 401 || r.status === 403)
        return { ok: false, reason: "Anthropic rejected the key (auth)." };
      if (!r.ok) return { ok: false, reason: `Anthropic returned ${r.status}.` };
      const body = (await r.json().catch(() => null)) as
        | { data?: Array<{ id?: unknown }> }
        | null;
      const modelIds = Array.isArray(body?.data)
        ? body!.data
            .map((m) => (typeof m?.id === "string" ? m.id : ""))
            .filter((id): id is string => id.length > 0)
        : [];
      return { ok: true, modelIds };
    }
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (r.status === 401 || r.status === 403)
        return { ok: false, reason: "OpenAI rejected the key (auth)." };
      if (!r.ok) return { ok: false, reason: `OpenAI returned ${r.status}.` };
      const body = (await r.json().catch(() => null)) as
        | { data?: Array<{ id?: unknown }> }
        | null;
      const modelIds = Array.isArray(body?.data)
        ? body!.data
            .map((m) => (typeof m?.id === "string" ? m.id : ""))
            .filter((id): id is string => id.length > 0)
        : [];
      return { ok: true, modelIds };
    }
    // Gemini: GET /v1beta/models?key=<api_key>
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    );
    if (r.status === 401 || r.status === 403)
      return { ok: false, reason: "Gemini rejected the key (auth)." };
    if (!r.ok) return { ok: false, reason: `Gemini returned ${r.status}.` };
    const body = (await r.json().catch(() => null)) as
      | { models?: Array<{ name?: unknown }> }
      | null;
    // Gemini returns names like "models/gemini-3.5-flash" — strip the
    // "models/" prefix so callers can match against the bare model ID
    // we store in the catalogue and accept from the user.
    const modelIds = Array.isArray(body?.models)
      ? body!.models
          .map((m) => (typeof m?.name === "string" ? m.name : ""))
          .map((n) => (n.startsWith("models/") ? n.slice("models/".length) : n))
          .filter((id): id is string => id.length > 0)
      : [];
    return { ok: true, modelIds };
  } catch (err) {
    return {
      ok: false,
      reason: `Network error reaching ${provider}: ${(err as Error).message}`,
    };
  }
}

/**
 * Validate the chosen model.
 * Delegates to {@link validateChosenModel} so the pure logic stays
 * testable without standing up the server-action surface.
 */
function validateModel(
  provider: ProviderName,
  model: string | null | undefined,
  liveModelIds: string[],
): { ok: true } | { ok: false; reason: string } {
  return validateChosenModel(provider, model, liveModelIds);
}

export async function setByoaiKey(
  provider: string,
  plaintextKey: string,
  model: string | null = null,
): Promise<AiActionResult> {
  const parsed = setKeySchema.safeParse({ provider, plaintextKey, model });
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => i.message),
    };
  }

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const probe = await validateKey(parsed.data.provider, parsed.data.plaintextKey);
  if (!probe.ok) return { ok: false, errors: [probe.reason] };

  const chosenModel = parsed.data.model ?? null;
  const modelCheck = validateModel(
    parsed.data.provider,
    chosenModel,
    probe.modelIds,
  );
  if (!modelCheck.ok) return { ok: false, errors: [modelCheck.reason] };

  const supabase = await createClient();

  // Rotate / set: when a previous vault entry exists, clear it first
  // so the old ciphertext is removed.
  const { data: prior } = await supabase
    .from("profiles")
    .select("byoai_key_vault_id")
    .eq("id", user.id)
    .maybeSingle();
  const priorVaultId = prior?.byoai_key_vault_id as string | null | undefined;
  const isRotate = Boolean(priorVaultId);

  const { vaultId } = await storeVault(
    user.id,
    parsed.data.provider,
    parsed.data.plaintextKey,
  );

  const { error: profErr } = await supabase
    .from("profiles")
    .update({
      byoai_provider: parsed.data.provider,
      byoai_key_vault_id: vaultId,
      byoai_model: chosenModel,
    })
    .eq("id", user.id);
  if (profErr) return { ok: false, errors: [profErr.message] };

  // Best-effort: drop the old ciphertext after the new one is wired.
  if (priorVaultId) {
    try {
      await clearVault(user.id, priorVaultId);
    } catch {
      /* leave stale row; audit still records the rotate */
    }
  }

  await supabase.from("byoai_key_events").insert({
    user_id: user.id,
    action: isRotate ? "rotate" : "set",
    provider: parsed.data.provider,
  });

  revalidatePath("/app/settings/ai");
  return { ok: true };
}

export async function clearByoaiKey(): Promise<AiActionResult> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");
  const supabase = await createClient();

  const { data: prior } = await supabase
    .from("profiles")
    .select("byoai_provider, byoai_key_vault_id")
    .eq("id", user.id)
    .maybeSingle();
  const vaultId = prior?.byoai_key_vault_id as string | null | undefined;
  const provider = prior?.byoai_provider as string | null | undefined;

  if (vaultId) {
    try {
      await clearVault(user.id, vaultId);
    } catch {
      /* ignore — proceed to null the columns regardless */
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      byoai_provider: null,
      byoai_key_vault_id: null,
      byoai_model: null,
    })
    .eq("id", user.id);
  if (error) return { ok: false, errors: [error.message] };

  await supabase.from("byoai_key_events").insert({
    user_id: user.id,
    action: "clear",
    provider: provider ?? null,
  });

  revalidatePath("/app/settings/ai");
  return { ok: true };
}

export async function setAiOptIn(enabled: boolean): Promise<AiActionResult> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ ai_opt_in_at: enabled ? new Date().toISOString() : null })
    .eq("id", user.id);
  if (error) return { ok: false, errors: [error.message] };
  revalidatePath("/app/settings/ai");
  return { ok: true };
}
