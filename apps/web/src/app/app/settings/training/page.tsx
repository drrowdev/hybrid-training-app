/**
 * /app/settings/training — training-flow preferences. Currently hosts
 * the warmup-ladder editor (H1: "Warmups"); future training-related
 * settings (rest-time defaults, RPE prompts, etc.) will land alongside
 * it here so the main settings page doesn't sprawl. The route stays at
 * /app/settings/training for stable deep-links.
 */
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getActiveBlock } from "@/lib/planner/queries";
import { WarmupSettings } from "@/components/settings/WarmupSettings";
import { CardioSourceSettings } from "@/components/settings/CardioSourceSettings";
import { CardioModalitySettings } from "@/components/settings/CardioModalitySettings";
import { SeasonPlanningToggle } from "@/components/settings/SeasonPlanningToggle";
import { RestTimerToggle } from "@/components/settings/RestTimerToggle";
import { readRestTimerEnabled } from "@/lib/sessions/rest-timer-preference";
import { resolveWarmupPreference } from "@/lib/planner/warmups";
import { activeProgramWithOwnWarmupRamp } from "@/lib/planner/program-warmup-scheme";
import { sanitizePreferredModalities } from "@/lib/planner/preferred-cardio-modality";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function TrainingSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("warmup_scheme, preferred_cardio_source, preferred_cardio_source_name, preferred_cardio_modalities, season_planning_enabled")
    .eq("id", user.id)
    .maybeSingle();

  // Raw, not resolved: `null` means "never chose", which lets a program apply
  // its own ramp. Which option represents that depends on what is RUNNING, so
  // read the active block's program — not `program_instances.status`, which is
  // never cleared when a block ends, completes or is deleted and would have
  // this screen claim a program is active long after it finished.
  const preference = resolveWarmupPreference(profile?.warmup_scheme);
  const scheme = preference.mode === "user" ? preference.scheme : null;
  const activeBlock = await getActiveBlock();
  const activeProgramWithOwnRamp = activeProgramWithOwnWarmupRamp(
    activeBlock?.programId,
  );
  const cardioSource =
    (profile?.preferred_cardio_source as "internal" | "external" | undefined) ??
    "internal";
  const cardioSourceName = profile?.preferred_cardio_source_name ?? "";
  const cardioModalities = sanitizePreferredModalities(
    profile?.preferred_cardio_modalities as readonly unknown[] | null,
  );
  // Read separately, NOT added to the select above: until migration 0133 is
  // applied the column does not exist, and PostgREST would fail the whole
  // request — taking warmup and cardio settings down with it.
  const restTimerEnabled = await readRestTimerEnabled(user.id);

  return (
    <main
      style={{
        display: "grid",
        gap: 24,
        maxWidth: 560,
        margin: "0 auto",
        padding: "24px 16px",
      }}
    >
      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Training"
      />

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Warmup ladder</h2>
        <WarmupSettings
          initial={scheme}
          activeProgramWithOwnRamp={activeProgramWithOwnRamp}
        />
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Cardio source</h2>
        <CardioSourceSettings
          initial={{ source: cardioSource, name: cardioSourceName }}
        />
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Cardio types</h2>
        <CardioModalitySettings initial={cardioModalities} />
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Logging</h2>
        <RestTimerToggle initial={restTimerEnabled} />
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Planning</h2>
        <SeasonPlanningToggle initial={Boolean(profile?.season_planning_enabled)} />
      </section>
    </main>
  );
}
