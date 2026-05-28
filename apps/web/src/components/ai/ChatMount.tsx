/**
 * ChatMount — server component that gates the chat surface.
 *
 * Renders nothing when `hasAiAccess` is false; otherwise mounts the
 * `<ChatRoot />` client island (FAB + panel). The `/app/layout.tsx`
 * embeds this component so every authed page gets the chat surface
 * for free.
 */
import { hasAiAccess } from "@/lib/ai/access";
import { createClient, getAuthUser } from "@/lib/supabase/server";

import { ChatRoot } from "./ChatRoot";

export async function ChatMount(): Promise<React.ReactElement | null> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "ai_opt_in_at, byoai_provider, byoai_key_vault_id, byoai_unlocked_at",
    )
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return null;
  const access = hasAiAccess({
    ai_opt_in_at: profile.ai_opt_in_at,
    byoai_provider: profile.byoai_provider,
    byoai_key_vault_id: profile.byoai_key_vault_id,
    byoai_unlocked_at: profile.byoai_unlocked_at,
  });
  if (!access) return null;
  return <ChatRoot />;
}
