import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode } from "@/lib/integrations/strava/client";
import { syncStrava } from "@/lib/integrations/strava/sync";

const STATE_COOKIE = "strava_oauth_state";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const settingsUrl = new URL("/app/settings/strava", url.origin);

  if (error || !code) {
    settingsUrl.searchParams.set("strava_error", error ?? "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);
  if (!expectedState || expectedState !== state) {
    settingsUrl.searchParams.set("strava_error", "state_mismatch");
    return NextResponse.redirect(settingsUrl);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    settingsUrl.searchParams.set("strava_error", "not_signed_in");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const tokens = await exchangeCode(code);
    const { error: upsertErr } = await supabase.from("strava_connections").upsert(
      {
        user_id: user.id,
        athlete_id: tokens.athleteId,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt.toISOString(),
        scopes: tokens.scopes,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (upsertErr) throw new Error(upsertErr.message);

    try {
      await syncStrava(supabase, user.id);
    } catch (e) {
      await supabase
        .from("strava_connections")
        .update({ last_sync_error: (e as Error).message.slice(0, 500) })
        .eq("user_id", user.id);
    }
  } catch (e) {
    settingsUrl.searchParams.set("strava_error", (e as Error).message.slice(0, 200));
    return NextResponse.redirect(settingsUrl);
  }

  settingsUrl.searchParams.set("strava_connected", "1");
  return NextResponse.redirect(settingsUrl);
}
