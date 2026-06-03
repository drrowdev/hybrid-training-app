-- 0084_profiles_superset_accessories.sql
--
-- ADR 0026 — antagonist-superset accessories opt-in.
--
-- A user-level execution-style preference: when ON, the planner pairs opposing
-- accessory movements (e.g. biceps curl + triceps pushdown) into antagonist
-- supersets so the lifter rests once per round instead of twice, shortening the
-- session at preserved volume. Antagonist (not same-muscle) pairing preserves
-- agonist output (Robbins 2010; Weakley 2020); the honest trade-off is a modest
-- rise in acute perceived effort. Pairing is a POST-SELECTION annotation layer:
-- it never changes which accessories are prescribed, only how they are grouped
-- and the displayed session time.
--
-- DEFAULT false reproduces today's prescription AND duration byte-for-byte, so
-- every existing row is unchanged and the pairing pass is never invoked. An
-- execution style (applies to all blocks), like haptics / timer-sound — not a
-- programming choice, so it lives on profiles rather than per training_block.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS superset_accessories boolean NOT NULL DEFAULT false;
