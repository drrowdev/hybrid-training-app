-- 0134_rehab_protocol_library.down.sql
--
-- Reverses 0134 by dropping the two tables it created.
--
-- SAFE, WITH ONE CAVEAT. The forward migration never wrote
-- `program_instances`, `planned_sessions` or `sessions` — it only created
-- `rehab_protocols` + `program_rehab_bindings` and inserted into them. So
-- dropping them cannot corrupt a program or a plan: every customization blob
-- still carries the protocol items it always did, and the application falls
-- back to those items whenever a binding is absent. A rollback therefore
-- returns the app to exactly its pre-0134 behaviour.
--
-- THE CAVEAT: this also deletes any protocol the user authored in Settings
-- AFTER the migration ran, and those exist nowhere else. Before running this
-- against production, confirm either that the Settings UI was never released,
-- or that losing post-release protocols is acceptable — otherwise take a
-- backup first and re-seed from it.
--
-- Ship the application release that removed the Settings page and the wizard
-- selector FIRST, or those surfaces will error against the dropped tables.

DROP TABLE IF EXISTS public.program_rehab_bindings;
DROP TABLE IF EXISTS public.rehab_protocols;
