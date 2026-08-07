import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { SettingsHubCard } from "@/components/settings/SettingsHubCard";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function IntegrationsSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: stravaConn } = await supabase
    .from("strava_connections")
    .select("athlete_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const stravaConnected = stravaConn?.athlete_id != null;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Integrations"
        subtitle="Connect external training services."
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
      </div>
    </div>
  );
}
