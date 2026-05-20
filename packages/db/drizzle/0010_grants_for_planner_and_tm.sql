-- 0010_grants_for_planner_and_tm.sql
-- Authenticated-role grants for tables added in 0007/0008 (training_maxes,
-- training_blocks, planned_sessions). RLS policies already restrict to
-- self; this just opens the table-level door so PostgREST stops returning
-- "permission denied".
--
-- Why this wasn't automatic: ALTER DEFAULT PRIVILEGES from 0006 only
-- applies to objects created by the role that ran the ALTER, and drizzle
-- migrate uses a different role. Granting explicitly per new table is the
-- documented Supabase pattern (mirrors what 0003 and 0005 do).

GRANT SELECT, INSERT, UPDATE, DELETE ON "training_maxes"    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "training_blocks"   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "planned_sessions"  TO authenticated;
