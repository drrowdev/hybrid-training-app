ALTER TABLE public.training_blocks
  DROP CONSTRAINT IF EXISTS training_blocks_weeks_check;

ALTER TABLE public.training_blocks
  ADD CONSTRAINT training_blocks_weeks_check
  CHECK (weeks >= 1 AND weeks <= 52);
