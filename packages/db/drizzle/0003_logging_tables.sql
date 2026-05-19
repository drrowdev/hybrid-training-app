-- 0003_logging_tables.sql
-- Phase 1 logging tables: sessions, set_logs, cardio_logs, wellness.
-- Owns the per-session 2-slider check-in (DC-P1) + Strava-pulled cardio
-- (DC-D4) + the logged work that feeds region_freshness (DC-C14).

-- ---------------------------------------------------------------------------
-- 1) Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "public"."set_kind" AS ENUM (
  'warmup',
  'main',
  'back_off',
  'accessory',
  'tendon'
);

-- ---------------------------------------------------------------------------
-- 2) sessions — the top-level training event
-- ---------------------------------------------------------------------------

CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "performed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "title" text,
  "duration_min" integer,
  "notes" text,
  -- DC-P1: 2-slider pre-session check-in (1–5).
  "fatigue" smallint CHECK (fatigue IS NULL OR (fatigue BETWEEN 1 AND 5)),
  "soreness" smallint CHECK (soreness IS NULL OR (soreness BETWEEN 1 AND 5)),
  -- DC-A2: session_load primitive (sRPE 0–10 × duration).
  "session_rpe" numeric(3, 1) CHECK (session_rpe IS NULL OR (session_rpe BETWEEN 0 AND 10)),
  "completed_at" timestamp with time zone,
  -- DC-A4: six-bucket coefficients sum to ~1.00. Engine fills this from
  -- the logged sets/cardio after the session is marked complete.
  "bucket_coeffs" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- DC-A5: region coefficients (independent, don't sum to 1.0).
  "region_coeffs" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "sessions_user_performed_idx"
  ON "sessions" ("user_id", "performed_at" DESC);

CREATE TRIGGER "sessions_set_updated_at"
  BEFORE UPDATE ON "sessions"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_select_self"
  ON "sessions" FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "sessions_insert_self"
  ON "sessions" FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "sessions_update_self"
  ON "sessions" FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "sessions_delete_self"
  ON "sessions" FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 3) set_logs — per-set strength entries
-- ---------------------------------------------------------------------------

CREATE TABLE "set_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
  "movement_id" uuid NOT NULL REFERENCES "movements"("id") ON DELETE RESTRICT,
  -- 0-based order within the session.
  "set_index" smallint NOT NULL,
  "weight_kg" numeric(6, 2),
  "reps" smallint,
  -- For time-under-tension sets, holds, isometrics (DC-J4 Baar protocol).
  "duration_sec" integer,
  -- For sled push / loaded carry distance work.
  "distance_m" integer,
  "rpe" numeric(3, 1) CHECK (rpe IS NULL OR (rpe BETWEEN 0 AND 10)),
  "set_kind" "set_kind" DEFAULT 'main' NOT NULL,
  "percent_of_tm" numeric(5, 2),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- A set must record SOMETHING: reps × weight, a duration hold, or distance.
  CONSTRAINT "set_logs_has_some_work"
    CHECK (reps IS NOT NULL OR duration_sec IS NOT NULL OR distance_m IS NOT NULL)
);

CREATE INDEX "set_logs_session_idx" ON "set_logs" ("session_id", "set_index");
CREATE INDEX "set_logs_movement_idx" ON "set_logs" ("movement_id");

ALTER TABLE "set_logs" ENABLE ROW LEVEL SECURITY;

-- RLS via the parent session — sub-select scoped to the caller's sessions.
CREATE POLICY "set_logs_select_self"
  ON "set_logs" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "sessions" s
    WHERE s.id = "set_logs".session_id AND s.user_id = (SELECT auth.uid())
  ));

CREATE POLICY "set_logs_insert_self"
  ON "set_logs" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM "sessions" s
    WHERE s.id = "set_logs".session_id AND s.user_id = (SELECT auth.uid())
  ));

CREATE POLICY "set_logs_update_self"
  ON "set_logs" FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM "sessions" s
    WHERE s.id = "set_logs".session_id AND s.user_id = (SELECT auth.uid())
  ));

CREATE POLICY "set_logs_delete_self"
  ON "set_logs" FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM "sessions" s
    WHERE s.id = "set_logs".session_id AND s.user_id = (SELECT auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- 4) cardio_logs — per-cardio-block entries on a session
-- ---------------------------------------------------------------------------

CREATE TABLE "cardio_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
  -- Nullable: ad-hoc Strava-pulled activity may not map to a catalog entry.
  "movement_id" uuid REFERENCES "movements"("id") ON DELETE SET NULL,
  "block_index" smallint DEFAULT 0 NOT NULL,
  "modality" text NOT NULL,
  "duration_sec" integer NOT NULL CHECK (duration_sec > 0),
  "distance_km" numeric(7, 3),
  "avg_hr_bpm" smallint CHECK (avg_hr_bpm IS NULL OR avg_hr_bpm BETWEEN 30 AND 240),
  "max_hr_bpm" smallint CHECK (max_hr_bpm IS NULL OR max_hr_bpm BETWEEN 30 AND 240),
  "avg_pace_sec_per_km" integer,
  "avg_power_w" smallint,
  "hr_zones" jsonb,
  -- Strava integration (Phase 1 promoted).
  "strava_activity_id" text,
  "external_source" text,
  "rpe" numeric(3, 1) CHECK (rpe IS NULL OR (rpe BETWEEN 0 AND 10)),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cardio_logs_strava_unique" UNIQUE (strava_activity_id)
);

CREATE INDEX "cardio_logs_session_idx" ON "cardio_logs" ("session_id", "block_index");
CREATE INDEX "cardio_logs_movement_idx" ON "cardio_logs" ("movement_id");

ALTER TABLE "cardio_logs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cardio_logs_select_self"
  ON "cardio_logs" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "sessions" s
    WHERE s.id = "cardio_logs".session_id AND s.user_id = (SELECT auth.uid())
  ));

CREATE POLICY "cardio_logs_insert_self"
  ON "cardio_logs" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM "sessions" s
    WHERE s.id = "cardio_logs".session_id AND s.user_id = (SELECT auth.uid())
  ));

CREATE POLICY "cardio_logs_update_self"
  ON "cardio_logs" FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM "sessions" s
    WHERE s.id = "cardio_logs".session_id AND s.user_id = (SELECT auth.uid())
  ));

CREATE POLICY "cardio_logs_delete_self"
  ON "cardio_logs" FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM "sessions" s
    WHERE s.id = "cardio_logs".session_id AND s.user_id = (SELECT auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- 5) wellness — weekly bodyweight + day-level notes
-- (Daily wellness check-in fields are backlogged per § U MVP scope.
--  For v1 this table only holds bodyweight per day.)
-- ---------------------------------------------------------------------------

CREATE TABLE "wellness" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "bodyweight_kg" numeric(6, 2),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wellness_user_date_unique" UNIQUE ("user_id", "date")
);

CREATE INDEX "wellness_user_date_idx"
  ON "wellness" ("user_id", "date" DESC);

CREATE TRIGGER "wellness_set_updated_at"
  BEFORE UPDATE ON "wellness"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE "wellness" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wellness_select_self"
  ON "wellness" FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "wellness_insert_self"
  ON "wellness" FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "wellness_update_self"
  ON "wellness" FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "wellness_delete_self"
  ON "wellness" FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 6) GRANTs (RLS still enforced — these just allow the role to attempt access)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON "sessions" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "set_logs" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "cardio_logs" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "wellness" TO authenticated;
