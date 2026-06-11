-- 0105 — make program_recommendations idempotent.
--
-- PR5 review follow-up. The completion hook dedups recommendations in
-- application code (skip a still-pending row of the same block+kind), but
-- completeSessionResult is re-runnable and can race (double-tap / two tabs):
-- two concurrent completions both read "none pending" and both insert. A unique
-- key makes the insert idempotent at the DB level (paired with upsert
-- ignoreDuplicates in the hook). One recommendation of each kind per block —
-- exactly the intended cardinality. Rows with NULL block_id are treated as
-- distinct by Postgres (the rare no-block edge case is unaffected).

CREATE UNIQUE INDEX IF NOT EXISTS program_recommendations_user_block_kind_unique
  ON public.program_recommendations (user_id, block_id, kind);
