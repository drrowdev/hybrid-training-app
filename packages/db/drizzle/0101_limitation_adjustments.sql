-- 0101_limitation_adjustments.sql
--
-- Tracks the movement swaps/drops the engine applied in response to a
-- limitation (ADR 0014 mid-block response). The limitation apply path
-- previously rewrote the prescription with no audit trail, so the user could
-- never see "what was changed around this injury", and the Today card couldn't
-- reflect it. Each accepted swap/drop now records a row here, attributed to the
-- causing limitation where determinable.
--
-- Idempotent re-apply: UNIQUE (session_id, from_movement_id) — re-running the
-- offer for the same offending movement refreshes the row rather than
-- duplicating. ON DELETE CASCADE from the limitation so deleting an injury
-- clears its adjustment history.

CREATE TABLE IF NOT EXISTS public.limitation_adjustments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  limitation_id    uuid REFERENCES public.limitations(id) ON DELETE CASCADE,
  block_id         uuid,
  session_id       uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('swap', 'drop')),
  from_movement_id uuid NOT NULL,
  from_name        text NOT NULL,
  to_movement_id   uuid,
  to_name          text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS limitation_adjustments_session_from_key
  ON public.limitation_adjustments (session_id, from_movement_id);

CREATE INDEX IF NOT EXISTS limitation_adjustments_user_idx
  ON public.limitation_adjustments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS limitation_adjustments_limitation_idx
  ON public.limitation_adjustments (limitation_id);

-- RLS — standard self-owned pattern.
ALTER TABLE public.limitation_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS limitation_adjustments_select_self ON public.limitation_adjustments;
CREATE POLICY limitation_adjustments_select_self
  ON public.limitation_adjustments FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS limitation_adjustments_insert_self ON public.limitation_adjustments;
CREATE POLICY limitation_adjustments_insert_self
  ON public.limitation_adjustments FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS limitation_adjustments_update_self ON public.limitation_adjustments;
CREATE POLICY limitation_adjustments_update_self
  ON public.limitation_adjustments FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS limitation_adjustments_delete_self ON public.limitation_adjustments;
CREATE POLICY limitation_adjustments_delete_self
  ON public.limitation_adjustments FOR DELETE
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.limitation_adjustments TO authenticated;
