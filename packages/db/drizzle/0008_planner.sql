-- 0008_planner.sql
-- Forward planning: blocks + planned sessions.
--
-- A block is a 3-6 week mesocycle (archetype-driven). Planned sessions
-- live one row per (block × week × day) and carry their prescription as
-- a JSONB array. When the user logs a real session, we link it back via
-- completed_session_id so /app/plan can show completion state per day.

CREATE TYPE "training_block_status" AS ENUM ('active', 'completed', 'archived');

CREATE TABLE "training_blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "archetype" text NOT NULL,
  "started_on" date NOT NULL,
  "weeks" smallint NOT NULL CHECK ("weeks" >= 1 AND "weeks" <= 12),
  "status" "training_block_status" NOT NULL DEFAULT 'active',
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- A user can have multiple active blocks in theory but the UI assumes one.
-- Allow but discourage via app logic.
CREATE INDEX "training_blocks_user_idx" ON "training_blocks" ("user_id");
CREATE INDEX "training_blocks_user_status_idx" ON "training_blocks" ("user_id", "status");

ALTER TABLE "training_blocks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "training_blocks_select_self"
  ON "training_blocks" FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "training_blocks_insert_self"
  ON "training_blocks" FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "training_blocks_update_self"
  ON "training_blocks" FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "training_blocks_delete_self"
  ON "training_blocks" FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION "training_blocks_touch_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "training_blocks_touch_updated_at"
  BEFORE UPDATE ON "training_blocks"
  FOR EACH ROW EXECUTE FUNCTION "training_blocks_touch_updated_at"();

-- ────────────────────────────────────────────────────────────

CREATE TABLE "planned_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "block_id" uuid NOT NULL REFERENCES "training_blocks"("id") ON DELETE CASCADE,
  -- denormalised for RLS / fast user queries.
  "user_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  -- 0-based week within the block.
  "week_index" smallint NOT NULL CHECK ("week_index" >= 0),
  -- 0=Mon ... 6=Sun.
  "day_index" smallint NOT NULL CHECK ("day_index" BETWEEN 0 AND 6),
  "title" text NOT NULL,
  -- The session "role" e.g. heavy_squat / moderate_bench / deload_press —
  -- lets the engine reason about substitutions without parsing prescription.
  "role" text NOT NULL,
  -- jsonb shape: { items: [{ movementId, sets, reps, percentTm?, intensityLabel?, kind, notes? }, ...] }
  "prescription" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- When the user logs a real session for this slot, link it.
  "completed_session_id" uuid REFERENCES "sessions"("id") ON DELETE SET NULL,
  "skipped_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE ("block_id", "week_index", "day_index")
);

CREATE INDEX "planned_sessions_user_idx" ON "planned_sessions" ("user_id");
CREATE INDEX "planned_sessions_block_idx" ON "planned_sessions" ("block_id");

ALTER TABLE "planned_sessions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planned_sessions_select_self"
  ON "planned_sessions" FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "planned_sessions_insert_self"
  ON "planned_sessions" FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "planned_sessions_update_self"
  ON "planned_sessions" FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "planned_sessions_delete_self"
  ON "planned_sessions" FOR DELETE
  USING ((SELECT auth.uid()) = user_id);
