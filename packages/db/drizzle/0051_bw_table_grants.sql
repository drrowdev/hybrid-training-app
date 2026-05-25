-- 0051_bw_table_grants.sql
--
-- Continuation of 0050. The user's Supabase project disables automatic
-- table exposure (see migration 0010), so every BW-related table needs
-- explicit grants in addition to its RLS policies. Without them clients
-- hit "permission denied for table X" even with a valid RLS policy.
--
-- RLS still owns row-level access; these grants just put each table on
-- PostgREST's reachable-table list.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bw_progress TO authenticated;

GRANT SELECT, INSERT ON public.bw_progression_events TO authenticated;

GRANT SELECT, INSERT, DELETE ON public.bw_diagnostics_snapshots TO authenticated;
