-- Retire all AI and MCP functionality, including stored provider credentials,
-- chat history, assistant memories, observability rows, and OAuth metadata.

DROP FUNCTION IF EXISTS public.byoai_store_key(uuid, text, text);
DROP FUNCTION IF EXISTS public.byoai_decrypt_key(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.byoai_clear_key(uuid, uuid);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_byoai_provider_check;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS byoai_provider,
  DROP COLUMN IF EXISTS byoai_key_vault_id,
  DROP COLUMN IF EXISTS byoai_model,
  DROP COLUMN IF EXISTS byoai_unlocked_at;

DROP TABLE IF EXISTS public.chat_messages;
DROP TABLE IF EXISTS public.chat_threads;
DROP TABLE IF EXISTS public.memories;
DROP TABLE IF EXISTS public.ai_call_logs;
DROP TABLE IF EXISTS public.byoai_key_events;
DROP TABLE IF EXISTS public.byoai_key_secrets;
DROP TABLE IF EXISTS public.mcp_consumed_codes;
DROP TABLE IF EXISTS public.mcp_tool_calls;
DROP TABLE IF EXISTS public.mcp_authorizations;
