"use server";

/**
 * Movement how-to read action (exercise library, migration 0098).
 *
 * Fetched on demand when the how-to sheet opens — the payload lives in a side
 * table, so the session page's hot queries never carry it. Global content
 * (RLS: SELECT open to authenticated, no write policies), so no per-user scoping
 * is needed beyond the authenticated client.
 */
import { createClient, getAuthUser } from "@/lib/supabase/server";

export type MovementHowTo = {
  summary: string;
  setup: string | null;
  steps: string[];
  cues: string[];
  commonMistakes: string[];
};

export async function getMovementInstructions(
  movementId: string,
): Promise<MovementHowTo | null> {
  // Cheap auth gate — content is global but the sheet is an in-app surface.
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("movement_instructions")
    .select("summary, setup, steps, cues, common_mistakes")
    .eq("movement_id", movementId)
    .maybeSingle();

  if (!data) return null;
  return {
    summary: data.summary as string,
    setup: (data.setup as string | null) ?? null,
    steps: (data.steps as string[] | null) ?? [],
    cues: (data.cues as string[] | null) ?? [],
    commonMistakes: (data.common_mistakes as string[] | null) ?? [],
  };
}
