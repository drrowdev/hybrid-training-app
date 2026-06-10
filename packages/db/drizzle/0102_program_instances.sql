-- program_instances — serialised state for the multi-program training platform.
-- One ACTIVE row per user; switching programs archives the old row. The user's
-- history + strength state live in sessions/set_logs/training_maxes and persist
-- across switches. The materialised plan lives in training_blocks + planned_sessions
-- (block_id links here).

CREATE TABLE IF NOT EXISTS public.program_instances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program_id      text NOT NULL,
  program_family  text NOT NULL,
  instance        jsonb NOT NULL,
  setup_input     jsonb,
  block_id        uuid REFERENCES public.training_blocks(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS program_instances_user_status_idx
  ON public.program_instances (user_id, status);

-- Row Level Security: a user may only ever see/touch their own rows.
ALTER TABLE public.program_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS program_instances_select_self ON public.program_instances;
CREATE POLICY program_instances_select_self
  ON public.program_instances FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS program_instances_insert_self ON public.program_instances;
CREATE POLICY program_instances_insert_self
  ON public.program_instances FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS program_instances_update_self ON public.program_instances;
CREATE POLICY program_instances_update_self
  ON public.program_instances FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS program_instances_delete_self ON public.program_instances;
CREATE POLICY program_instances_delete_self
  ON public.program_instances FOR DELETE
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_instances TO authenticated;
