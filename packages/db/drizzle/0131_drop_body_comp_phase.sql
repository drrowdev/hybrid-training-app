-- 0131_drop_body_comp_phase.sql
--
-- Drops the declared body-composition phase from `profiles`.
--
--   body_comp_phase     — enum gain | maintain | lean_out, NOT NULL DEFAULT 'maintain'
--   phase_started_at    — date the phase began
--   phase_target_weeks  — intended phase length
--
-- These three columns never influenced a single prescription. Nothing in the
-- planner or engine has ever read them: `lean_out` appears in no planner file,
-- and the only reader anywhere was the admin block-review export, which printed
-- them as reporting metadata. The settings UI told users that during a cut the
-- app "pulls back top-end intensity slightly and protects strength via heavy,
-- low-volume work" — that behaviour was never implemented, so the control was
-- actively misleading rather than merely unused.
--
-- The UI was removed in the preceding release. This finishes the job.
--
-- DESIGN CONTRACT: DC-Q2 (declared body-comp phases gate prescription) and
-- DC-T3 (body-comp drift detection, which keys off DC-Q2's declared phase) are
-- moved to ⏸ [BACKLOG] in docs/knowledge/hybrid-training-design-constraints.md
-- in the same change. They remain forward contracts — if phase-aware
-- prescription is ever built, it re-adds its own input rather than inheriting
-- a column of values collected while nothing consumed them.
--
-- DATA LOSS: the stored values are intentionally discarded. Because nothing
-- consumed them, every row's phase is whatever the user last selected in a
-- control that did nothing — there is no derived state to preserve and no
-- history keyed on it. Take a pg_dump of `profiles` first if the declarations
-- themselves are wanted for analysis.
--
-- Deploy ORDER MATTERS: ship the application release that removed the settings
-- UI FIRST. Running this against an older build breaks the training-profile
-- page's profile SELECT and the `updateProfile` writes.
--
-- `SELECT *` readers are unaffected by construction: the GDPR export route
-- (`/api/me/export`) selects `profiles.*`, so the columns simply stop
-- appearing. No export consumer indexes them by name.
--
-- ROLLBACK (schema only — dropped values are not restored):
--
--   CREATE TYPE public.body_comp_phase AS ENUM ('gain', 'maintain', 'lean_out');
--   ALTER TABLE public.profiles
--     ADD COLUMN body_comp_phase public.body_comp_phase NOT NULL DEFAULT 'maintain',
--     ADD COLUMN phase_started_at date,
--     ADD COLUMN phase_target_weeks smallint;
--
-- RLS needs no attention either way: `profiles` policies are row-scoped on
-- `auth.uid() = id` and never referenced these columns.
--
-- Kept inline rather than as a sibling `.down.sql`: the migration-drift guard
-- requires every .sql file under drizzle/ to have a `_journal.json` entry, and
-- drizzle only journals forward migrations.

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS body_comp_phase,
  DROP COLUMN IF EXISTS phase_started_at,
  DROP COLUMN IF EXISTS phase_target_weeks;

-- The enum type existed only for the column above.
DROP TYPE IF EXISTS public.body_comp_phase;
