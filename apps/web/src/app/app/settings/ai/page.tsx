import { redirect } from "next/navigation";

import { createClient, getAuthUser } from "@/lib/supabase/server";
import { AiSettingsPanel } from "@/components/settings/AiSettingsPanel";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "ai_opt_in_at, byoai_provider, byoai_key_vault_id, byoai_unlocked_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  const optedIn = profile?.ai_opt_in_at != null;
  const provider =
    (profile?.byoai_provider as "anthropic" | "openai" | "gemini" | null) ?? null;
  const keyConfigured = profile?.byoai_key_vault_id != null;

  return (
    <main className="min-h-screen px-6 py-8 max-w-2xl mx-auto space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">AI</h1>
        <p className="text-xs text-foreground/60">
          Bring your own provider key. AI features are off until you opt in
          and add a key.
        </p>
      </header>

      <AiSettingsPanel
        initialOptedIn={optedIn}
        initialProvider={provider}
        initialKeyConfigured={keyConfigured}
      />
    </main>
  );
}
