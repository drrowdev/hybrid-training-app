-- 0098_movement_instructions.sql
--
-- Per-movement how-to content for the in-workout exercise library. 1:1 with a
-- seed movement; kept in a SIDE table so the engine's hot catalog SELECTs stay
-- lean (the payload loads only when the detail sheet opens). Keyed by
-- movement_id (resolved from the stable slug at seed time). Terse content —
-- short steps + cues, no filler. Idempotent.

CREATE TABLE IF NOT EXISTS public.movement_instructions (
  movement_id uuid PRIMARY KEY REFERENCES public.movements(id) ON DELETE CASCADE,
  summary text NOT NULL,
  setup text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  cues jsonb NOT NULL DEFAULT '[]'::jsonb,
  common_mistakes jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'seed-v1',
  reviewed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: global read-only content. All rows are global how-to copy, so SELECT is
-- open to authenticated users; there are NO write policies, so PostgREST writes
-- are denied for every role — content is only ever changed by the seed runner
-- (direct connection, bypasses RLS) or migrations.
ALTER TABLE public.movement_instructions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "movement_instructions_select_all" ON public.movement_instructions;
CREATE POLICY "movement_instructions_select_all"
  ON public.movement_instructions FOR SELECT
  USING (true);

GRANT SELECT ON public.movement_instructions TO authenticated;

