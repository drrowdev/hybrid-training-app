-- 0042_bw_skill_tree.sql
--
-- Phase 1 of the bodyweight progression plan: data only.
-- Adds the skill-tree DAG schema + the per-user progress table, and
-- extends training_maxes so a row can anchor on a node instead of a
-- weight. Catalog rows arrive via packages/db/seeds/run-bw-seed.ts.
--
-- Why a DAG instead of linear levels:
--   Per the bodyweight addendum, progression is discrete, not linear.
--   "Replace +2.5 kg with a DAG of skill nodes per family. Jumps are
--   large; require over-completion before unlocking the next node."
--   Some nodes branch (push_up → decline_push_up | diamond_push_up),
--   some converge (jumping_muscle_up depends on pull_up which lives
--   in a different family), so prerequisites must be an array of
--   ids, not a single parent column.
--
-- Why the columns:
--   * external_load_capable — pull-up / dip / squat accept weighted
--     variants; planche / lever do not. Drives whether the prescriber
--     can suggest "+5 kg vest" instead of advancing the node.
--   * isometric_capable — lever / planche / flag are scored by hold
--     time, not reps. Drives the logger UI shape (seconds vs reps).
--   * default_tempo_seconds — eccentric component the prescription
--     defaults to. Slowing the eccentric is the primary way to keep
--     stimulus on a node the user has otherwise outgrown.
--   * tut_per_rep_seconds — denominator used by effectiveDifficulty
--     (apps/web/src/lib/planner/bw-difficulty.ts) when the user logs
--     a slower tempo than the catalog default.
--   * difficulty_anchor — coarse 1–100 cross-family ranking. NOT a
--     measured number; it's a deliberate starting calibration that
--     Phase 4 will iterate on. Source of truth lives in
--     packages/db/seeds/bw-movement-nodes.ts and changes only with a
--     code-comment rationale.
--
-- training_maxes extension:
--   `one_rm_kg` was kept NOT NULL through PR #88 (the no-TM path
--   skipped TM rows entirely instead of writing NULL). For Phase 1 we
--   need a TM row to anchor on *either* a weight or a bw_node_id, so
--   we drop the NOT NULL on `one_rm_kg`, add a nullable `bw_node_id`
--   pointing at the user's current node for this family, and protect
--   the table-level invariant with a CHECK that at least one of the
--   two is populated. Existing barbell-TM users keep their `one_rm_kg`
--   and stay untouched; their `bw_node_id` is NULL.
--
-- RLS:
--   movement_nodes is a global catalog — no RLS, no user_id; everyone
--   reads the same rows. bw_progress is per-user, so it gets the same
--   self-policy shape used everywhere else (auth.uid() = user_id).
--
-- Schema discipline (plan §6.8): every column here either drives an
-- engine decision (capability flags, anchor, tempo helpers) or is the
-- canonical primary-key shape (family, node_key). No JSONB
-- shovelware. clean_rep_history on bw_progress *is* JSONB on purpose:
-- it's an append-only audit trail of the user's qualifying reps at
-- the current node, not engine-observable state.

-- Catalog of bodyweight progression nodes. Global (no user_id).
CREATE TABLE IF NOT EXISTS public.movement_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family text NOT NULL,
  node_key text NOT NULL,
  display_name text NOT NULL,
  prerequisites uuid[] NOT NULL DEFAULT '{}',
  external_load_capable boolean NOT NULL DEFAULT false,
  isometric_capable boolean NOT NULL DEFAULT false,
  unilateral boolean NOT NULL DEFAULT false,
  default_tempo_seconds smallint NOT NULL DEFAULT 4,
  tut_per_rep_seconds smallint NOT NULL DEFAULT 4,
  difficulty_anchor smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS movement_nodes_family_key_uidx
  ON public.movement_nodes (family, node_key);

CREATE INDEX IF NOT EXISTS movement_nodes_family_idx
  ON public.movement_nodes (family);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'movement_nodes_family_chk'
  ) THEN
    ALTER TABLE public.movement_nodes
      ADD CONSTRAINT movement_nodes_family_chk
      CHECK (family IN (
        'push_h', 'push_v', 'pull_h', 'pull_v',
        'squat_unilateral', 'squat_bilateral', 'hinge',
        'core_anti_flexion', 'core_anti_rotation',
        'planche', 'lever_front', 'lever_back',
        'muscle_up', 'handstand', 'human_flag'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'movement_nodes_difficulty_chk'
  ) THEN
    ALTER TABLE public.movement_nodes
      ADD CONSTRAINT movement_nodes_difficulty_chk
      CHECK (difficulty_anchor BETWEEN 1 AND 100);
  END IF;
END $$;

-- Per-user × per-family current-node + accumulators.
CREATE TABLE IF NOT EXISTS public.bw_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family text NOT NULL,
  current_node_id uuid NOT NULL REFERENCES public.movement_nodes(id) ON DELETE RESTRICT,
  accumulated_tut_seconds integer NOT NULL DEFAULT 0,
  weeks_at_node smallint NOT NULL DEFAULT 0,
  clean_rep_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, family)
);

ALTER TABLE public.bw_progress ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bw_progress'
      AND policyname = 'bw_progress_self_read'
  ) THEN
    CREATE POLICY "bw_progress_self_read"
      ON public.bw_progress FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bw_progress'
      AND policyname = 'bw_progress_self_write'
  ) THEN
    CREATE POLICY "bw_progress_self_write"
      ON public.bw_progress FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- training_maxes: drop NOT NULL on one_rm_kg, add bw_node_id, add CHECK.
ALTER TABLE public.training_maxes
  ALTER COLUMN one_rm_kg DROP NOT NULL;

ALTER TABLE public.training_maxes
  ADD COLUMN IF NOT EXISTS bw_node_id uuid
    REFERENCES public.movement_nodes(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'training_maxes_weight_or_bw_chk'
  ) THEN
    ALTER TABLE public.training_maxes
      ADD CONSTRAINT training_maxes_weight_or_bw_chk
      CHECK (one_rm_kg IS NOT NULL OR bw_node_id IS NOT NULL);
  END IF;
END $$;
