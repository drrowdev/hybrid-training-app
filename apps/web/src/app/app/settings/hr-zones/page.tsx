/**
 * /app/settings/hr-zones — heart-rate zone settings.
 *
 * Three methods supported: %Max HR, %HRR (Karvonen), %LTHR (Friel,
 * 5-zone simplified). Raw inputs + computed bands persist on
 * `profiles.intake` (JSONB); downstream readers prefer the cached
 * `intake.hrZones`. See `lib/stats/hr-zones.ts` for the formulas
 * and `lib/settings/hr-zones-actions.ts` for the writer.
 */
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { HrZonesSettings } from "@/components/settings/HrZonesSettings";
import { readIntake } from "@/lib/profile/intake";
import type { HrMethod } from "@/lib/stats/hr-zones";

export const dynamic = "force-dynamic";

export default async function HrZonesSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("intake")
    .eq("id", user.id)
    .maybeSingle();
  const intake = readIntake(profile?.intake ?? null);

  // `intake.age` is an optional self-report — used only for the
  // "estimate from age" hint + the reset button. The wider app doesn't
  // require it.
  const age = typeof (intake as Record<string, unknown>).age === "number"
    ? ((intake as Record<string, unknown>).age as number)
    : null;

  const initial = {
    hrMethod: (intake.hrMethod ?? "max") as HrMethod,
    hrMax: intake.hrMax ?? null,
    hrResting: intake.hrResting ?? null,
    hrLthr: intake.hrLthr ?? null,
  };

  return (
    <main
      style={{
        display: "grid",
        gap: 16,
        maxWidth: 560,
        margin: "0 auto",
        padding: "24px 16px",
      }}
    >
      <header>
        <h1 style={{ fontSize: 24, margin: 0, letterSpacing: "-0.01em" }}>HR zones</h1>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 13,
            color: "var(--cp-text-muted)",
            lineHeight: 1.5,
          }}
        >
          Configure how Z1–Z5 are derived for the Time-in-HR-zones card and
          for any session classifier that uses HR. Changes auto-save.
        </p>
      </header>

      <HrZonesSettings initial={initial} age={age} />
    </main>
  );
}

