import { redirect } from "next/navigation";

import { createClient, getAuthUser } from "@/lib/supabase/server";
import { AiSettingsPanel } from "@/components/settings/AiSettingsPanel";
import { AiBenefits } from "@/components/settings/AiBenefits";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

/**
 * Compute whether the user has at least one active MCP authorization —
 * i.e. an `authorize` event with no subsequent `revoke` for the same
 * client_id. This drives the "Configured" badge on the MCP card.
 *
 * Lives in the page because it's a one-off projection; if/when MCP
 * status is needed elsewhere it should move into `lib/ai/access.ts`.
 */
function hasActiveMcpAuthorization(
  rows: Array<{ client_id: string; event: string; created_at: string }>,
): boolean {
  const latestByClient = new Map<string, string>();
  // rows arrive newest-first; the first occurrence per client_id wins.
  for (const r of rows) {
    if (!latestByClient.has(r.client_id)) {
      latestByClient.set(r.client_id, r.event);
    }
  }
  for (const event of latestByClient.values()) {
    if (event === "authorize") return true;
  }
  return false;
}

export default async function AiSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("byoai_provider, byoai_key_vault_id, byoai_unlocked_at, byoai_model")
    .eq("id", user.id)
    .maybeSingle();

  const provider =
    (profile?.byoai_provider as "anthropic" | "openai" | "gemini" | null) ?? null;
  const keyConfigured = profile?.byoai_key_vault_id != null;
  const model = (profile?.byoai_model as string | null) ?? null;

  const { data: mcpRows } = await supabase
    .from("mcp_authorizations")
    .select("client_id, event, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const mcpConfigured = hasActiveMcpAuthorization(
    (mcpRows ?? []) as Array<{
      client_id: string;
      event: string;
      created_at: string;
    }>,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/app/settings/integrations", label: "Integrations" }}
        title="AI"
      />

      <AiBenefits />

      <AiSettingsPanel
        initialProvider={provider}
        initialKeyConfigured={keyConfigured}
        initialMcpConfigured={mcpConfigured}
        initialModel={model}
      />
    </div>
  );
}
