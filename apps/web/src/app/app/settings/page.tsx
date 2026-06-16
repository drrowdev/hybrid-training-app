import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { SettingsHubCard } from "@/components/settings/SettingsHubCard";
import {
  PRESET_LABEL,
  resolveEquipment,
} from "@/lib/settings/equipment-presets";
import { todayYmd } from "@/lib/dates";
import { formatRelativeEventDate } from "@/lib/events/format";
import { ProfileNotifications } from "@/components/profile/ProfileNotifications";
import { QuickSearchRow } from "@/components/profile/QuickSearchRow";
import { markAuditRead } from "@/lib/profile/actions";
import { getNotificationsData } from "@/lib/profile/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsIcon } from "@/components/settings/SettingsIcons";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, timezone",
    )
    .eq("id", user.id)
    .maybeSingle();

  const equipment = resolveEquipment(profile ?? null);
  const isBodyweightOnly = equipment.preset === "bodyweight_only";

  // BW progression card follows the active equipment preset only.
  // Latent bw_progress rows from a past BW phase stay in the DB, but
  // the card hides when the user is back on loaded kit — they're
  // currently training the loaded path, not the skill tree.

  const today = todayYmd(profile?.timezone ?? "UTC");

  // Latest bodyweight log — drives the Bodyweight hub card badge.
  const { data: latestWeight } = await supabase
    .from("wellness")
    .select("date, bodyweight_kg")
    .not("bodyweight_kg", "is", null)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const bwBadge = latestWeight?.bodyweight_kg
    ? `${Number(latestWeight.bodyweight_kg).toFixed(1)} kg · ${formatRelativeEventDate(latestWeight.date, today)}`
    : "Not logged yet";

  const [
    { count: activeLim },
    { count: upcomingEvents },
    { count: tmCount },
  ] = await Promise.all([
    supabase
      .from("limitations")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null),
    supabase
      .from("priority_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("event_date", today),
    supabase
      .from("training_maxes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  const activeLimCount = activeLim ?? 0;
  const upcomingEventsCount = upcomingEvents ?? 0;
  const trainingMaxesSet = tmCount ?? 0;

  const { recentAudit, unreadAuditCount } = await getNotificationsData(
    supabase,
    user.id,
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      {/* Mobile-only: Notifications + Quick search. Hidden on desktop
          where the top-bar already surfaces both. The MORE tab routes
          here, so mobile users need parity with the desktop bell + search. */}
      <div className="cp-mobile-only" data-testid="settings-mobile-notifications">
        <div style={{ display: "grid", gap: 12 }}>
          <ProfileNotifications
            recentAudit={recentAudit}
            unreadCount={unreadAuditCount}
            markAuditReadAction={markAuditRead}
          />
          <QuickSearchRow />
        </div>
      </div>

      <div className="settings-hub-grid">
        <SettingsHubCard
          href="/app/settings/profile"
          icon={<SettingsIcon name="profile" />}
          title="Training profile"
          description="Name, experience, phase, training frequency."
          testId="settings-hub-profile"
        />
        <SettingsHubCard
          href="/app/settings/bodyweight"
          icon={<SettingsIcon name="bodyweight" />}
          title="Bodyweight"
          description="Log weight and review history."
          badge={bwBadge}
          testId="settings-hub-bodyweight"
        />
        <SettingsHubCard
          href="/app/settings/equipment"
          icon={<SettingsIcon name="equipment" />}
          title="Equipment"
          description="Bars, plates, accessories."
          badge={PRESET_LABEL[equipment.preset]}
          testId="settings-hub-equipment"
        />
        <SettingsHubCard
          href="/app/settings/training-maxes"
          icon={<SettingsIcon name="training-maxes" />}
          title="1-rep maxes"
          description="Your 1RM per main lift."
          badge={`${trainingMaxesSet} lift${trainingMaxesSet === 1 ? "" : "s"} set`}
          testId="settings-hub-training-maxes"
        />
        {isBodyweightOnly && (
          <SettingsHubCard
            href="/app/settings/bodyweight-progression"
            icon={<SettingsIcon name="bw-progression" />}
            title="Bodyweight progression"
            description="Per-family progression nodes."
            testId="settings-hub-bw-progression"
          />
        )}
        <SettingsHubCard
          href="/app/recovery/injuries"
          icon={<SettingsIcon name="limitations" />}
          title="Limitations"
          description="Active limitations + history."
          badge={`${activeLimCount} active`}
          testId="settings-hub-injuries"
        />
        <SettingsHubCard
          href="/app/settings/events"
          icon={<SettingsIcon name="events" />}
          title="Events"
          description="Races, comps, taper plans."
          badge={`${upcomingEventsCount} upcoming`}
          testId="settings-hub-events"
        />
        <SettingsHubCard
          href="/app/settings/training"
          icon={<SettingsIcon name="preferences" />}
          title="Training preferences"
          description="Warmups, cardio source and modalities."
          testId="settings-hub-training"
        />
        <SettingsHubCard
          href="/app/settings/integrations"
          icon={<SettingsIcon name="integrations" />}
          title="Integrations"
          description="Strava and AI providers."
          testId="settings-hub-integrations"
        />
        <SettingsHubCard
          href="/app/settings/hr-zones"
          icon={<SettingsIcon name="hr-zones" />}
          title="Heart-rate zones"
          description="Z1–Z5 thresholds for cardio intensity."
          testId="settings-hub-hr-zones"
        />
      </div>
    </div>
  );
}
