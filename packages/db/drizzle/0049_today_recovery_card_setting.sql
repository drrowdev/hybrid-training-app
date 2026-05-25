-- 0049_today_recovery_card_setting.sql
--
-- Today-page daily recovery check-in toggle.
--
-- Adds `profiles.show_today_recovery_card`. When TRUE (default) the
-- Today page renders the inline 1/3/5/7/9 fatigue + soreness card
-- (`HowRecoveredCard`); when FALSE the card is hidden entirely. The
-- column gates UI only — the underlying `wellness` table and the
-- `recordDailyCheckIn` server action are unchanged so existing data
-- and analytics paths keep working.
--
-- Default TRUE preserves the current behaviour for every existing user
-- — no regression on upgrade.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS show_today_recovery_card boolean NOT NULL DEFAULT true;
