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
  max_heartrate: number | null;
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

/**
 * Per-second activity streams (best-effort).
 *
 * Strava's streams endpoint returns measured time-series for an activity.
 * We request only `heartrate` + `time` (keyed by type) to compute true
 * time-in-zone. This is intentionally **best-effort**: streams are
 * rate-limited and not every activity has an HR stream, so any failure
 * (404 no streams, 429 rate-limited, network, malformed body) resolves to
 * `null` and the caller falls back to the summary approximation. It never
 * throws — a missing stream must never break an import or webhook sync.
 */
export type StravaHrStream = {
  /** Heart-rate samples (bpm), aligned index-for-index with `time`. */
  heartrate: number[];
  /** Elapsed-seconds offset of each sample. */
  time: number[];
};

export async function fetchActivityStreams(
  accessToken: string,
  activityId: number,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<StravaHrStream | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = new URL(`${API_BASE}/activities/${activityId}/streams`);
  url.searchParams.set("keys", "heartrate,time");
  url.searchParams.set("key_by_type", "true");
  try {
    const res = await doFetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      heartrate?: { data?: unknown };
      time?: { data?: unknown };
    };
    const hr = body?.heartrate?.data;
    const time = body?.time?.data;
    if (!Array.isArray(hr) || !Array.isArray(time)) return null;
    const heartrate = hr.filter((v): v is number => typeof v === "number");
    const t = time.filter((v): v is number => typeof v === "number");
    if (heartrate.length === 0 || t.length === 0) return null;
    return { heartrate, time: t };
  } catch {
    return null;
  }
}

export class StravaRateLimitError extends Error {
  constructor(message = "Strava rate limit reached.") {
    super(message);
    this.name = "StravaRateLimitError";
  }
}

/**
 * Options for the per-page fetcher. Exposed for testing — production
 * code uses the defaults.
 */
export type FetchPageOptions = {
  /** Number of 429 retries to attempt before giving up. Default 3. */
  maxRetries?: number;
  /**
   * Base delay in ms for the exponential backoff (delay = base * 2^n
   * with ±50% jitter). Default 1000. Test code passes 0 to skip the
   * waits entirely.
   */
  backoffBaseMs?: number;
  /** Test seam for jitter so retries are deterministic. */
  random?: () => number;
  /** Test seam for the sleep call so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fetches one page of `/athlete/activities` with the given window. On
 * Strava 429 (rate-limited) we back off with jitter up to `maxRetries`
 * times, then throw `StravaRateLimitError`. Non-429 errors throw
 * immediately. Returns the parsed activity array (possibly empty).
 */
export async function fetchActivitiesPage(
  accessToken: string,
  params: {
    afterEpoch: number;
    beforeEpoch: number;
    page: number;
    perPage: number;
  },
  options: FetchPageOptions = {},
): Promise<StravaActivity[]> {
  const maxRetries = options.maxRetries ?? 3;
  const baseMs = options.backoffBaseMs ?? 1000;
  const rand = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;

  const url = new URL(`${API_BASE}/athlete/activities`);
  url.searchParams.set("after", String(params.afterEpoch));
  url.searchParams.set("before", String(params.beforeEpoch));
  url.searchParams.set("per_page", String(params.perPage));
  url.searchParams.set("page", String(params.page));

  let attempt = 0;
  for (;;) {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (res.status === 429) {
      if (attempt >= maxRetries) {
        throw new StravaRateLimitError(
          "Strava rate limit reached. Try again later or use a narrower date range.",
        );
      }
      // 1s, 2s, 4s … with ±50% jitter so coincident clients don't
      // hammer the next window simultaneously.
      const jitter = 0.5 + rand();
      const delay = Math.round(baseMs * 2 ** attempt * jitter);
      await sleep(delay);
      attempt++;
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Strava activities fetch failed (${res.status}): ${body.slice(0, 200)}`,
      );
    }
    const batch = (await res.json()) as StravaActivity[];
    return Array.isArray(batch) ? batch : [];
  }
}

/**
 * Lists every activity inside `[afterEpoch, beforeEpoch]` by paging
 * `/athlete/activities` until an empty page comes back. Each page goes
 * through `fetchActivitiesPage` so retries / backoff apply uniformly.
 *
 * `onPage` is invoked after each successful page so the caller can
 * surface progress UI (or write per-page state).
 */
export async function listActivitiesInRange(
  accessToken: string,
  params: {
    afterEpoch: number;
    beforeEpoch: number;
    perPage?: number;
  },
  options: FetchPageOptions & {
    onPage?: (info: { page: number; count: number }) => void;
    /**
     * Hard cap on pages we'll fetch in one call (defense in depth
     * against Strava returning non-empty pages indefinitely). Default
     * 200 pages × 30 = 6000 activities, well over any realistic
     * 365-day import.
     */
     maxPages?: number;
  } = {},
): Promise<StravaActivity[]> {
  const perPage = params.perPage ?? 30;
  const maxPages = options.maxPages ?? 200;
  const out: StravaActivity[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await fetchActivitiesPage(
      accessToken,
      {
        afterEpoch: params.afterEpoch,
        beforeEpoch: params.beforeEpoch,
        page,
        perPage,
      },
      options,
    );
    options.onPage?.({ page, count: batch.length });
    if (batch.length === 0) break;
    out.push(...batch);
    if (batch.length < perPage) break;
  }
  return out;
}
