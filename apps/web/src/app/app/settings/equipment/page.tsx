/**
 * /app/settings/equipment — bar weights + plate-inventory editor.
 *
 * The plate breakdown rendered by `<MovementFocusView>` reads from
 * the same `profiles` columns this page writes (`barbell_kg`,
 * `trap_bar_kg`, `plate_inventory_kg`). All values stored canonically
 * in kg; lb display flips at the render boundary.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EquipmentSettings } from "@/components/settings/EquipmentSettings";

export const dynamic = "force-dynamic";

type PlateRow = { weight_kg: number; pair_count: number };

const DEFAULT_INVENTORY: PlateRow[] = [
  { weight_kg: 25, pair_count: 2 },
  { weight_kg: 20, pair_count: 2 },
  { weight_kg: 15, pair_count: 1 },
  { weight_kg: 10, pair_count: 2 },
  { weight_kg: 5, pair_count: 2 },
  { weight_kg: 2.5, pair_count: 2 },
  { weight_kg: 1.25, pair_count: 2 },
];

export default async function EquipmentSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("units, barbell_kg, trap_bar_kg, plate_inventory_kg")
    .eq("id", user.id)
    .maybeSingle();

  const units = (profile?.units === "imperial" ? "imperial" : "metric") as
    | "metric"
    | "imperial";
  const barbellKg = Number(profile?.barbell_kg ?? 20);
  const trapBarKg = Number(profile?.trap_bar_kg ?? 25);
  const inventoryRaw = Array.isArray(profile?.plate_inventory_kg)
    ? (profile?.plate_inventory_kg as PlateRow[])
    : DEFAULT_INVENTORY;
  const inventory = inventoryRaw
    .map((p) => ({ weight_kg: Number(p.weight_kg), pair_count: Number(p.pair_count) }))
    .filter((p) => Number.isFinite(p.weight_kg) && p.weight_kg > 0 && p.pair_count > 0);

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
        <Link
          href="/app/settings"
          style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
        >
          ← settings
        </Link>
        <h1 style={{ fontSize: 24, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          Equipment
        </h1>
      </header>

      <EquipmentSettings
        initial={{ barbellKg, trapBarKg, plateInventoryKg: inventory }}
        units={units}
      />
    </main>
  );
}
