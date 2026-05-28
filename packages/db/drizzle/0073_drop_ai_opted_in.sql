-- 0073_drop_ai_opted_in.sql
--
-- Drop the legacy master AI opt-in column. With the "Enable AI features"
-- toggle removed from Settings → AI, opt-in is now derived state:
--   * BYOAI / in-app chat:    a configured `byoai_key_vault_id`
--   * MCP path (ADR 0003):    a live `mcp_authorizations` row
--
-- No backfill — both signals above already exist and replace the column.
-- RLS unchanged; this is a pure column drop.

ALTER TABLE public.profiles DROP COLUMN IF EXISTS ai_opt_in_at;
