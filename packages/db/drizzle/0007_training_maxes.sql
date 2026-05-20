-- 0007_training_maxes.sql
-- Per-user training maxes (TM) for prescription anchoring.
--
-- A training max is a deliberate underestimate of 1RM (commonly ~0.9 × est1RM
-- for novices, ~0.85 for advanced) used as the reference number for relative
-- intensity prescription (e.g. "85% of TM for 3×3"). One row per user per
-- movement; user-managed via Settings, consumed by the Log UI (% of TM line)
-- and by the prescription engine.
--
-- DC-P1: TM anchors percentage prescription. DC-P2: TM stays stable across
-- a block, then revisits at deload/transition.

CREATE TABLE "training_maxes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "movement_id" uuid NOT NULL REFERENCES "movements"("id") ON DELETE CASCADE,
  "tm_kg" numeric(6, 2) NOT NULL CHECK ("tm_kg" > 0),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE ("user_id", "movement_id")
);

CREATE INDEX "training_maxes_user_idx" ON "training_maxes" ("user_id");

ALTER TABLE "training_maxes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "training_maxes_select_self"
  ON "training_maxes" FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "training_maxes_insert_self"
  ON "training_maxes" FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "training_maxes_update_self"
  ON "training_maxes" FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "training_maxes_delete_self"
  ON "training_maxes" FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- Touch updated_at on UPDATE.
CREATE OR REPLACE FUNCTION "training_maxes_touch_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "training_maxes_touch_updated_at"
  BEFORE UPDATE ON "training_maxes"
  FOR EACH ROW EXECUTE FUNCTION "training_maxes_touch_updated_at"();
