import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getLimitationResponseOffer } from "./offer";

export type LimitationTodaySummary = {
  /** Completed adjustments count, per limitation id. */
  adjustedById: Record<string, number>;
  /** Total completed adjustments across all limitations. */
  totalAdjusted: number;
  /** Distinct movements with a still-pending suggested swap/drop (aggregate). */
  pendingCount: number;
};

const EMPTY: LimitationTodaySummary = {
  adjustedById: {},
  totalAdjusted: 0,
  pendingCount: 0,
};

/**
 * Summary for the Today active-limitation card: how many movements the engine
 * has already adjusted around the user's limitations (per limitation), and how
 * many suggested adjustments are still pending. Read-only; user-scoped.
 *
 * The offer derivation (pendingCount) only does real work when there's an
 * active block + active limitation, so it short-circuits cheaply for everyone
 * else.
 */
export async function getLimitationTodaySummary(): Promise<LimitationTodaySummary> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return EMPTY;

  const supabase = await createClient();
  const { data } = await supabase
    .from("limitation_adjustments")
    .select("limitation_id")
    .eq("user_id", user.id);

  const adjustedById: Record<string, number> = {};
  let totalAdjusted = 0;
  for (const r of (data ?? []) as Array<{ limitation_id: string | null }>) {
    totalAdjusted += 1;
    if (r.limitation_id) {
      adjustedById[r.limitation_id] = (adjustedById[r.limitation_id] ?? 0) + 1;
    }
  }

  const offer = await getLimitationResponseOffer();
  const pendingCount = offer
    ? new Set([
        ...offer.swaps.map((s) => s.fromMovementId),
        ...offer.drops.map((d) => d.fromMovementId),
      ]).size
    : 0;

  return { adjustedById, totalAdjusted, pendingCount };
}
