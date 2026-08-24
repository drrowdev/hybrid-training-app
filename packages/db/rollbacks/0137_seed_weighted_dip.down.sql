-- Rollback 0137 — remove the weighted dip from the global movement library.
--
-- Deliberately guarded, and deliberately one transaction.
--
-- A global movement can be picked the moment it exists, so by the time anyone
-- rolls back it may be referenced from several places. Two of those FKs are
-- ON DELETE RESTRICT (`set_logs`, `session_movements`), so an unguarded delete
-- aborts rather than no-ops; two are ON DELETE CASCADE (`training_maxes`,
-- `tm_suggestions`), so an unguarded delete silently destroys a lifter's saved
-- max; and `tm_history` carries a `movement_id` with no FK at all, so nothing
-- would stop it being stranded.
--
-- So: delete only while nothing refers to it at all. If anything does, the row
-- stays. A catalog entry nobody can find again is a smaller problem than a
-- lifter's logged history losing its exercise.
--
-- BEGIN/COMMIT matters as much as the guard: the two statements share one
-- condition, and without a transaction the instructions could be deleted while
-- the movement survives, leaving a catalog row with its how-to stripped.

BEGIN;

DELETE FROM public.movement_instructions
 WHERE movement_id IN (
   SELECT m.id FROM public.movements m
    WHERE m.user_id IS NULL
      AND m.slug = 'weighted-dip'
      AND NOT EXISTS (SELECT 1 FROM public.set_logs s WHERE s.movement_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM public.session_movements sm WHERE sm.movement_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM public.training_maxes t WHERE t.movement_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM public.tm_suggestions ts WHERE ts.movement_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM public.tm_history th WHERE th.movement_id = m.id)
 );

DELETE FROM public.movements m
 WHERE m.user_id IS NULL
   AND m.slug = 'weighted-dip'
   AND NOT EXISTS (SELECT 1 FROM public.set_logs s WHERE s.movement_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM public.session_movements sm WHERE sm.movement_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM public.training_maxes t WHERE t.movement_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM public.tm_suggestions ts WHERE ts.movement_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM public.tm_history th WHERE th.movement_id = m.id);

COMMIT;
