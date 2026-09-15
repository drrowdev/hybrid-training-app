import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const movementsSchema = z.array(z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  slug: z.string().nullable(),
  primary_region: z.string(),
}));

export async function loadTodayMovementContext(
  client: SupabaseClient,
  movementIds: string[],
) {
  const movementRegionById = new Map<string, { primaryRegion: string; name: string }>();
  const movementSlugById = new Map<string, string | null>();
  if (movementIds.length === 0) return { movementRegionById, movementSlugById };

  const { data, error } = await client.from("movements")
    .select("id, display_name, slug, primary_region")
    .in("id", movementIds);
  const parsed = movementsSchema.safeParse(data);
  if (error || !parsed.success) throw new Error("Today's exercises could not be loaded.");

  for (const movement of parsed.data) {
    movementRegionById.set(movement.id, {
      primaryRegion: movement.primary_region,
      name: movement.display_name,
    });
    movementSlugById.set(movement.id, movement.slug);
  }
  return { movementRegionById, movementSlugById };
}
