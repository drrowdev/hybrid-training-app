-- 0058_backfill_experience_bands.sql
--
-- PR W2 ÔÇö backfill curated experience bands onto deployed catalogs.
-- Generated from `packages/db/seeds/movements-part{1,2,3}.ts` via
-- `scripts/generate-backfill-bands.ts`. Only rows whose curated band
-- diverges from the universal default `(0, 4)` are emitted ÔÇö
-- everything else already matches the migration default.
--
-- Scope: global seed movements (`user_id IS NULL`). Per-user custom
-- movements keep whatever band the user originally inserted (which is
-- always `(0, 4)` today since there's no UI to declare it yet).
--
-- Re-running is safe: each UPDATE is idempotent ÔÇö running it twice
-- writes the same values back.

UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'a-skip' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'ab-wheel-standing' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'archer-pull-up' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'b-skip' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'banded-jump' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'bench-press-paused' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'bike-indoor-sprints' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'bike-indoor-threshold' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'bike-indoor-vo2-4x4' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'block-pull-deadlift' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'box-jump-high' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'box-jump-low' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'broad-jump' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'bulgarian-split-squat-bb' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'butt-kicks' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'clean-pull' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'copenhagen-plank' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 0, experience_max = 2 WHERE slug = 'db-bench-flat' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 0, experience_max = 2 WHERE slug = 'db-row-single-arm' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'deficit-deadlift' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'deficit-rdl' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 3, experience_max = 4 WHERE slug = 'depth-jump' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'dip-ring' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'dragon-flag' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'dumbbell-snatch' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'erg-2k-tt' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'erg-intervals-500' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'erg-sprints-30-30' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'erg-threshold' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'floor-press' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 0, experience_max = 2 WHERE slug = 'goblet-squat' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'hang-clean' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'hang-power-clean' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'hang-snatch' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'high-knees' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'hill-bounds' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 3, experience_max = 4 WHERE slug = 'hurdle-hop' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'jm-press' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'jump-squat' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'kb-clean-and-jerk' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 0, experience_max = 2 WHERE slug = 'kb-swing-russian' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'kettlebell-snatch' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'kroc-row' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'lateral-hop' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'meadows-row' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'med-ball-chest-pass' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'med-ball-rotational-throw' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'med-ball-slam' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'medicine-ball-overhead-throw' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'nordic-ham-curl' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'paused-back-squat' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'paused-deadlift' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'pistol-squat' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'pogo-hop' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'power-clean' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'power-snatch' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 3, experience_max = 4 WHERE slug = 'push-jerk' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'run-hill-sprints' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'run-tempo' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'run-threshold' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'run-track-400' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'run-vo2-1k-repeats' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'run-vo2-4x4' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'seated-good-morning' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 3, experience_max = 4 WHERE slug = 'single-leg-bound' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'single-leg-rdl' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'sissy-squat' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'skater-jump' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'sled-push-heavy' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'snatch-pull' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 3, experience_max = 4 WHERE slug = 'split-jerk' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'split-squat-bb' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'split-squat-jump' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'strides' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'swim-intervals' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'tempo-back-squat' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'tuck-jump' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 1, experience_max = 4 WHERE slug = 'vertical-jump' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'weighted-pull-up' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'z-press' AND user_id IS NULL;
UPDATE public.movements SET experience_min = 2, experience_max = 4 WHERE slug = 'zercher-squat' AND user_id IS NULL;
