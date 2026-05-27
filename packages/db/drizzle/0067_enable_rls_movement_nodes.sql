-- 0067_enable_rls_movement_nodes.sql
--
-- Enable RLS on the bodyweight skill-tree catalog table.
--
-- Context: migration 0042 created movement_nodes as a GLOBAL read-only
-- catalog (no user_id column), and migration 0050 explicitly granted
-- SELECT to authenticated + anon. RLS was intentionally left off
-- because every user reads the same rows.
--
-- However, Supabase's security advisor flags ANY public-schema table
-- without RLS as a critical issue (rls_disabled_in_public) even when
-- the table is genuinely global. To clear the advisor without
-- changing behaviour we:
--   1. Turn RLS on.
--   2. Add a permissive SELECT policy for authenticated + anon (matches
--      the existing GRANT scope from 0050).
--   3. Do NOT add INSERT/UPDATE/DELETE policies — catalog maintenance
--      happens via the seed script using the service role, which
--      bypasses RLS by design.
--
-- Net effect: same read access as before, and a default-deny on writes
-- for any non-service role, plus a green advisor card.

ALTER TABLE public.movement_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS movement_nodes_select_all ON public.movement_nodes;
CREATE POLICY movement_nodes_select_all
  ON public.movement_nodes
  FOR SELECT
  TO authenticated, anon
  USING (true);
