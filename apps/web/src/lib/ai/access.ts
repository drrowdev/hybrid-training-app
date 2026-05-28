/**
 * hasAiAccess — single server-side gate consumed by every future AI
 * surface (chat send, thread list, snapshot tool, key management).
 *
 * ADR 0002, "Access gating". Returns true iff ALL of:
 *   - the user has opted in to AI features (`ai_opt_in_at` not null)
 *   - a provider is selected (`byoai_provider` not null)
 *   - a vault entry is configured (`byoai_key_vault_id` not null)
 *   - the unlock gate is satisfied (`byoai_unlocked_at` not null —
 *     defaulted to now() for every signup today; reserved for the
 *     future one-time-payment unlock)
 *
 * PR 1 exports this only — no route consults it yet.
 */

export type AiAccessProfileFields = {
  ai_opt_in_at: string | Date | null;
  byoai_provider: string | null;
  byoai_key_vault_id: string | null;
  byoai_unlocked_at: string | Date | null;
};

export function hasAiAccess(profile: AiAccessProfileFields): boolean {
  return (
    profile.ai_opt_in_at !== null &&
    profile.byoai_provider !== null &&
    profile.byoai_key_vault_id !== null &&
    profile.byoai_unlocked_at !== null
  );
}
