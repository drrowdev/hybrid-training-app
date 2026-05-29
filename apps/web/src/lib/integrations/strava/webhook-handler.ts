/**
 * Strava push-subscription webhook handler — pure orchestration.
 *
 * Strava push events are NOT signed (the docs explicitly say so).
 * Security therefore has to live in two places:
 *
 *   1. The verify-token round trip on the GET handshake: Strava sends
 *      `?hub.verify_token=…` once when the subscription is created and
 *      we must echo back the challenge ONLY if the token matches the
 *      one in our env. The route handler enforces this.
 *
 *   2. Every POST event includes `subscription_id`. We refuse events
 *      whose subscription_id is not the one currently registered to
 *      our app (also in env). That stops a curious caller from
 *      pushing forged events into our pipeline.
 *
 * At-least-once delivery: Strava promises *at least once* delivery and
 * will retry on non-2xx responses. The pure dedup mechanism is the
 * UNIQUE index on `strava_event_log(subscription_id, event_time,
 * object_id, aspect_type)` (migration 0075). The handler inserts the
 * row FIRST — a unique violation short-circuits the rest of the work
 * and we return 200 so Strava doesn't keep retrying.
 *
 * This module is dependency-injected (the SupabaseClient + a small
 * "single activity sync" function) so the tests can run without a
 * live database or HTTP egress.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type StravaWebhookEvent = {
  aspect_type: "create" | "update" | "delete";
  event_time: number; // epoch seconds
  object_id: number;
  object_type: "activity" | "athlete";
  owner_id: number; // strava athlete id
  subscription_id: number;
  updates?: Record<string, string | number | boolean>;
};

export type WebhookEnv = {
  /** Expected subscription_id — events with any other id are rejected. */
  subscriptionId: number;
};

export type SyncSingleFn = (
  supabase: SupabaseClient,
  userId: string,
  activityId: number,
) => Promise<
  | { status: "imported"; sessionId: string }
  | { status: "skipped"; reason: string }
  | { status: "missing" }
>;

export type WebhookOutcome =
  | { kind: "duplicate" }
  | { kind: "ignored"; reason: string }
  | { kind: "ok"; note: string }
  | { kind: "error"; message: string };

const PG_UNIQUE_VIOLATION = "23505";

/**
 * Pure handler — caller owns: parsing JSON, returning HTTP 200.
 *
 * Always logs to `strava_event_log` first. Return value is for the
 * route handler's telemetry; the HTTP status is ALWAYS 200 (except
 * for malformed JSON, which the route handles separately) so Strava
 * stops retrying.
 */
export async function handleStravaWebhookEvent(
  event: StravaWebhookEvent,
  deps: { supabase: SupabaseClient; env: WebhookEnv; syncSingle: SyncSingleFn },
): Promise<WebhookOutcome> {
  const { supabase, env, syncSingle } = deps;

  if (event.subscription_id !== env.subscriptionId) {
    return {
      kind: "ignored",
      reason: `subscription_id mismatch (got ${event.subscription_id})`,
    };
  }

  // Idempotency gate: insert the log row first; a unique violation
  // means we've already processed this exact event.
  const { error: logErr } = await supabase.from("strava_event_log").insert({
    subscription_id: event.subscription_id,
    event_time: event.event_time,
    object_id: event.object_id,
    object_type: event.object_type,
    aspect_type: event.aspect_type,
    owner_id: event.owner_id,
    payload: event,
    processed_ok: false,
  });
  if (logErr) {
    if (
      logErr.code === PG_UNIQUE_VIOLATION ||
      /duplicate key/i.test(logErr.message)
    ) {
      return { kind: "duplicate" };
    }
    return { kind: "error", message: `event log insert: ${logErr.message}` };
  }

  const markDone = (note: string) =>
    supabase
      .from("strava_event_log")
      .update({ processed_ok: true, processed_note: note })
      .eq("subscription_id", event.subscription_id)
      .eq("event_time", event.event_time)
      .eq("object_id", event.object_id)
      .eq("aspect_type", event.aspect_type);

  const markError = (message: string) =>
    supabase
      .from("strava_event_log")
      .update({ processed_ok: false, error: message })
      .eq("subscription_id", event.subscription_id)
      .eq("event_time", event.event_time)
      .eq("object_id", event.object_id)
      .eq("aspect_type", event.aspect_type);

  // Athlete-level deauthorize.
  if (event.object_type === "athlete") {
    if (
      event.aspect_type === "update" &&
      event.updates?.authorized === "false"
    ) {
      const { error: ue } = await supabase
        .from("strava_connections")
        .update({
          last_sync_error: "Athlete revoked authorization via Strava.",
          access_token: "",
          refresh_token: "",
        })
        .eq("athlete_id", event.owner_id);
      if (ue) {
        await markError(`deauth update: ${ue.message}`);
        return { kind: "error", message: ue.message };
      }
      await markDone("deauthorized");
      return { kind: "ok", note: "athlete deauthorized" };
    }
    await markDone("athlete-event ignored");
    return { kind: "ignored", reason: "athlete event not actionable" };
  }

  // Map athlete → user.
  const { data: conn, error: ce } = await supabase
    .from("strava_connections")
    .select("user_id")
    .eq("athlete_id", event.owner_id)
    .maybeSingle();
  if (ce) {
    await markError(`connection lookup: ${ce.message}`);
    return { kind: "error", message: ce.message };
  }
  if (!conn) {
    await markDone("no connection for athlete");
    return { kind: "ignored", reason: "no connection for athlete" };
  }
  const userId = (conn as { user_id: string }).user_id;

  if (event.aspect_type === "delete") {
    const { error: de } = await supabase
      .from("sessions")
      .delete()
      .eq("user_id", userId)
      .eq("strava_activity_id", event.object_id);
    if (de) {
      await markError(`delete session: ${de.message}`);
      return { kind: "error", message: de.message };
    }
    await markDone("deleted");
    return { kind: "ok", note: "activity deleted" };
  }

  // create or update → fetch + upsert via the single-activity sync.
  try {
    const result = await syncSingle(supabase, userId, event.object_id);
    await markDone(`sync:${result.status}`);
    return { kind: "ok", note: `sync ${result.status}` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markError(message);
    return { kind: "error", message };
  }
}
