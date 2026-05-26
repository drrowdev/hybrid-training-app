"use server";

/**
 * Equipment-settings server actions.
 *
 * Two actions live here:
 *  - `updateEquipment` (legacy, @deprecated) — writes the
 *    pre-overhaul bar weights + `{ weight_kg, pair_count }` plate
 *    rows to the legacy columns. Kept so any caller that hasn't
 *    been ported keeps working until the legacy columns are
 *    dropped in a follow-up PR.
 *  - `updateEquipmentV2` — writes the rich `profiles.equipment`
 *    JSONB introduced in migration 0040. The settings page uses
 *    this; legacy columns are left untouched so a rollback only
 *    has to clear the JSONB blob.
 *
 * Same RLS contract on both — the underlying `profiles_self` policy
 * gates updates to `id = auth.uid()`.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { parseEquipment } from "./equipment-schema";

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
 * @deprecated Use `updateEquipmentV2` instead. The bar / plate-pair
 * legacy columns are scheduled for removal in a follow-up PR once
 * every active profile has been migrated to the new `equipment`
 * JSONB shape.
 *
 * Persist the user's bar masses + plate inventory.
 *
 * FormData layout:
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
  } = await getAuthUser();
  if (!user) redirect("/login");

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

/**
 * Persist the rich equipment inventory to `profiles.equipment`.
 *
 * FormData layout:
 *   equipmentJson = JSON-encoded `Equipment` object (see
 *                   `equipment-schema.ts`). The editor stringifies
 *                   its local form state before submit so we
 *                   don't have to walk indexed FormData keys.
 */
export async function updateEquipmentV2(formData: FormData): Promise<void> {
  const raw = formData.get("equipmentJson");
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("Missing equipment payload");
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    throw new Error("Invalid equipment payload");
  }

  // `parseEquipment` throws with a human-readable message for the
  // first invalid field — surface it directly to the editor.
  const equipment = parseEquipment(candidate);

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ equipment })
    .eq("id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/app/settings/equipment");
  revalidatePath("/app/settings");
}
