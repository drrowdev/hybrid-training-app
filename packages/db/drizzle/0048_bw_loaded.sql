-- 0048_bw_loaded.sql
--
-- Phase 7 of the bodyweight progression plan: loaded bodyweight.
-- Adds the two columns the loaded-BW path persists on top of the
-- existing Phase 4 / 5 / 6 tables:
--
--   bw_progress.target_external_load_kg
--     The "next load to try" the suggestLoadOrVariant engine wrote
--     when the user tapped "Apply suggestion" on the bodyweight-
--     progression settings page. Read by the planner via the
--     bwPrescription Stage D heuristic; nullable so existing rows
--     and bodyweight-only users keep working unchanged.
--
--   bw_progression_events.load_kg_at_advance
--     The actual external load (kg) the user was carrying at the
--     moment evaluateProgression advanced them to the next node.
--     Lets the audit timeline distinguish "BW-only advance" from
--     "loaded advance" without a follow-up join into clean_rep_history.
--
-- Schema discipline (plan §6.8): both columns drive a read — the
-- planner consumes target_external_load_kg, the audit list renders
-- load_kg_at_advance. Numeric(5,2) matches the precision of
-- training_maxes.training_max_kg so loaded-BW values round-trip
-- through the same kg formatting helpers.
--
-- Equipment shape extension: the new vest / belt / ankle / band-
-- strength fields land in profiles.equipment (jsonb). No new column
-- required — the parseEquipment validator at the boundary
-- (apps/web/src/lib/settings/equipment-schema.ts) covers shape rules.
-- Documented here so future readers know where the inventory
-- richness lives.

ALTER TABLE public.bw_progress
  ADD COLUMN IF NOT EXISTS target_external_load_kg numeric(5,2);

ALTER TABLE public.bw_progression_events
  ADD COLUMN IF NOT EXISTS load_kg_at_advance numeric(5,2);
