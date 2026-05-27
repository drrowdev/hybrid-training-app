/**
 * Strava sync — server-only orchestration.
 *
 * Run by:
 *   - the "Sync now" button in /app/settings/strava (manual)
 *   - the OAuth callback after a fresh connect
 *
 * Idempotent: re-running is safe because sessions.strava_activity_id is
 * uniquely indexed per user and we upsert with ON CONFLICT DO NOTHING.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { listActivitiesSince, refreshAccessToken } from "./client";
import { buildSyncRow } from "./sync-row";
import { classifyAndLinkExternalCardio } from "./link-external-cardio";
import { recomputeRegionState } from "@/lib/engine/region-ledger";
import { getUserTimezone } from "@/lib/planner/queries";

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

  let imported = 0;
  let skipped = 0;
  let lastActivityAt: string | null = null;

  for (const a of activities) {
    if (lastActivityAt == null || a.start_date > lastActivityAt) lastActivityAt = a.start_date;
    const row = buildSyncRow(a, userId);
    if (!row) {
      skipped++;
      continue;
    }
    // Insert session, skipping if the unique partial index would conflict.
    const { data: inserted, error: insertErr } = await supabase
      .from("sessions")
      .insert(row.session)
      .select("id")
      .maybeSingle();
    if (insertErr) {
      // 23505 = unique_violation → already imported.
      if (insertErr.code === "23505" || /duplicate key/i.test(insertErr.message)) {
        skipped++;
        continue;
      }
      throw new Error(insertErr.message);
    }
    if (!inserted) {
      skipped++;
      continue;
    }
    const { data: cardioInserted, error: cardioErr } = await supabase
      .from("cardio_logs")
      .insert({
        session_id: inserted.id,
        modality: row.cardio.modality,
        duration_sec: row.cardio.duration_sec,
        distance_km: row.cardio.distance_km,
        avg_hr_bpm: row.cardio.avg_hr_bpm,
        max_hr_bpm: row.cardio.max_hr_bpm,
        rpe: row.cardio.rpe,
        strava_activity_id: row.cardio.strava_activity_id,
        external_source: row.cardio.external_source,
        notes: row.cardio.notes,
      })
      .select("id")
      .maybeSingle();
    if (cardioErr) {
      // Try to roll back the orphan session row so re-sync can retry.
      await supabase.from("sessions").delete().eq("id", inserted.id);
      throw new Error(cardioErr.message);
    }
    imported++;

    // Phase 2 — best-effort: classify HR + duration into a kind/ESL
    // and link to a matching cardio_external planned session.
    if (cardioInserted?.id) {
      try {
        await classifyAndLinkExternalCardio({
          supabase,
          userId,
          sessionId: inserted.id,
          cardioLog: {
            id: cardioInserted.id,
            avg_hr_bpm: row.cardio.avg_hr_bpm,
            max_hr_bpm: row.cardio.max_hr_bpm,
            duration_sec: row.cardio.duration_sec,
          },
          performedAt: row.session.performed_at,
          userTimezone: await getUserTimezone(userId),
        });
      } catch (e) {
        // Non-fatal: the cardio row is already persisted.
        console.error("classifyAndLinkExternalCardio failed:", e);
      }
    }
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
