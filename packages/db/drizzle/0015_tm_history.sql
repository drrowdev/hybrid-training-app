-- 0015_tm_history.sql
-- Chronological log of training-max changes. Source of truth for PR-driven
-- bumps, block-complete bumps, deloads, and the per-lift TM trend chart.
--
-- Design: docs/design/prs-and-tm-progression.md
--
-- Idempotency: each bump trigger writes a deterministic trigger_key. The
-- partial unique index on (user_id, movement_id, trigger_key) ensures the
-- same set never re-fires a proposal, even if the user edits the set.

CREATE TYPE tm_change_reason AS ENUM (
  'manual',          -- user edited via Settings -> Training maxes
  'pr_detection',    -- a single-set PR triggered a recalibrate proposal
  'amrap_bump',      -- AMRAP confidence-gate bump
  'block_complete',  -- end-of-block default bump
  'deload',          -- 2-miss safety net
  'onboarding'       -- initial values seeded by the wizard
);

CREATE TABLE public.tm_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  movement_id   uuid NOT NULL,
  -- Null on the very first onboarding row (no prior TM existed).
  old_tm_kg     numeric(6, 2),
  new_tm_kg     numeric(6, 2) NOT NULL,
  reason        tm_change_reason NOT NULL,
  -- Session that triggered the change, when applicable. Null for manual
  -- edits + onboarding seeds.
  session_id    uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  -- Deterministic identity used for idempotency. Format:
  --   pr_detection:   "{session_id}:{movement_id}:pr"
  --   amrap_bump:     "{planned_session_id}:{movement_id}:amrap"
  --   block_complete: "{block_id}:{movement_id}:block_complete"
  --   deload:         "{session_id}:{movement_id}:deload"
  -- Null for manual + onboarding rows (no idempotency needed).
  trigger_key   text,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tm_history_user_movement_idx
  ON public.tm_history (user_id, movement_id, changed_at DESC);

-- Partial unique index drives the idempotency contract. A repeat insert
-- with the same trigger_key is a no-op (caller catches the unique-violation).
CREATE UNIQUE INDEX tm_history_trigger_unique_idx
  ON public.tm_history (user_id, movement_id, trigger_key)
  WHERE trigger_key IS NOT NULL;

ALTER TABLE public.tm_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY tm_history_self ON public.tm_history
  FOR ALL
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tm_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tm_history TO service_role;
