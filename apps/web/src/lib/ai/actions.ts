"use server";

/**
 * AI settings server actions.
 *
 * `setByoaiKey`   — store + audit. Validates the key with a tiny
 *                   zero-cost provider probe before writing it.
 * `clearByoaiKey` — clears the vault entry, nulls profile cols,
 *                   audits.
 *
 * The legacy `setAiOptIn` action was removed alongside the
 * `profiles.ai_opt_in_at` column in migration 0073 — having a
 * configured BYOAI key (or a live MCP authorization) is now the
 * opt-in signal.
 *
 * Auth pattern mirrors `apps/web/src/lib/limitations/actions.ts`.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { clearByoaiKey as clearVault, storeByoaiKey as storeVault } from "./vault";
import { setKeySchema } from "./schema";

export type AiActionResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Cheap pre-flight: send a tiny request to the provider's list-models
 * endpoint. If it 401s we surface "auth-failed" before persisting.
 * Each provider's models endpoint is documented as a zero-token,
 * zero-cost GET.
 */
async function validateKey(
  provider: "anthropic" | "openai" | "gemini",
  key: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
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
      return { ok: true };
    }
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (r.status === 401 || r.status === 403)
        return { ok: false, reason: "OpenAI rejected the key (auth)." };
      if (!r.ok) return { ok: false, reason: `OpenAI returned ${r.status}.` };
      return { ok: true };
    }
    // Gemini: GET /v1beta/models?key=<api_key>
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    );
    if (r.status === 401 || r.status === 403)
      return { ok: false, reason: "Gemini rejected the key (auth)." };
    if (!r.ok) return { ok: false, reason: `Gemini returned ${r.status}.` };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `Network error reaching ${provider}: ${(err as Error).message}`,
    };
  }
}

export async function setByoaiKey(
  provider: string,
  plaintextKey: string,
): Promise<AiActionResult> {
  const parsed = setKeySchema.safeParse({ provider, plaintextKey });
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

  // Store the ciphertext. This is the one persistence call that can throw
  // (missing AI_KEY_ENCRYPTION_KEY, service-role/RPC failure); catch it so a
  // misconfigured vault returns a friendly inline error instead of crashing the
  // server action to Next's error page.
  let vaultId: string;
  try {
    ({ vaultId } = await storeVault(
      user.id,
      parsed.data.provider,
      parsed.data.plaintextKey,
    ));
  } catch (err) {
    console.error("[setByoaiKey] vault store failed:", (err as Error).message);
    return {
      ok: false,
      errors: [
        "We couldn't securely store your key right now. Please try again — if it keeps failing, the key vault may be misconfigured on the server.",
      ],
    };
  }

  const { error: profErr } = await supabase
    .from("profiles")
    .update({
      byoai_provider: parsed.data.provider,
      byoai_key_vault_id: vaultId,
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
    .update({ byoai_provider: null, byoai_key_vault_id: null })
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
