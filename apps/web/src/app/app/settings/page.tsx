import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SettingsHubCard } from "@/components/settings/SettingsHubCard";
import {
  PRESET_LABEL,
  resolveEquipment,
} from "@/lib/settings/equipment-presets";
import { todayYmd } from "@/lib/dates";
import { formatRelativeEventDate } from "@/lib/events/format";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
    { count: trashedBlockCount },
    { count: trashedSessionCount },
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
    supabase
      .from("training_blocks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("deleted_at", "is", null),
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("deleted_at", "is", null),
  ]);
  const trashCount = (trashedBlockCount ?? 0) + (trashedSessionCount ?? 0);

  const activeLimCount = activeLim ?? 0;
  const upcomingEventsCount = upcomingEvents ?? 0;
  const trainingMaxesSet = tmCount ?? 0;

  return (
    <main className="min-h-screen px-6 py-8 max-w-2xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </header>

      <div className="settings-hub-grid">
        <SettingsHubCard
          href="/app/settings/profile"
          icon="🧭"
          title="Training profile"
          description="Name, experience, phase, training frequency."
          testId="settings-hub-profile"
        />
        <SettingsHubCard
          href="/app/settings/bodyweight"
          icon="⚖️"
          title="Bodyweight"
          description="Log weight and review history."
          badge={bwBadge}
          testId="settings-hub-bodyweight"
        />
        <SettingsHubCard
          href="/app/settings/equipment"
          icon="🏋️"
          title="Equipment"
          description="Bars, plates, accessories."
          badge={PRESET_LABEL[equipment.preset]}
          testId="settings-hub-equipment"
        />
        <SettingsHubCard
          href="/app/settings/training-maxes"
          icon="💪"
          title="Training maxes"
          description="Per-lift TMs the planner uses."
          badge={`${trainingMaxesSet} lift${trainingMaxesSet === 1 ? "" : "s"} set`}
          testId="settings-hub-training-maxes"
        />
        {isBodyweightOnly && (
          <SettingsHubCard
            href="/app/settings/bodyweight-progression"
            icon="🌳"
            title="Bodyweight progression"
            description="Per-family progression nodes."
            testId="settings-hub-bw-progression"
          />
        )}
        <SettingsHubCard
          href="/app/recovery/injuries"
          icon="🩹"
          title="Injuries"
          description="Active limitations + history."
          badge={`${activeLimCount} active`}
          testId="settings-hub-injuries"
        />
        <SettingsHubCard
          href="/app/settings/events"
          icon="🏁"
          title="Events"
          description="Races, comps, taper plans."
          badge={`${upcomingEventsCount} upcoming`}
          testId="settings-hub-events"
        />
        <SettingsHubCard
          href="/app/settings/preferences"
          icon="⚙️"
          title="Preferences"
          description="Time, feedback, warmups, connections."
          testId="settings-hub-preferences"
        />
        <SettingsHubCard
          href="/app/settings/account"
          icon="🗄️"
          title="Account & data"
          description="Trash, export, delete."
          badge={`${trashCount} in trash`}
          testId="settings-hub-account"
        />
      </div>
    </main>
  );
}
