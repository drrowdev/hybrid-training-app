/**
 * hasAiAccess — single server-side gate consumed by every in-app AI
 * surface (chat send, thread list, snapshot tool, key management).
 *
 * ADR 0002, "Access gating". Returns true iff ALL of:
 *   - a provider is selected (`byoai_provider` not null)
 *   - a vault entry is configured (`byoai_key_vault_id` not null)
 *   - the unlock gate is satisfied (`byoai_unlocked_at` not null —
 *     defaulted to now() for every signup today; reserved for the
 *     future one-time-payment unlock)
 *
 * The legacy `ai_opt_in_at` "master switch" column was dropped in
 * migration 0073 — presence of a configured BYOAI key IS the opt-in
 * signal for the in-app chat surface. The MCP path has its own
 * separate opt-in (the OAuth bridge in `apps/web/src/app/mcp/*`) and
 * deliberately does NOT consult this gate (ADR 0003).
 */

export type AiAccessProfileFields = {
  byoai_provider: string | null;
  byoai_key_vault_id: string | null;
  byoai_unlocked_at: string | Date | null;
};

export function hasAiAccess(profile: AiAccessProfileFields): boolean {
  return (
    profile.byoai_provider !== null &&
    profile.byoai_key_vault_id !== null &&
    profile.byoai_unlocked_at !== null
  );
}
