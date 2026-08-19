"use server";

/**
 * Writing the inter-set rest-countdown preference.
 *
 * Split from `rest-timer-preference.ts` because a `"use server"` module may
 * export only async functions — the read helper's default constant cannot live
 * here, and the read has no reason to be an action.
 */
import { createClient, getAuthUser } from "@/lib/supabase/server";

export async function setRestTimerEnabled({
  enabled,
}: {
  enabled: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  // RLS on `profiles` is row-scoped (`auth.uid() = id`), so the authenticated
  // client plus this filter is the whole authorisation story — a new column
  // needs no policy change.
  const { error } = await supabase
    .from("profiles")
    .update({ rest_timer_enabled: enabled })
    .eq("id", user.id);
  if (error) {
    return { ok: false, error: "Couldn't save that. Try again in a moment." };
  }
  return { ok: true };
}
