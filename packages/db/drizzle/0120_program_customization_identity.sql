-- Durable identity for user-customized program instances.
-- The canonical engine remains program_id='tactical-barbell'; a non-null
-- customization_version marks an overlay-backed derivative independently of
-- its user-editable display name.

ALTER TABLE public.program_instances
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS customization_version smallint;

ALTER TABLE public.program_instances
  DROP CONSTRAINT IF EXISTS program_instances_customization_version_check;

ALTER TABLE public.program_instances
  ADD CONSTRAINT program_instances_customization_version_check
  CHECK (customization_version IS NULL OR customization_version > 0);
