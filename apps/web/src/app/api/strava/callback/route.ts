import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { exchangeCode } from "@/lib/integrations/strava/client";
import { syncStrava } from "@/lib/integrations/strava/sync";

const STATE_COOKIE = "strava_oauth_state";
const RETURN_TO_COOKIE = "strava_oauth_return_to";

/** Map the opaque `returnTo` cookie value to a concrete path. The cookie
 *  is set by `connectStrava` (server action) from a known allow-list, so
 *  this is also constrained to known destinations. */
function destinationFor(returnTo: string | null, origin: string): URL {
  if (returnTo === "onboarding") return new URL("/onboarding", origin);
  return new URL("/app/settings/strava", origin);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookieStore = await cookies();
  const returnTo = cookieStore.get(RETURN_TO_COOKIE)?.value ?? null;
  // Consume the cookie eagerly so a failed attempt doesn't redirect the
  // user back to onboarding on a subsequent settings-page connect.
  cookieStore.delete(RETURN_TO_COOKIE);

  const settingsUrl = destinationFor(returnTo, url.origin);

  if (error || !code) {
    settingsUrl.searchParams.set("strava_error", error ?? "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);
  if (!expectedState || expectedState !== state) {
    settingsUrl.searchParams.set("strava_error", "state_mismatch");
    return NextResponse.redirect(settingsUrl);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
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
