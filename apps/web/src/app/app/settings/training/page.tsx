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
import { resolveWarmupScheme } from "@/lib/planner/warmups";

export const dynamic = "force-dynamic";

export default async function TrainingSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("warmup_scheme, preferred_cardio_source, preferred_cardio_source_name")
    .eq("id", user.id)
    .maybeSingle();

  const scheme = resolveWarmupScheme(profile?.warmup_scheme);
  const cardioSource =
    (profile?.preferred_cardio_source as "internal" | "external" | undefined) ??
    "internal";
  const cardioSourceName = profile?.preferred_cardio_source_name ?? "";

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
      <header>
        <h1 style={{ fontSize: 24, margin: 0, letterSpacing: "-0.01em" }}>
          Training
        </h1>
      </header>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Warmup ladder</h2>
        <WarmupSettings initial={scheme} />
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Cardio source</h2>
        <CardioSourceSettings
          initial={{ source: cardioSource, name: cardioSourceName }}
        />
      </section>
    </main>
  );
}
