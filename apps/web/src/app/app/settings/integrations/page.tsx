import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { SettingsHubCard } from "@/components/settings/SettingsHubCard";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * Integrations sub-hub — collects all external-account links under one
 * settings tile. Mirrors the top-level settings hub pattern (a grid of
 * `SettingsHubCard`s) so the visual + interaction language is the same.
 *
 * The leaves (`/app/settings/strava`, `/app/settings/ai`) are unchanged
 * so deep links, command-K entries, and existing tests keep working.
 *
 * Badge states surface live connection status:
 *   - Strava — Connected / Not connected, from `strava_connections`.
 *   - AI providers — Configured / Not set, from `profiles.byoai_key_vault_id`
 *     (same field the in-app AI access gate uses; see `lib/ai/access.ts`).
 */
export default async function IntegrationsSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const [{ data: stravaConn }, { data: profile }] = await Promise.all([
    supabase
      .from("strava_connections")
      .select("athlete_id")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("byoai_key_vault_id")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const stravaConnected = stravaConn?.athlete_id != null;
  const aiConfigured = profile?.byoai_key_vault_id != null;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Integrations"
        subtitle="Connect external services and AI providers."
      />

      <div className="settings-hub-grid">
        <SettingsHubCard
          href="/app/settings/strava"
          icon="🏃"
          title="Strava"
          description="Import cardio activities so region freshness reflects all your training."
          badge={stravaConnected ? "Connected" : "Not connected"}
          testId="settings-hub-integrations-strava"
        />
        <SettingsHubCard
          href="/app/settings/ai"
          icon="🤖"
          title="AI providers"
          description="Bring-your-own key for Claude / GPT / Gemini."
          badge={aiConfigured ? "Configured" : "Not set"}
          testId="settings-hub-integrations-ai"
        />
      </div>
    </div>
  );
}
