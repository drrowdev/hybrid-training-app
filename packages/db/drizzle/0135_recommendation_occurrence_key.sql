-- 0135 — let one plan raise the same kind of recommendation more than once.
--
-- Migration 0105 made recommendations idempotent with UNIQUE (user_id,
-- block_id, kind). That is the right cardinality for a nudge that can only
-- happen once per plan, and the wrong one for anything that recurs.
--
-- One `training_blocks` row holds every engine block of an instance: a
-- Tactical Barbell plan with `blocks: 3` materialises three 6-week blocks into
-- ONE row. So the index caps the plan at a single `tm-test` and a single
-- `deload` however many blocks it runs — and because the index covers every
-- row regardless of status, a DISMISSED nudge keeps occupying the slot. Block
-- 2's "retest your maxes" is already being swallowed by block 1's today.
--
-- `occurrence_key` names WHICH occurrence a row is for (e.g. the engine block a
-- peak week closes). '' means "the one occurrence for this plan", which is what
-- every existing row is, so behaviour for a plan that raises a kind once is
-- unchanged.
--
-- NOT NULL DEFAULT '' rather than a nullable column: two NULLs are distinct in
-- a Postgres unique index, which would silently reintroduce the duplicate-insert
-- race 0105 closed. COALESCE inside the index fixes that but makes it an
-- EXPRESSION index, and Postgres cannot infer an expression index from the bare
-- column list PostgREST sends for `on_conflict` — every upsert would then fail
-- with 42P10. A plain NOT NULL column keeps both properties.

ALTER TABLE public.program_recommendations
  ADD COLUMN IF NOT EXISTS "occurrence_key" text;

UPDATE public.program_recommendations
   SET occurrence_key = ''
 WHERE occurrence_key IS NULL;

ALTER TABLE public.program_recommendations
  ALTER COLUMN "occurrence_key" SET DEFAULT '';

ALTER TABLE public.program_recommendations
  ALTER COLUMN "occurrence_key" SET NOT NULL;

COMMENT ON COLUMN public.program_recommendations.occurrence_key IS
  'Which occurrence of `kind` this row is for within the plan (e.g. the engine block a peak week closes). Empty string = the plan raises this kind once.';

DROP INDEX IF EXISTS program_recommendations_user_block_kind_unique;

CREATE UNIQUE INDEX IF NOT EXISTS program_recommendations_user_block_kind_occurrence_unique
  ON public.program_recommendations
     (user_id, block_id, kind, occurrence_key);
