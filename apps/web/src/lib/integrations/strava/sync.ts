/**
 * Strava sync — server-only orchestration.
 *
 * Run by:
 *   - the "Sync now" button in /app/settings/strava (manual)
 *   - the OAuth callback after a fresh connect
 *   - the webhook handler at /api/integrations/strava/webhook (single
 *     activity via `syncStravaSingle`)
 *
 * Idempotent: re-running is safe because sessions.strava_activity_id is
 * uniquely indexed per user and we upsert with ON CONFLICT DO NOTHING.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchActivityStreams,
  listActivitiesSince,
  refreshAccessToken,
} from "./client";
import { writeStravaActivity } from "./write-activity";
import { zonesFromStream } from "./zones-from-stream";
import { recomputeRegionState } from "@/lib/engine/region-ledger";
import { getUserTimezone } from "@/lib/planner/queries";
import { readZoneConfig } from "@/lib/stats/hr-zones";

const TOKEN_REFRESH_SAFETY_S = 60; // refresh if expiring within 60s
const DEFAULT_LOOKBACK_DAYS = 30;

type ConnectionRow = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  last_synced_at: string | null;
};

export async function syncStrava(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ imported: number; skipped: number; lastActivityAt: string | null }> {
  const { data: conn, error: ce } = await supabase
    .from("strava_connections")
    .select("user_id, access_token, refresh_token, expires_at, last_synced_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (ce) throw new Error(ce.message);
  if (!conn) throw new Error("Not connected to Strava.");
  const connection = conn as ConnectionRow;

  // Refresh token if expired or about to expire.
  let accessToken = connection.access_token;
  const expiresAtMs = new Date(connection.expires_at).getTime();
  if (expiresAtMs - Date.now() < TOKEN_REFRESH_SAFETY_S * 1000) {
    const refreshed = await refreshAccessToken(connection.refresh_token);
    accessToken = refreshed.accessToken;
    const { error: ue } = await supabase
      .from("strava_connections")
      .update({
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken,
        expires_at: refreshed.expiresAt.toISOString(),
      })
      .eq("user_id", userId);
    if (ue) throw new Error(ue.message);
  }

  const lookbackMs = DEFAULT_LOOKBACK_DAYS * 86_400_000;
  // Sync window: from the larger of last_synced_at and (now - 30d).
  const lastSynced = connection.last_synced_at
    ? new Date(connection.last_synced_at).getTime()
    : 0;
  const floor = Date.now() - lookbackMs;
  const afterEpoch = Math.floor(Math.max(lastSynced, floor) / 1000);

  const activities = await listActivitiesSince(accessToken, afterEpoch);

  // Load the user's HR-zone config once for the whole sync — passed
  // into buildSyncRow so each activity gets its hr_zones populated
  // (audit I3). Null is fine: rows will have hr_zones = null.
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("intake")
    .eq("id", userId)
    .maybeSingle();
  const bands = readZoneConfig(
    (profileRow?.intake as Record<string, unknown> | null) ?? null,
  );

  let imported = 0;
  let skipped = 0;
  let lastActivityAt: string | null = null;

  const userTimezone = await getUserTimezone(userId);

  for (const a of activities) {
    if (lastActivityAt == null || a.start_date > lastActivityAt) lastActivityAt = a.start_date;
    const result = await writeStravaActivity({
      supabase,
      userId,
      activity: a,
      bands,
      userTimezone,
    });
    if (result.status === "imported") imported++;
    else skipped++;
  }

  // Update sync state — successful run, clear last_sync_error.
  await supabase
    .from("strava_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    })
    .eq("user_id", userId);

  // Refresh the region ledger now that we have new cardio.
  if (imported > 0) {
    try {
      await recomputeRegionState(supabase, userId, await getUserTimezone(userId));
    } catch (e) {
      // Non-fatal — the ledger will catch up on next sync or completion.
      console.error("recomputeRegionState after Strava sync failed:", e);
    }
  }

  return { imported, skipped, lastActivityAt };
}

/**
 * Single-activity sync used by the Strava push webhook.
 *
 * Mirrors `syncStrava` for one activity id:
 *   - Refreshes the access token if expiring.
 *   - Fetches the activity from the v3 API.
 *   - Builds the sync row and upserts session + cardio_logs.
 *   - Best-effort classifies the cardio_external link.
 *
 * Returns "imported" / "skipped" / "missing" so the webhook handler
 * can log the outcome on the corresponding strava_event_log row.
 * Throws only on hard errors (network, schema mismatch) — duplicates
 * are NOT exceptions; they're "skipped".
 */
export async function syncStravaSingle(
  supabase: SupabaseClient,
  userId: string,
  activityId: number,
): Promise<
  | { status: "imported"; sessionId: string }
  | { status: "skipped"; reason: string }
  | { status: "missing" }
> {
  const { data: conn, error: ce } = await supabase
    .from("strava_connections")
    .select("user_id, access_token, refresh_token, expires_at, last_synced_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (ce) throw new Error(ce.message);
  if (!conn) return { status: "missing" };
  const connection = conn as ConnectionRow;

  let accessToken = connection.access_token;
  const expiresAtMs = new Date(connection.expires_at).getTime();
  if (expiresAtMs - Date.now() < TOKEN_REFRESH_SAFETY_S * 1000) {
    const refreshed = await refreshAccessToken(connection.refresh_token);
    accessToken = refreshed.accessToken;
    await supabase
      .from("strava_connections")
      .update({
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken,
        expires_at: refreshed.expiresAt.toISOString(),
      })
      .eq("user_id", userId);
  }

  const res = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}`,
    {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  if (res.status === 404) return { status: "skipped", reason: "not_found" };
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Strava single-activity fetch failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }
  const activity = (await res.json()) as import("./client").StravaActivity;

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("intake")
    .eq("id", userId)
    .maybeSingle();
  const bands = readZoneConfig(
    (profileRow?.intake as Record<string, unknown> | null) ?? null,
  );

  const userTimezone = await getUserTimezone(userId);

  // Real time-in-zone from the per-second HR stream (ADR 0009). The
  // single-activity webhook path is the budget-safe place to do this:
  // exactly one extra streams call per new activity. Best-effort — a
  // null result (no stream, rate-limited, error) falls back to the
  // summary leak-model approximation inside buildSyncRow.
  let streamZones = null;
  if (bands) {
    const streams = await fetchActivityStreams(accessToken, activityId);
    if (streams) {
      streamZones = zonesFromStream({
        hrStream: streams.heartrate,
        timeStream: streams.time,
        bands,
      });
    }
  }

  const result = await writeStravaActivity({
    supabase,
    userId,
    activity,
    bands,
    userTimezone,
    streamZones,
  });
  if (result.status === "skipped") return { status: "skipped", reason: result.reason };
  if (result.status === "duplicate") return { status: "skipped", reason: "duplicate" };

  await supabase
    .from("strava_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    })
    .eq("user_id", userId);

  try {
    await recomputeRegionState(supabase, userId, userTimezone);
  } catch (e) {
    console.error("recomputeRegionState after single-activity sync failed:", e);
  }

  return { status: "imported", sessionId: result.sessionId };
}
