-- 0005_region_state.sql
-- Per-user × per-region rolling load state (v2 §10 + DC-C14 freshness key).
-- One row per user per region. Materialised on session completion by
-- recomputeRegionState() in apps/web/src/lib/engine/region-ledger.ts.
--
-- The math:
--   For each completed session, compute total session_load = duration × sRPE
--   (or a fall-back from set count). Allocate to regions based on the
--   movements logged: primary_region weight 1.0, secondary_regions 0.5.
--   Aggregate daily, then walk the calendar applying EWMA_7 (ATL) and
--   EWMA_28 (CTL) per region. Baseline tolerance defaults to CTL × 1.0.

CREATE TABLE "region_state" (
  "user_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "region" "region" NOT NULL,
  -- DC-C1: 7-day EWMA of regional load
  "atl" numeric(10, 4) DEFAULT 0 NOT NULL,
  -- DC-C1: 28-day EWMA of regional load
  "ctl" numeric(10, 4) DEFAULT 0 NOT NULL,
  -- DC-C9 cold-start: CTL × tolerance constant (default 1.0)
  "baseline_tolerance" numeric(10, 4) DEFAULT 0 NOT NULL,
  "last_load_date" date,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "region")
);

CREATE INDEX "region_state_user_idx" ON "region_state" ("user_id");

ALTER TABLE "region_state" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "region_state_select_self"
  ON "region_state" FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

-- Writes go through the server-side admin client (during session-complete
-- recompute) — but expose self-write too in case the user can trigger a
-- manual recompute via a server action.
CREATE POLICY "region_state_upsert_self"
  ON "region_state" FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "region_state_update_self"
  ON "region_state" FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "region_state_delete_self"
  ON "region_state" FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON "region_state" TO authenticated;
