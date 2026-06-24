"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { authorizeUrl, refreshAccessToken, listActivitiesInRange } from "@/lib/integrations/strava/client";
import { syncStrava } from "@/lib/integrations/strava/sync";
import { findMatchingStravaActivity } from "@/lib/integrations/strava/match";
import {
  importStravaHistory as importStravaHistoryCore,
  type ImportInput,
  type ImportResult,
} from "@/lib/integrations/strava/import-history";

const STATE_COOKIE = "strava_oauth_state";
const RETURN_TO_COOKIE = "strava_oauth_return_to";

/** Allow-list of post-OAuth destinations. Anything else falls back to the
 *  default Settings page. Keeps the callback from being abused as an open
 *  redirector while still letting product surfaces (onboarding) opt in. */
const ALLOWED_RETURN_TO = new Set<string>(["onboarding"]);

/**
 * Generate a CSRF state token, set it as an httpOnly cookie, redirect to Strava.
 *
 * Accepts optional `FormData` so callers can submit it from a `<form>`:
 *   - `returnTo`: opaque key (see ALLOWED_RETURN_TO) telling the OAuth
 *     callback which surface to bounce back to. When omitted the callback
 *     defaults to the Strava settings page (existing behaviour).
 */
export async function connectStrava(formData?: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const requestedReturnTo =
    typeof formData?.get("returnTo") === "string"
      ? String(formData.get("returnTo"))
      : null;
  if (requestedReturnTo && ALLOWED_RETURN_TO.has(requestedReturnTo)) {
    cookieStore.set(RETURN_TO_COOKIE, requestedReturnTo, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
  } else {
    // Defensive: stale cookie from a previous attempt shouldn't hijack
    // a fresh Settings-page connect.
    cookieStore.delete(RETURN_TO_COOKIE);
  }

  redirect(authorizeUrl(state));
}

export async function disconnectStrava(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  await supabase.from("strava_connections").delete().eq("user_id", user.id);
  revalidatePath("/app/settings/strava");
  redirect("/app/settings/strava");
}

export async function syncStravaNow(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  try {
    await syncStrava(supabase, user.id);
  } catch (e) {
    await supabase
      .from("strava_connections")
      .update({ last_sync_error: (e as Error).message.slice(0, 500) })
      .eq("user_id", user.id);
  }
  revalidatePath("/app");
  revalidatePath("/app/settings/strava");
  redirect("/app/settings/strava");
}

/**
 * Callable variant of syncStravaNow used by in-session banners — does
 * not redirect, returns a JSON result so the banner can show inline
 * errors. Revalidates the current session path the caller passes in.
 *
 * After syncing it reports whether a Strava activity now MATCHES this
 * session (so the completion form can give explicit "found / none"
 * feedback instead of silently reverting).
 */
export type StravaSessionCandidate = {
  /** Strava activity id (the candidate is fetched live from the API, so it may
   *  not yet be imported as a cardio_log — e.g. an indoor "Workout" type). */
  stravaActivityId: string;
  name: string | null;
  /** Friendly activity-type label (e.g. "Run", "Workout"). */
  typeLabel: string;
  performedAt: string;
  durationSec: number;
  distanceKm: number | null;
  avgHrBpm: number | null;
};

/** ±12h window for the manual "pick the day's activity" list. */
const DAY_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Pretty label for a Strava sport_type/type ("VirtualRide" → "Virtual Ride"). */
function prettyType(sportType: string | null, type: string | null): string {
  const raw = sportType || type || "Activity";
  return raw.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * Fetch the user's Strava activities within ±12h of a session, straight from the
 * Strava API — so even activity types we don't IMPORT (indoor "Workout", etc.)
 * still appear in the manual picker. Returns [] on any error (best-effort).
 */
async function fetchStravaDayActivities(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  performedAt: string,
): Promise<StravaSessionCandidate[]> {
  const targetMs = Date.parse(performedAt);
  if (!Number.isFinite(targetMs)) return [];

  const { data: conn } = await supabase
    .from("strava_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn) return [];

  let accessToken = conn.access_token as string;
  try {
    const expiresAtMs = new Date(conn.expires_at as string).getTime();
    if (expiresAtMs - Date.now() < 60_000) {
      const refreshed = await refreshAccessToken(conn.refresh_token as string);
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

    const activities = await listActivitiesInRange(accessToken, {
      afterEpoch: Math.floor((targetMs - DAY_WINDOW_MS) / 1000),
      beforeEpoch: Math.floor((targetMs + DAY_WINDOW_MS) / 1000),
    });

    return activities
      .map((a) => ({
        stravaActivityId: String(a.id),
        name: a.name,
        typeLabel: prettyType(a.sport_type, a.type),
        performedAt: a.start_date,
        durationSec: a.elapsed_time || a.moving_time || 0,
        distanceKm: a.distance > 0 ? a.distance / 1000 : null,
        avgHrBpm: a.average_heartrate != null ? Math.round(a.average_heartrate) : null,
      }))
      .sort(
        (x, y) =>
          Math.abs(Date.parse(x.performedAt) - targetMs) -
          Math.abs(Date.parse(y.performedAt) - targetMs),
      )
      .slice(0, 10);
  } catch {
    return [];
  }
}

export async function syncStravaForSession(
  sessionId: string,
): Promise<
  | {
      ok: true;
      match: { durationSec: number; avgHrBpm: number | null } | null;
      candidates: StravaSessionCandidate[];
    }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  try {
    await syncStrava(supabase, user.id);
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    await supabase
      .from("strava_connections")
      .update({ last_sync_error: message })
      .eq("user_id", user.id);
    return { ok: false, error: message };
  }
  revalidatePath(`/app/sessions/${sessionId}`);

  // Did the sync surface an activity that matches this session's time, and what
  // else did the athlete record near it (fetched live from Strava so even
  // un-imported indoor "Workout" types are pickable)?
  let match: { durationSec: number; avgHrBpm: number | null } | null = null;
  let candidates: StravaSessionCandidate[] = [];
  try {
    const { data: sess } = await supabase
      .from("sessions")
      .select("performed_at")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    const performedAt = sess?.performed_at as string | null;
    if (performedAt) {
      const found = await findMatchingStravaActivity(supabase, user.id, performedAt, {});
      if (found) match = { durationSec: found.durationSec, avgHrBpm: found.avgHrBpm };
      candidates = await fetchStravaDayActivities(supabase, user.id, performedAt);
    }
  } catch {
    // Best-effort enrichment — a lookup failure never fails the sync.
  }
  return { ok: true, match, candidates };
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Best-effort background sync. Triggered from the Today page on every
 * load; runs only when the last sync is >24h old. Silently swallows
 * errors — the user can always trigger a manual sync from settings.
 */
export async function triggerStaleStravaSync(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return;

  const { data: conn } = await supabase
    .from("strava_connections")
    .select("last_synced_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!conn) return;

  const lastSynced = conn.last_synced_at ? new Date(conn.last_synced_at).getTime() : 0;
  if (Date.now() - lastSynced < STALE_AFTER_MS) return;

  try {
    await syncStrava(supabase, user.id);
    revalidatePath("/app");
  } catch (e) {
    await supabase
      .from("strava_connections")
      .update({ last_sync_error: (e as Error).message.slice(0, 500) })
      .eq("user_id", user.id);
  }
}

/**
 * User-triggered historical backfill — wraps `importStravaHistory`
 * with auth + path revalidation. Returns the structured result so the
 * Settings UI can render the imported/skipped/matched breakdown
 * without a redirect.
 */
export async function importStravaHistoryAction(
  input: ImportInput,
): Promise<ImportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const result = await importStravaHistoryCore(supabase, user.id, input);
  if (result.ok) {
    revalidatePath("/app");
    revalidatePath("/app/settings/strava");
  }
  return result;
}
