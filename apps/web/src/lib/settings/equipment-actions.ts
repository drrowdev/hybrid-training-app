"use server";

/**
 * Equipment-settings server actions: bar weights + plate inventory.
 *
 * Kept in its own file (rather than appended to the catch-all
 * `lib/settings/actions.ts`) so the equipment editor can iterate
 * without dragging the rest of settings through `"use server"`
 * recompiles. Same RLS contract — `id = auth.uid()` updates only.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const PLATE_ITEM = z.object({
  weight_kg: z.coerce.number().positive().max(100),
  pair_count: z.coerce.number().int().min(0).max(20),
});

const EQUIPMENT_SCHEMA = z.object({
  barbellKg: z.coerce.number().min(1).max(60),
  trapBarKg: z.coerce.number().min(1).max(60),
  plateInventory: z.array(PLATE_ITEM).max(20),
});

/**
 * Persist the user's bar masses + plate inventory.
 *
 * FormData layout (the matching `<EquipmentSettings>` component
 * stringifies the inventory before submit so we don't have to walk
 * indexed keys here):
 *   barbellKg          = "20"
 *   trapBarKg          = "25"
 *   plateInventoryJson = JSON-encoded array of `{weight_kg, pair_count}`
 */
export async function updateEquipment(formData: FormData): Promise<void> {
  const inventoryRaw = formData.get("plateInventoryJson");
  let parsedInventory: Array<{ weight_kg: number; pair_count: number }> = [];
  if (typeof inventoryRaw === "string" && inventoryRaw.trim().length > 0) {
    try {
      const candidate = JSON.parse(inventoryRaw);
      if (Array.isArray(candidate)) parsedInventory = candidate;
    } catch {
      throw new Error("Invalid plate inventory payload");
    }
  }

  const parsed = EQUIPMENT_SCHEMA.safeParse({
    barbellKg: formData.get("barbellKg"),
    trapBarKg: formData.get("trapBarKg"),
    plateInventory: parsedInventory,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid equipment settings");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Deduplicate plate rows by weight — if the user typed 20 twice we
  // sum the pair counts so the inventory stays predictable.
  const dedup = new Map<number, number>();
  for (const p of parsed.data.plateInventory) {
    if (p.pair_count <= 0) continue;
    dedup.set(p.weight_kg, (dedup.get(p.weight_kg) ?? 0) + p.pair_count);
  }
  const inventory = Array.from(dedup.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([weight_kg, pair_count]) => ({ weight_kg, pair_count }));

  const { error } = await supabase
    .from("profiles")
    .update({
      barbell_kg: parsed.data.barbellKg,
      trap_bar_kg: parsed.data.trapBarKg,
      plate_inventory_kg: inventory,
    })
    .eq("id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/app/settings/equipment");
  revalidatePath("/app/settings");
}
