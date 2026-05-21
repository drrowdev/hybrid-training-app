-- 0016_strava_integration.sql
-- Read-only Strava ingest (DC-U MVP) — pulls cardio activities into our
-- cardio_logs ledger so the region-freshness math (DC-C14) sees the full
-- training load, not just strength.
--
-- Architecture: per-user token storage + idempotent activity upsert keyed
-- on Strava's activity ID.

CREATE TABLE public.strava_connections (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id       bigint NOT NULL,
  access_token     text NOT NULL,
  refresh_token    text NOT NULL,
  -- Absolute UTC expiry of the access_token (Strava returns expires_at in
  -- seconds since epoch).
  expires_at       timestamptz NOT NULL,
  scopes           text NOT NULL DEFAULT 'read,activity:read',
  connected_at     timestamptz NOT NULL DEFAULT now(),
  last_synced_at   timestamptz,
  last_sync_error  text
);

CREATE INDEX strava_connections_athlete_idx
  ON public.strava_connections (athlete_id);

ALTER TABLE public.strava_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY strava_connections_self ON public.strava_connections
  FOR ALL
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strava_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strava_connections TO service_role;

-- Idempotency hook: a session sourced from a Strava activity carries the
-- activity ID. Partial unique index allows multiple non-Strava sessions
-- per user but blocks duplicate Strava imports.
ALTER TABLE public.sessions
  ADD COLUMN strava_activity_id bigint;

CREATE UNIQUE INDEX sessions_strava_activity_unique_idx
  ON public.sessions (user_id, strava_activity_id)
  WHERE strava_activity_id IS NOT NULL;
