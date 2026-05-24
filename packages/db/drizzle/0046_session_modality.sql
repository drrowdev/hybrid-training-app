-- 0046_session_modality.sql
--
-- Phase 5 of the bodyweight progression plan — mixed-modal classifier
-- + posterior-chain hinge compensation. Adds two columns to
-- planned_sessions:
--
--   session_modality
--       One of pure_strength / pure_hypertrophy / pure_z2_aerobic /
--       pure_hiit / mixed_modal / skill_focused / restorative. Stamped
--       at session-generation time by `classifySessionModality`
--       (apps/web/src/lib/planner/session-modality.ts). Indexed because
--       the recovery aggregator filters by modality when applying the
--       per-class multiplier.
--
--   effective_stress_load
--       Numeric(6,2) — the session's hard-set count scaled by the
--       modality's stress multiplier. Mixed-modal gets 1.25× per
--       addendum §6 ("third thing — interference and translation
--       imperfect"); HIIT 1.3×; skill-focused 1.2× (addendum §5 — CNS
--       demand from heavy isometric work); Z2 0.4×; restorative 0.2×.
--       Persisting it here lets the ceiling / stress-budget engine
--       aggregate without re-classifying every session on every pass.
--
-- Why two columns rather than one JSONB blob: per schema discipline
-- (plan §6.8) both fields drive reads — the modality drives the UI
-- chip and any future filter, the load drives the engine's math.
-- JSONB shovelware would obscure both.
--
-- Index strategy: a btree on session_modality covers the
-- "filter by modality" read; effective_stress_load is summed in
-- aggregates rather than filtered on, so it doesn't get its own index.
--
-- Backfill: NULL on existing rows is fine. The session-detail page
-- and engine both fall back when the value is absent (legacy blocks
-- created before 0046 simply skip the chip + multiplier).

ALTER TABLE public.planned_sessions
  ADD COLUMN IF NOT EXISTS session_modality text,
  ADD COLUMN IF NOT EXISTS effective_stress_load numeric(6, 2);

CREATE INDEX IF NOT EXISTS planned_sessions_modality_idx
  ON public.planned_sessions(session_modality);
