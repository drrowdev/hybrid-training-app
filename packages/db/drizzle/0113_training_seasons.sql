-- 0113_training_seasons.sql
--
-- ADR 0051 Phase 0 — the macrocycle "Season" roadmap. Two tables + a profile
-- opt-in flag. A Season is an advisory, opt-in, ordered list of block intentions
-- above the program platform; one active Season per user. Only the ACTIVE block
-- is ever materialised into training_blocks/planned_sessions — future
-- season_blocks are intentions with no sessions. With the opt-in flag FALSE
-- (default), nothing here is surfaced and the app is byte-identical.
--
-- RLS posture mirrors program_instances (0102): a user may only see/touch their
-- own rows; authenticated role only; never service-role.

-- ── opt-in flag ──────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS season_planning_enabled boolean NOT NULL DEFAULT false;

-- ── training_seasons ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_seasons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  status       text NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS training_seasons_user_status_idx
  ON public.training_seasons (user_id, status);

ALTER TABLE public.training_seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS training_seasons_select_self ON public.training_seasons;
CREATE POLICY training_seasons_select_self
  ON public.training_seasons FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS training_seasons_insert_self ON public.training_seasons;
CREATE POLICY training_seasons_insert_self
  ON public.training_seasons FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS training_seasons_update_self ON public.training_seasons;
CREATE POLICY training_seasons_update_self
  ON public.training_seasons FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS training_seasons_delete_self ON public.training_seasons;
CREATE POLICY training_seasons_delete_self
  ON public.training_seasons FOR DELETE USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_seasons TO authenticated;

-- ── season_blocks ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.season_blocks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     uuid NOT NULL REFERENCES public.training_seasons(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position      integer NOT NULL,
  program_id    text NOT NULL,
  template_ref  text,
  emphasis      text NOT NULL DEFAULT 'base',
  intent_note   text,
  planned_weeks integer,
  status        text NOT NULL DEFAULT 'planned',
  block_id      uuid REFERENCES public.training_blocks(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT season_blocks_season_position_unq UNIQUE (season_id, position)
);

CREATE INDEX IF NOT EXISTS season_blocks_user_idx
  ON public.season_blocks (user_id);

ALTER TABLE public.season_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS season_blocks_select_self ON public.season_blocks;
CREATE POLICY season_blocks_select_self
  ON public.season_blocks FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS season_blocks_insert_self ON public.season_blocks;
CREATE POLICY season_blocks_insert_self
  ON public.season_blocks FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS season_blocks_update_self ON public.season_blocks;
CREATE POLICY season_blocks_update_self
  ON public.season_blocks FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS season_blocks_delete_self ON public.season_blocks;
CREATE POLICY season_blocks_delete_self
  ON public.season_blocks FOR DELETE USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.season_blocks TO authenticated;
