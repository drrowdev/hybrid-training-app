"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { authorizeUrl } from "@/lib/integrations/strava/client";
import { syncStrava } from "@/lib/integrations/strava/sync";
import {
  findMatchingStravaActivity,
  listStravaActivitiesNear,
} from "@/lib/integrations/strava/match";
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
  cardioLogId: string;
  modality: string;
  performedAt: string;
  durationSec: number;
  distanceKm: number | null;
  avgHrBpm: number | null;
};

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
  // else is nearby (so the user can pick when the tight auto-match misses)?
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
      candidates = (await listStravaActivitiesNear(supabase, user.id, performedAt)).map((c) => ({
        cardioLogId: c.cardioLogId,
        modality: c.modality,
        performedAt: c.performedAt,
        durationSec: c.durationSec,
        distanceKm: c.distanceKm,
        avgHrBpm: c.avgHrBpm,
      }));
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
