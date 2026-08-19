-- 0134_rehab_protocol_library.sql
--
-- Promotes rehab protocols from "a field inside one program" to a reusable
-- library the user authors in Settings.
--
--   rehab_protocols         — the library. One row per protocol, per user.
--   program_rehab_bindings  — attaches a library protocol to a protocol slot of
--                             a program instance.
--
-- WHY A BINDING TABLE INSTEAD OF WRITING THE LIBRARY ID INTO THE CUSTOMIZATION
--
-- The obvious move is to stamp `libraryId` onto each protocol inside
-- `program_instances.setup_input.customization`. That is unsafe here:
--
--   1. The customization is `.strict()`-validated by Zod, and this repo deploys
--      APP FIRST, DATABASE SECOND (see the deploy-order guard in ci.yml), so the
--      previous build is serving traffic while the migration runs. An older
--      build reading a stamped blob rejects the whole customization — and
--      `edit-context.ts` `safeParse`s it, so the failure is SILENT: the wizard
--      opens with the user's rehab configuration missing.
--   2. `ON DELETE RESTRICT` on a real FK makes "you cannot delete a protocol a
--      program is using" a database guarantee rather than a check-then-delete
--      race against a concurrent deploy.
--   3. Legacy V1/V2 customizations have no named-protocol array to stamp at all;
--      they carry one unnamed item list addressed by the synthetic id
--      `protocol-1`. A binding row handles them identically to V3.
--
-- The consequence that matters most: THIS MIGRATION NEVER WRITES
-- `program_instances`, `planned_sessions` OR `sessions`. It only creates two new
-- tables and inserts into them. Every deployed program keeps parsing and
-- materialising exactly as it does today, so no scheduled session can change.
--
-- WHAT THE BACKFILL TAKES
--
-- Protocols from each user's CURRENT tactical-barbell programs — instances that
-- are `status='active'`, not soft-deleted, and whose training block is itself
-- active and not deleted. Archived instances are deliberately excluded: editing
-- a program archives the old row and inserts a new one, so including them would
-- fill the library with every past revision of the same protocol.
--
-- Deduplication is by exact content — `(user_id, name, items, links)` compared
-- as jsonb, which normalises key order and numeric representation for us. Two
-- active programs sharing a protocol therefore produce ONE library row with TWO
-- bindings. Nothing is merged on name alone, so two genuinely different
-- protocols that happen to share a name both survive.
--
-- IDS ARE PRESERVED. The binding stores the customization's existing local id
-- (`protocol-1`, `protocol-2`, …), so `sessionLinks` keys (`rehab.<localId>`),
-- `rehabAssignments[].protocolId`, and the `rehabSourceRef` values already
-- written into materialised prescriptions all keep resolving unchanged.
--
-- ROLLBACK: packages/db/rollbacks/0134_rehab_protocol_library.down.sql

CREATE TABLE IF NOT EXISTS public.rehab_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  definition jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Fail closed on a malformed definition. RLS lets a user write this table
  -- directly through PostgREST, so the Zod validation in the server action is
  -- not the only way in.
  CONSTRAINT rehab_protocols_name_len CHECK (
    char_length(btrim(name)) BETWEEN 1 AND 120
  ),
  CONSTRAINT rehab_protocols_definition_shape CHECK (
    jsonb_typeof(definition->'items') = 'array'
    AND jsonb_array_length(definition->'items') BETWEEN 1 AND 20
    AND jsonb_typeof(definition->'links') = 'array'
  )
);

CREATE INDEX IF NOT EXISTS rehab_protocols_user_idx
  ON public.rehab_protocols (user_id);

CREATE TABLE IF NOT EXISTS public.program_rehab_bindings (
  program_instance_id uuid NOT NULL
    REFERENCES public.program_instances(id) ON DELETE CASCADE,
  local_protocol_id text NOT NULL,
  rehab_protocol_id uuid NOT NULL
    REFERENCES public.rehab_protocols(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (program_instance_id, local_protocol_id)
);

CREATE INDEX IF NOT EXISTS program_rehab_bindings_protocol_idx
  ON public.program_rehab_bindings (rehab_protocol_id);
CREATE INDEX IF NOT EXISTS program_rehab_bindings_user_idx
  ON public.program_rehab_bindings (user_id);

-- ---------------------------------------------------------------- RLS

ALTER TABLE public.rehab_protocols ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rehab_protocols_select_self ON public.rehab_protocols;
CREATE POLICY rehab_protocols_select_self
  ON public.rehab_protocols FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS rehab_protocols_insert_self ON public.rehab_protocols;
CREATE POLICY rehab_protocols_insert_self
  ON public.rehab_protocols FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS rehab_protocols_update_self ON public.rehab_protocols;
CREATE POLICY rehab_protocols_update_self
  ON public.rehab_protocols FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS rehab_protocols_delete_self ON public.rehab_protocols;
CREATE POLICY rehab_protocols_delete_self
  ON public.rehab_protocols FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rehab_protocols TO authenticated;

ALTER TABLE public.program_rehab_bindings ENABLE ROW LEVEL SECURITY;

-- The write policies verify OWNERSHIP OF BOTH REFERENCED ROWS, not just the
-- denormalised `user_id`. Checking `auth.uid() = user_id` alone would let a
-- user insert a binding of their own that points at somebody else's protocol
-- id: the foreign key permits it, and `ON DELETE RESTRICT` would then stop the
-- real owner from ever deleting that protocol.

DROP POLICY IF EXISTS program_rehab_bindings_select_self ON public.program_rehab_bindings;
CREATE POLICY program_rehab_bindings_select_self
  ON public.program_rehab_bindings FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS program_rehab_bindings_insert_self ON public.program_rehab_bindings;
CREATE POLICY program_rehab_bindings_insert_self
  ON public.program_rehab_bindings FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.rehab_protocols p
       WHERE p.id = rehab_protocol_id AND p.user_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.program_instances i
       WHERE i.id = program_instance_id AND i.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS program_rehab_bindings_update_self ON public.program_rehab_bindings;
CREATE POLICY program_rehab_bindings_update_self
  ON public.program_rehab_bindings FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.rehab_protocols p
       WHERE p.id = rehab_protocol_id AND p.user_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.program_instances i
       WHERE i.id = program_instance_id AND i.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS program_rehab_bindings_delete_self ON public.program_rehab_bindings;
CREATE POLICY program_rehab_bindings_delete_self
  ON public.program_rehab_bindings FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_rehab_bindings TO authenticated;

-- ---------------------------------------------------------------- backfill
--
-- Every jsonb traversal below is guarded by `jsonb_typeof(...)`. A JSON null, a
-- scalar or an object where an array is expected would otherwise abort
-- `jsonb_array_elements` and take the whole migration with it — and these blobs
-- span three schema versions written over the app's lifetime.
--
-- `version` is compared as text (`->>`) rather than cast to int, so a malformed
-- legacy value is skipped instead of raising.

WITH src AS (
  SELECT
    pi.id                                  AS program_instance_id,
    pi.user_id                             AS user_id,
    pi.setup_input->'customization'        AS cust,
    CASE
      WHEN jsonb_typeof(pi.setup_input->'sessionLinks'->'bySeries') = 'object'
        THEN pi.setup_input->'sessionLinks'->'bySeries'
      ELSE '{}'::jsonb
    END                                    AS links
  FROM public.program_instances pi
  JOIN public.training_blocks tb ON tb.id = pi.block_id
  WHERE pi.deleted_at IS NULL
    AND pi.status = 'active'
    AND pi.program_id = 'tactical-barbell'
    AND tb.deleted_at IS NULL
    AND tb.status = 'active'
    AND jsonb_typeof(pi.setup_input->'customization') = 'object'
),
candidates AS (
  -- V3 (current Activation): named protocols, each with its own local id.
  SELECT
    s.program_instance_id,
    s.user_id,
    p->>'id'                          AS local_id,
    NULLIF(btrim(p->>'name'), '')     AS raw_name,
    p->'items'                        AS items,
    s.links
  FROM src s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(s.cust->'rehabProtocols') = 'array'
         THEN s.cust->'rehabProtocols'
         ELSE '[]'::jsonb END
  ) AS p
  WHERE s.cust->>'version' = '3'
    AND p->>'id' IS NOT NULL
    AND jsonb_typeof(p->'items') = 'array'
    AND jsonb_array_length(p->'items') BETWEEN 1 AND 20

  UNION ALL

  -- V1 (non-Activation) and V2 (legacy Activation): ONE unnamed item list,
  -- addressed everywhere in the code by the synthetic id `protocol-1`. Its name
  -- falls back to the program's own display name, which is the only
  -- user-authored label these versions carry.
  SELECT
    s.program_instance_id,
    s.user_id,
    'protocol-1'                                AS local_id,
    NULLIF(btrim(s.cust->>'displayName'), '')   AS raw_name,
    s.cust->'rehab'->'items'                    AS items,
    s.links
  FROM src s
  WHERE s.cust->>'version' IN ('1', '2')
    AND jsonb_typeof(s.cust->'rehab'->'items') = 'array'
    AND jsonb_array_length(s.cust->'rehab'->'items') BETWEEN 1 AND 20
),
resolved AS (
  SELECT
    c.program_instance_id,
    c.user_id,
    c.local_id,
    left(COALESCE(c.raw_name, 'Rehab'), 120) AS name,
    jsonb_build_object(
      'items', c.items,
      'links', CASE
        WHEN jsonb_typeof(c.links->('rehab.' || c.local_id)) = 'array'
          THEN c.links->('rehab.' || c.local_id)
        ELSE '[]'::jsonb
      END
    ) AS definition
  FROM candidates c
),
inserted AS (
  INSERT INTO public.rehab_protocols (user_id, name, definition)
  SELECT DISTINCT r.user_id, r.name, r.definition
  FROM resolved r
  RETURNING id, user_id, name, definition
)
INSERT INTO public.program_rehab_bindings
  (program_instance_id, local_protocol_id, rehab_protocol_id, user_id)
SELECT r.program_instance_id, r.local_id, i.id, r.user_id
FROM resolved r
JOIN inserted i
  ON i.user_id = r.user_id
 AND i.name = r.name
 AND i.definition = r.definition
ON CONFLICT (program_instance_id, local_protocol_id) DO NOTHING;
