/**
 * ADR 0040 — interference-aware strength accessory headroom (pure).
 *
 * When a block's PLANNED cardio modality mix interferes LESS with strength than
 * an all-running reference (cycling/rowing spare the legs — Wilson 2012), the
 * freed recovery can support a little more strength accessory volume. This helper
 * turns that interference *saving* into a small, capped item bonus for the
 * accessory picker.
 *
 * Anchoring (byte-identical promise): the reference is the archetype's own
 * DEFAULT cardio mix (no event, no preference, no diversification), so a block
 * whose planned cardio equals the template default has `saving = 0` → bonus 0 →
 * unchanged. Only a mix the athlete diversifies BELOW the template baseline
 * (e.g. moving an easy run to the bike) earns the bonus. Gated to
 * strength-emphasis archetypes — on cardio-led blocks strength is deliberately
 * floored, so there is no headroom to spend.
 *
 * Grounded in Wilson 2012 (running concurrent impairs lower-body strength,
 * cycling does not). The threshold + cap are CP-1 heuristics — a deliberately
 * conservative "one extra accessory, only when the saving is real" rule.
 */
import { computeConcurrentScalar } from "@/lib/engine/concurrent-scalar";
import type { ArchetypeId } from "./archetypes";
import type { PreferredCardioModality } from "./preferred-cardio-modality";

/** Minimum interference-scalar saving (vs all-running) to earn the +1 item. */
export const INTERFERENCE_BONUS_THRESHOLD = 0.04; // CP-1 heuristic
/** Hard cap on the interference accessory bonus. */
export const INTERFERENCE_BONUS_MAX_ITEMS = 1;

/** Archetypes where strength is substantial enough to spend freed headroom. */
function strengthEmphasisArchetype(archetypeId: ArchetypeId): boolean {
  return archetypeId === "strength_anchor" || archetypeId === "concurrent_hybrid";
}

/**
 * Map a planner modality (or null = the running default) to the
 * `MODALITY_INTERFERENCE` / `computeConcurrentScalar` short key.
 */
export function scalarModalityKey(
  modality: PreferredCardioModality | null,
): string {
  switch (modality) {
    case "cycling":
      return "bike";
    case "rowing":
      return "row";
    case "swimming":
      return "swim";
    case "ski_erg":
      return "ski";
    case "rucking":
      return "ruck";
    case "running":
    case null:
      return "run";
    // elliptical / stair / sled have no dedicated coefficient → `other`.
    default:
      return "other_cardio";
  }
}

/**
 * Compute the interference-aware accessory item bonus for a block from its
 * DEFAULT vs PLANNED weekly cardio minutes-by-modality. The default mix is the
 * archetype's own template (no event, no preference, no diversification) — using
 * it as the baseline guarantees every existing, non-diversified block scores 0
 * (planned == default), so B is byte-identical until the athlete actually picks
 * lower-interference cardio than the template prescribes. Returns 0 for
 * non-strength archetypes, no cardio, or a saving below threshold.
 */
export function computeInterferenceVolumeBonus(args: {
  defaultMinutesByModality: Record<string, number>;
  plannedMinutesByModality: Record<string, number>;
  archetypeId: ArchetypeId;
}): number {
  const { defaultMinutesByModality, plannedMinutesByModality, archetypeId } = args;
  if (!strengthEmphasisArchetype(archetypeId)) return 0;

  const totalMinutes = Object.values(plannedMinutesByModality).reduce(
    (sum, m) => sum + (m ?? 0),
    0,
  );
  if (totalMinutes <= 0) return 0;

  const actual = computeConcurrentScalar(plannedMinutesByModality);
  const baseline = computeConcurrentScalar(defaultMinutesByModality);
  // Higher scalar = LESS interference. A planned mix that is lower-interference
  // than the template default scores higher → `saving > 0`.
  const saving = actual - baseline;
  return saving >= INTERFERENCE_BONUS_THRESHOLD ? INTERFERENCE_BONUS_MAX_ITEMS : 0;
}
