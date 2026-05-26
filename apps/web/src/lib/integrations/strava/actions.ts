"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { authorizeUrl } from "@/lib/integrations/strava/client";
import { syncStrava } from "@/lib/integrations/strava/sync";

const STATE_COOKIE = "strava_oauth_state";

/** Generate a CSRF state token, set it as an httpOnly cookie, redirect to Strava. */
export async function connectStrava(): Promise<void> {
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
