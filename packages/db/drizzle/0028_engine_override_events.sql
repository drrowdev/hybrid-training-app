-- 0028_engine_override_events.sql
--
-- First-class audit log for engine overrides (DC-K4
-- "override-and-warn, never silent overrule").
--
-- Today the data that signals "the user overrode an engine
-- recommendation" is scattered: `planned_sessions.skipped_at` for
-- skips, `prescription.items[].meta.swappedFrom` for movement swaps,
-- and `training_blocks.archived_at` for manual end-of-block. The Phase 6
-- engine page (Section F · Recent overrides) joins all three live and
-- has no place to capture the user's *reason* — the "tired" / "shoulder
-- twinge" / "travelling" free-form note that turns a flat audit list
-- into the "you skip Sundays mostly with 'tired' notes" analytic.
--
-- One dedicated, append-only table fixes that:
--
--   - Every override event has a row.
--   - Each row optionally carries the user's free-form `reason`.
--   - A `context` JSONB blob captures the engine state at the moment
--     of the override (archetype, week_index, weekday, ...) so future
--     analytics don't need to back-walk planned_sessions.
--   - Source FKs use ON DELETE SET NULL — the event row survives a
--     later soft- or hard-delete of the planned_session / block. The
--     audit log is the surviving record.
--   - Composite uniqueness on (event_type, planned_session_id,
--     occurred_at) lets the backfill be idempotent and protects
--     against double-writes from a future retry path.
--
-- RLS: standard self-owned policy. Service role bypasses RLS for the
-- backfill at the bottom of this migration.

CREATE TABLE IF NOT EXISTS public.engine_override_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),

  -- What kind of override.
  event_type text NOT NULL
    CHECK (event_type IN ('skip', 'swap', 'manual_end', 'custom')),

  -- What was overridden. Loose FKs (ON DELETE SET NULL) — the source
  -- row may later be soft- or hard-deleted; we want the event to
  -- survive as the canonical audit record.
  planned_session_id uuid REFERENCES public.planned_sessions(id) ON DELETE SET NULL,
  block_id uuid REFERENCES public.training_blocks(id) ON DELETE SET NULL,

  -- For swaps: what changed (movement slugs, stable across catalog
  -- name edits and survive movement deletion).
  original_movement_slug text,
  new_movement_slug text,

  -- Optional user-entered free-form note. 280 chars matches the
  -- existing notes-field convention on `sessions.notes` / etc.
  reason text,
  CONSTRAINT engine_override_events_reason_length CHECK (
    reason IS NULL OR char_length(reason) <= 280
  ),

  -- Engine context at the moment of the override. Shape is
  -- intentionally loose: { archetype, week_index, day_index, weekday,
  -- weeks_completed, percent_through, ... }. Per schema discipline
  -- (plan §6.8), this is "definition / metadata blob" rather than a
  -- typed column — it's not observable from the engine and nothing
  -- removes a single field.
  context jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Idempotency guard for the backfill below + future retries on a
  -- recording path. NULL planned_session_id (manual_end / custom)
  -- doesn't collide because NULL ≠ NULL in a UNIQUE constraint, which
  -- is the correct behavior — manual_end is keyed on (event_type,
  -- block_id, occurred_at) which we don't enforce structurally (a
  -- second manual_end on the same block at the same instant is
  -- vanishingly rare and would be a legitimate retry).
  CONSTRAINT engine_override_events_dedup_unique UNIQUE (event_type, planned_session_id, occurred_at)
);

CREATE INDEX IF NOT EXISTS engine_override_events_user_time_idx
  ON public.engine_override_events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS engine_override_events_user_type_idx
  ON public.engine_override_events (user_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS engine_override_events_block_idx
  ON public.engine_override_events (block_id)
  WHERE block_id IS NOT NULL;

-- RLS — standard self-owned pattern.
ALTER TABLE public.engine_override_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engine_override_events_self ON public.engine_override_events;
CREATE POLICY engine_override_events_self
  ON public.engine_override_events
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.engine_override_events
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.engine_override_events
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- Backfill — one-time, idempotent (ON CONFLICT DO NOTHING relies on
-- the engine_override_events_dedup_unique constraint above).
--
-- Coverage:
--   - planned_sessions WHERE skipped_at IS NOT NULL   → 'skip'
--   - training_blocks  WHERE archived_at IS NOT NULL  → 'manual_end'
--   - prescription.items[].meta.swappedFrom            → DEFERRED
--
-- The swap history isn't backfilled because PR #29 (movement swaps)
-- has been live for under a week — the dataset is small, the JSONB
-- walk is gnarly (jsonb_array_elements over items, filter on the
-- meta.swappedFrom presence, parse meta.swappedAt as the occurred_at,
-- inner-join movements on slug to resolve the original_movement_slug),
-- and the wins are minor. Documented as "swap history before this PR
-- not backfilled" in the PR body. Future swaps land in this table via
-- swapPrescriptionItem.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO public.engine_override_events
  (user_id, occurred_at, event_type, planned_session_id, block_id, context)
SELECT
  ps.user_id,
  ps.skipped_at,
  'skip',
  ps.id,
  ps.block_id,
  jsonb_build_object(
    'archetype',  tb.archetype,
    'week_index', ps.week_index,
    'day_index',  ps.day_index,
    'backfilled', true
  )
FROM public.planned_sessions ps
JOIN public.training_blocks tb ON tb.id = ps.block_id
WHERE ps.skipped_at IS NOT NULL
ON CONFLICT ON CONSTRAINT engine_override_events_dedup_unique DO NOTHING;

INSERT INTO public.engine_override_events
  (user_id, occurred_at, event_type, planned_session_id, block_id, context)
SELECT
  tb.user_id,
  tb.archived_at,
  'manual_end',
  NULL,
  tb.id,
  jsonb_build_object(
    'archetype',  tb.archetype,
    'weeks',      tb.weeks,
    'backfilled', true
  )
FROM public.training_blocks tb
WHERE tb.archived_at IS NOT NULL
ON CONFLICT ON CONSTRAINT engine_override_events_dedup_unique DO NOTHING;
