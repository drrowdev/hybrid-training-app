-- 0062_session_movements_grants.sql
--
-- Migration 0059 created session_movements with RLS + policies but
-- forgot the table-level GRANTs to the `authenticated` role. The repo
-- convention (every other migration that adds a public.* table issues
-- the corresponding GRANTs — see 0003, 0010, 0051, etc.) is required
-- because automatic privilege exposure is disabled on this Supabase
-- project (see CLAUDE.md / memory notes).
--
-- Symptom that surfaced: `permission denied for table
-- session_movements` raised by Postgres BEFORE RLS even evaluates,
-- because the `authenticated` role lacks INSERT/SELECT/DELETE on the
-- table. RLS policies are necessary but not sufficient.
--
-- Hotfix: add the missing GRANTs. Behaviour-equivalent to having
-- shipped them with 0059. RLS continues to scope each row to its
-- owner via auth.uid() = user_id.

GRANT SELECT, INSERT, DELETE ON public.session_movements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_movements TO service_role;
