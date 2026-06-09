-- 0096_session_custom_accessory_order.sql
--
-- Per-session user override of the accessory card ORDER (drag/tap reorder in
-- the active workout). A JSONB array of accessory movement ids in the user's
-- chosen sequence; the session UI applies it over the smart equipment-station
-- default. Display-only — set logging still matches by prescription item index.
-- NULL = use the default order. Idempotent.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS custom_accessory_order jsonb;
