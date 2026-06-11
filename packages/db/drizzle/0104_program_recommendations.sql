-- 0104 — program_recommendations: program-owned nudges surfaced after a logged
-- session (platform cutover).
--
-- A program engine's `onSessionLogged` returns recommendations (retest your
-- maxes, start your next block, 7th-week TM verdict, …) that are SURFACED to
-- the user, never auto-applied. They don't fit `tm_suggestions` (movement-
-- specific TM bumps) — this is the generic home. Informational: the user
-- dismisses them; any actual TM change still flows through tm_suggestions.

CREATE TABLE IF NOT EXISTS public.program_recommendations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program_instance_id uuid REFERENCES public.program_instances(id) ON DELETE CASCADE,
  block_id            uuid REFERENCES public.training_blocks(id) ON DELETE CASCADE,
  session_id          uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  kind                text NOT NULL,
  title               text NOT NULL,
  detail              text NOT NULL,
  data                jsonb,
  status              text NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz
);

CREATE INDEX IF NOT EXISTS program_recommendations_user_status_idx
  ON public.program_recommendations (user_id, status, created_at);

ALTER TABLE public.program_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS program_recommendations_select_self ON public.program_recommendations;
CREATE POLICY program_recommendations_select_self
  ON public.program_recommendations FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS program_recommendations_insert_self ON public.program_recommendations;
CREATE POLICY program_recommendations_insert_self
  ON public.program_recommendations FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS program_recommendations_update_self ON public.program_recommendations;
CREATE POLICY program_recommendations_update_self
  ON public.program_recommendations FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS program_recommendations_delete_self ON public.program_recommendations;
CREATE POLICY program_recommendations_delete_self
  ON public.program_recommendations FOR DELETE
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_recommendations TO authenticated;
