/**
 * /app/settings/equipment — rich equipment-inventory editor (bars,
 * plates, dumbbells, kettlebells, machines, cardio, accessories).
 *
 * Reads `profiles.equipment` (jsonb, added in migration 0040) when
 * present and falls back to the legacy `barbell_kg` / `trap_bar_kg`
 * / `plate_inventory_kg` columns via `resolveEquipment` — see
 * `@/lib/settings/equipment-presets`. All weights stored canonically
 * in kg; lb display flips at the render boundary.
 */
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { EquipmentEditor } from "@/components/settings/EquipmentEditor";
import { resolveEquipment } from "@/lib/settings/equipment-presets";

export const dynamic = "force-dynamic";

export default async function EquipmentSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("units, barbell_kg, trap_bar_kg, plate_inventory_kg, equipment")
    .eq("id", user.id)
    .maybeSingle();

  const units = (profile?.units === "imperial" ? "imperial" : "metric") as
    | "metric"
    | "imperial";
  const equipment = resolveEquipment(profile ?? null);

  return (
    <main
      style={{
        display: "grid",
        gap: 16,
        maxWidth: 720,
        margin: "0 auto",
        padding: "24px 16px",
      }}
    >
      <header>
        <h1 style={{ fontSize: 24, margin: 0, letterSpacing: "-0.01em" }}>
          Equipment
        </h1>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 13,
            color: "var(--cp-text-muted)",
            lineHeight: 1.5,
          }}
        >
          Tell us what you have to train with. We use this to pick the right
          plate breakdown and (later) to filter accessory suggestions to gear
          you actually own.
        </p>
      </header>

      <EquipmentEditor initial={equipment} units={units} />
    </main>
  );
}
