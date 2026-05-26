-- 0055_user_meaningful_state.sql
--
-- Cross-device sync — persist user-meaningful state to Supabase so
-- Device B sees what Device A wrote. See `hybrid-sync-audit.md` §2a + §3.
--
-- Four surfaces today bottom out in localStorage and silently diverge
-- across devices:
--
-- 1. planned_sessions.notes — the plan-drawer "anything to remember
--    about this session" textarea. The placeholder text on the input
--    even says "(local to this device)". We add a real `notes` column
--    (mirrors the existing `sessions.notes` column on completed
--    sessions) and a server action so the drawer writes to Postgres
--    on every edit. localStorage is kept as a fast-paint fallback —
--    see the UI rewire in PlanRedesign.
--
-- 2. profiles.wizard_day_pref — the block wizard's per-archetype ×
--    per-session-count day-of-week pattern. Shape mirrors the
--    existing `hta-day-pref-v2` localStorage payload exactly:
--    `{ byArchetype: { [archetypeId]: { [sessionCount]:
--    { days: number[], twoADay: boolean } } } }`. JSONB so we don't
--    have to migrate the shape if it ever evolves.
--
-- 3. profiles.bw_nudge_hidden_until — the "log your bodyweight" nudge's
--    7-day snooze. timestamptz, nullable; NULL = never dismissed.
--
-- 4. profiles.bw_banner_dismissed_at — the bodyweight-only early-support
--    banner's permanent dismiss. timestamptz, nullable; NULL = banner
--    still visible (current behaviour).
--
-- 5. profiles.audit_last_read_at — backs the TopBar bell badge's
--    "mark all read". Previously the click only mutated React state,
--    so every page load showed the full unread count again. The
--    layout's audit-count query now filters
--    `engine_override_events.occurred_at > audit_last_read_at`.
--    Single timestamp on the profile (Option A) rather than a per-row
--    read flag (Option B) — accurate enough for a notification badge,
--    one column instead of a new table.
--
-- All columns are nullable / `IF NOT EXISTS`. Existing rows are
-- untouched so we don't break users on first deploy: NULL on
-- `wizard_day_pref` falls back to localStorage, NULL on either
-- dismissal column means "show it", NULL on `audit_last_read_at`
-- means "every existing audit row counts as unread" (matches current
-- behaviour). No backfill needed.

ALTER TABLE public.planned_sessions ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS wizard_day_pref jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bw_nudge_hidden_until timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bw_banner_dismissed_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS audit_last_read_at timestamptz;
