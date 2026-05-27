-- 0066_cardio_inferred_confidence_check.sql
--
-- Add a CHECK constraint so inferred_confidence is bounded to the
-- claimed 0..1 range. `numeric(3,2)` alone allows -9.99 to 9.99,
-- which would let a bug write nonsense values.

ALTER TABLE public.cardio_logs
  DROP CONSTRAINT IF EXISTS cardio_logs_inferred_confidence_range_chk;

ALTER TABLE public.cardio_logs
  ADD CONSTRAINT cardio_logs_inferred_confidence_range_chk
  CHECK (inferred_confidence IS NULL OR (inferred_confidence >= 0 AND inferred_confidence <= 1));
