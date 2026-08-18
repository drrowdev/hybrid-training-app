/**
 * /app/settings/training — training-flow preferences. Currently hosts
 * the warmup-ladder editor (H1: "Warmups"); future training-related
 * settings (rest-time defaults, RPE prompts, etc.) will land alongside
 * it here so the main settings page doesn't sprawl. The route stays at
 * /app/settings/training for stable deep-links.
 */
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { WarmupSettings } from "@/components/settings/WarmupSettings";
import { CardioSourceSettings } from "@/components/settings/CardioSourceSettings";
import { CardioModalitySettings } from "@/components/settings/CardioModalitySettings";
import { SeasonPlanningToggle } from "@/components/settings/SeasonPlanningToggle";
import { resolveWarmupPreference } from "@/lib/planner/warmups";
import { programsWithOwnWarmupRamp } from "@/lib/planner/program-warmup-scheme";
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

  // Raw, not resolved: `null` means "never chose", which the editor surfaces as
  // "Follow the program" and which lets each program keep its own ramp.
  const preference = resolveWarmupPreference(profile?.warmup_scheme);
  const scheme = preference.mode === "user" ? preference.scheme : null;
  const programsWithOwnRamp = programsWithOwnWarmupRamp().map((p) => ({
    id: p.id,
    name: p.name,
  }));
  const cardioSource =
    (profile?.preferred_cardio_source as "internal" | "external" | undefined) ??
    "internal";
  const cardioSourceName = profile?.preferred_cardio_source_name ?? "";
  const cardioModalities = sanitizePreferredModalities(
    profile?.preferred_cardio_modalities as readonly unknown[] | null,
  );

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
          programsWithOwnRamp={programsWithOwnRamp}
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
        <h2 style={{ fontSize: 18, margin: 0 }}>Planning</h2>
        <SeasonPlanningToggle initial={Boolean(profile?.season_planning_enabled)} />
      </section>
    </main>
  );
}
