-- 0050_bw_catalog_grants.sql
--
-- Bodyweight catalog read-grants for authenticated/anon roles.
--
-- The user's Supabase project has automatic table exposure disabled
-- (see migration 0010_grants_for_planner_and_tm), so every public-readable
-- table needs explicit GRANTs. The bodyweight catalog tables added in
-- migration 0042 are intentionally global (no user_id, no RLS) and must
-- be SELECT-able by every signed-in user.
--
-- Without these grants the assessment submit fails with
-- "permission denied for table movement_nodes" the moment the server
-- action looks up node IDs by family/node_key.

GRANT SELECT ON public.movement_nodes TO authenticated;
GRANT SELECT ON public.movement_nodes TO anon;
