/**
 * Strava OAuth + REST client (read-only).
 *
 * No external SDK — Strava's API is a small surface and a thin wrapper
 * keeps secrets in env vars without an extra dependency.
 *
 * Env contract (set in Vercel + .env.local):
 *   STRAVA_CLIENT_ID
 *   STRAVA_CLIENT_SECRET
 *   STRAVA_REDIRECT_URI  // e.g. https://hybrid.example.com/api/strava/callback
 */

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const API_BASE = "https://www.strava.com/api/v3";

export type StravaTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  athleteId: number;
  scopes: string;
};

export type StravaActivity = {
  id: number;
  name: string | null;
  type: string | null;
  sport_type: string | null;
  start_date: string; // ISO
  start_date_local: string | null;
  elapsed_time: number; // seconds
  moving_time: number; // seconds
  distance: number; // meters
  average_heartrate: number | null;
  perceived_exertion: number | null; // 0–10 if set by athlete
  suffer_score: number | null;
  description: string | null;
  trainer: boolean;
};

function readEnv(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const redirectUri = process.env.STRAVA_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Strava integration is not configured. Set STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, and STRAVA_REDIRECT_URI.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/** Returns the authorize URL the user should be redirected to. */
export function authorizeUrl(state: string): string {
  const { clientId, redirectUri } = readEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    approval_prompt: "auto",
    // activity:read covers public + private (non-anonymous) activities.
    scope: "read,activity:read",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Exchanges the OAuth code for an access + refresh token. */
export async function exchangeCode(code: string): Promise<StravaTokenResponse> {
  const { clientId, clientSecret } = readEnv();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Strava token exchange failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    scope?: string;
    athlete?: { id: number };
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at * 1000),
    athleteId: data.athlete?.id ?? 0,
    scopes: data.scope ?? "read,activity:read",
  };
}

/** Refreshes a soon-to-expire access token. */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}> {
  const { clientId, clientSecret } = readEnv();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Strava token refresh failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at * 1000),
  };
}

/**
 * Lists activities for the authenticated athlete since `afterEpoch`.
 * Pages until exhausted (per_page=100, max ~5 pages = 500 activities).
 */
export async function listActivitiesSince(
  accessToken: string,
  afterEpoch: number,
): Promise<StravaActivity[]> {
  const out: StravaActivity[] = [];
  for (let page = 1; page <= 5; page++) {
    const url = new URL(`${API_BASE}/athlete/activities`);
    url.searchParams.set("after", String(afterEpoch));
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Strava activities fetch failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const batch = (await res.json()) as StravaActivity[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}
