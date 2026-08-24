-- Down for 0135 — restore the one-recommendation-per-(block, kind) cardinality.
--
-- Rows added since 0135 may carry a non-empty occurrence_key, and more than one
-- of them can share (user_id, block_id, kind) — which is the whole point of the
-- column. Recreating the old unique index over that data would fail, so the
-- duplicates are resolved first: keep the OLDEST row of each
-- (user_id, block_id, kind) and delete the rest.
--
-- That loses recommendations, so it is deliberately explicit rather than a
-- silent cascade. Run it only to reverse the deploy.

DELETE FROM public.program_recommendations a
 USING public.program_recommendations b
 WHERE a.user_id = b.user_id
   AND a.block_id IS NOT DISTINCT FROM b.block_id
   AND a.kind = b.kind
   AND (a.created_at, a.id) > (b.created_at, b.id);

DROP INDEX IF EXISTS program_recommendations_user_block_kind_occurrence_unique;

CREATE UNIQUE INDEX IF NOT EXISTS program_recommendations_user_block_kind_unique
  ON public.program_recommendations (user_id, block_id, kind);

ALTER TABLE public.program_recommendations
  DROP COLUMN IF EXISTS "occurrence_key";
