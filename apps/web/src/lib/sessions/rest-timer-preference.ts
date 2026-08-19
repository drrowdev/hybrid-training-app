/**
 * Reading the inter-set rest-countdown preference. Server-only.
 *
 * Deliberately NOT a `"use server"` module: only the mutation is a server
 * action (see `rest-timer-actions.ts`). A `"use server"` file may export
 * nothing but async functions, so the default constant could not live beside
 * the action anyway — and a plain module keeps the read out of the client
 * bundle's action manifest.
 *
 * ## Why this has its own query instead of joining the existing profile selects
 *
 * The repo deploys app-first and migrates afterwards (see the deploy-order
 * guard in `ci.yml`), so there is a window where this build is live and
 * `rest_timer_enabled` does not exist yet. PostgREST fails the WHOLE request on
 * an unknown column, so adding it to the session page's profile SELECT — which
 * also carries equipment, plate inventory, units and date formats — would take
 * every one of those down with it and silently fall back to defaults for every
 * user until the migration ran. A per-column `?? true` cannot rescue that:
 * there would be no row to read a column from.
 *
 * Reading it alone means the blast radius of "not migrated yet" is exactly this
 * one preference, which defaults to on — the behaviour everyone already has.
 * Once 0133 is applied everywhere this can be folded into the main select.
 */
import { createClient } from "@/lib/supabase/server";

/** On by default: the countdown is what every existing user already sees. */
export const REST_TIMER_DEFAULT = true;

/**
 * Read the preference for a user id, treating any failure — including the
 * pre-migration "column does not exist" — as the default.
 */
export async function readRestTimerEnabled(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("rest_timer_enabled")
    .eq("id", userId)
    .maybeSingle();
  if (error) return REST_TIMER_DEFAULT;
  return (data?.rest_timer_enabled as boolean | null) ?? REST_TIMER_DEFAULT;
}
