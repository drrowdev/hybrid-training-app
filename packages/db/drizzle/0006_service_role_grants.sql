-- 0006_service_role_grants.sql
-- Ensure the Supabase service_role can read/write every public table
-- (RLS still applies on the user-scoped tables, but with bypassRLS for
-- service_role this means the role has full access). Needed for the
-- multi-user RLS integration test (which uses the secret key to
-- provision + clean up temp users + their data).
--
-- The 0001 migration granted authenticated + anon explicitly but
-- relied on Supabase defaults for service_role — turns out the new
-- 'sb_secret_…' key format doesn't carry an implicit grant on later-
-- added tables. So we grant explicitly here, idempotently.

GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Future-proofing: default privileges for new objects.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON FUNCTIONS TO service_role;
