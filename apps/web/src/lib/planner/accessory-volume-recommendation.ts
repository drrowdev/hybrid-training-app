/**
 * ADR 0024 addendum — accessory-volume RECOMMENDATION + applicability.
 *
 * PR #278 shipped the Low/Medium/High accessory-volume lever but hid it on
 * archetypes where it looked inert. This follow-up makes the control visible on
 * EVERY priority combination and pre-selects an engine-recommended level (with a
 * plain-language reason) so the user gets guidance instead of a bare knob.
 *
 * Two pure helpers, both keyed off the resolved archetype + secondary focus:
 *
 *   - `accessoryVolumeApplicability(archetypeId)` — derived from the archetype's
 *     OWN aesthetic accessory base, the single source of truth that also drives
 *     the engine floor (`accessory-volume.ts#floorBonus`). Tells the UI whether
 *     the control does anything and whether Low collapses into Medium.
 *
 *   - `recommendedAccessoryVolume(...)` — the suggested level + reason. Base
 *     suggestion per archetype; a `"muscle"` secondary pushes to the level that
 *     actually ADDS volume (never an inert one). Returns `null` for archetypes
 *     that ship zero accessories (Maintenance) so the caller renders a disabled
 *     control rather than a misleading recommendation.
 *
 * This module is advisory only: it pre-selects a wizard DEFAULT. The persisted
 * schema default stays `medium`, so the engine's byte-identical guarantee from
 * PR #278 is untouched.
 */
import { ARCHETYPES, type ArchetypeId } from "./archetypes";
import {
  ACCESSORY_VOLUME_VALUES,
  type AccessoryVolumeLevel,
} from "./accessory-volume";
import type { SecondaryFocus } from "./secondary-focus";

/** Archetype ids the wizard can resolve to (every real archetype, not custom). */
export type RecommendableArchetypeId = Exclude<ArchetypeId, "custom">;

export interface AccessoryVolumeApplicability {
  /**
   * `false` only for archetypes whose aesthetic accessory base is 0
   * (Maintenance): the lever is a full no-op at every level, so the control is
   * shown DISABLED. Every other archetype is interactive.
   */
  enabled: boolean;
  /**
   * Retained for back-compat with the Step 4 control, but now ALWAYS `false`:
   * `low` drops the last aesthetic movement even on base-1 archetypes
   * (Endurance / Rebuild), so Low / Medium / High are three genuinely distinct
   * volumes on every enabled archetype. See `accessory-volume.ts#floorBonus`.
   */
  lowEqualsMedium: boolean;
  /** The archetype's aesthetic `itemsPerSession` base (for callers/tests). */
  aestheticBaseItems: number;
}

/**
 * Read the archetype's aesthetic accessory base from the archetype registry —
 * the same field the engine floors against — so this never drifts from the
 * actual prescription behaviour.
 */
export function accessoryVolumeApplicability(
  archetypeId: RecommendableArchetypeId,
): AccessoryVolumeApplicability {
  const base = ARCHETYPES[archetypeId]?.accessoryProfile?.aesthetic.itemsPerSession ?? 0;
  return {
    enabled: base > 0,
    // Low now trims a movement on every enabled archetype (floors at 0), so the
    // three levels are always distinct — there is no longer a "Low == Medium"
    // case to flag.
    lowEqualsMedium: false,
    aestheticBaseItems: base,
  };
}

export interface AccessoryVolumeRecommendation {
  level: AccessoryVolumeLevel;
  /** One-line, plain-language justification shown next to the control. */
  reason: string;
}

/**
 * Recommend an accessory-volume level for a resolved (archetype, secondary)
 * pair. `null` ⇒ the control is inert for this archetype (Maintenance) and
 * should be rendered disabled with an explanatory note rather than a
 * recommendation chip.
 *
 * Rules:
 *   - Base suggestion per archetype (strength → Medium, hypertrophy → High,
 *     concurrent → Medium, endurance → Low, rebuild → Low).
 *   - A `"muscle"` secondary means the user explicitly wants more growth, so we
 *     recommend the level that actually adds aesthetic volume. On archetypes
 *     whose base is 1 (Endurance) Low/Medium are identical, so the meaningful
 *     "more" is High; on the breadth-2 archetypes it's a single step Medium →
 *     High. Hypertrophy is already at High.
 *   - Other secondaries (`strength`, `cardio`, `none`) don't change the
 *     accessory amount, so the base suggestion stands.
 */
export function recommendedAccessoryVolume(args: {
  archetypeId: RecommendableArchetypeId;
  secondary: SecondaryFocus;
}): AccessoryVolumeRecommendation | null {
  const { archetypeId, secondary } = args;
  const wantsMuscle = secondary === "muscle";

  switch (archetypeId) {
    case "hypertrophy_anchor":
      return {
        level: "high",
        reason:
          "Muscle growth is the whole point of this block, so more accessory volume is the productive choice.",
      };

    case "strength_anchor":
      return wantsMuscle
        ? {
            level: "high",
            reason:
              "You added muscle as a second goal — extra accessory volume drives that growth alongside your main lifts.",
          }
        : {
            level: "medium",
            reason:
              "Balanced accessory work supports your main lifts without stretching the session out.",
          };

    case "concurrent_hybrid":
      return wantsMuscle
        ? {
            level: "high",
            reason:
              "With muscle as a second goal, extra accessory volume adds the hypertrophy work on top of your balanced plan.",
          }
        : {
            level: "medium",
            reason:
              "A balanced amount keeps both your strength and cardio days manageable.",
          };

    case "endurance_anchor":
      return wantsMuscle
        ? {
            level: "high",
            reason:
              "Cardio leads this plan, but you also want muscle — High is the only level that actually adds hypertrophy work here.",
          }
        : {
            level: "low",
            reason:
              "Cardio leads this plan — keeping accessory work light protects recovery for your sessions.",
          };

    case "rebuild":
      return {
        level: "low",
        reason:
          "You're easing back into training — minimal accessory volume protects tendons and keeps fatigue in check.",
      };

    case "maintenance":
    default:
      return null;
  }
}

/**
 * Realized-aware redundancy for the Low/Medium/High lever.
 *
 * `accessoryVolumeApplicability` is derived from the archetype's STATIC
 * aesthetic base, so it can't see that on a cardio-led block the mandatory
 * durability / functional / focus-muscle FLOOR saturates the strength day and
 * leaves the aesthetic lever nothing to grow — making two (or all three) levels
 * produce an identical session. This helper detects that from the LIVE per-level
 * duration estimate (the same number the user sees): a level is "redundant" when
 * its estimate equals that of a lower level. The wizard greys those levels out
 * with a tooltip and clamps the selection down to the equivalent lower level.
 *
 * Null / partial estimates ⇒ nothing redundant (the control stays fully
 * interactive until the live estimate resolves).
 */
export interface AccessoryVolumeRedundancy {
  /** Levels whose realized session duplicates a lower level. */
  redundant: Set<AccessoryVolumeLevel>;
  /** For each redundant level, the LOWEST level that yields the same session. */
  equivalentLevel: Partial<Record<AccessoryVolumeLevel, AccessoryVolumeLevel>>;
}

export function accessoryVolumeRedundancy(
  minutes: Record<AccessoryVolumeLevel, number | null> | null | undefined,
): AccessoryVolumeRedundancy {
  const redundant = new Set<AccessoryVolumeLevel>();
  const equivalentLevel: Partial<
    Record<AccessoryVolumeLevel, AccessoryVolumeLevel>
  > = {};
  if (!minutes) return { redundant, equivalentLevel };
  const order = ACCESSORY_VOLUME_VALUES; // low → medium → high
  for (let i = 1; i < order.length; i++) {
    const cur = minutes[order[i]!];
    if (cur == null) continue;
    for (let j = 0; j < i; j++) {
      const lo = minutes[order[j]!];
      // Equal realized duration ⇒ the lever added nothing at this step. Match
      // the LOWEST equal level (j ascending, break on first) so the tooltip and
      // the selection clamp both point at the leanest equivalent.
      if (lo != null && lo === cur) {
        redundant.add(order[i]!);
        equivalentLevel[order[i]!] = order[j]!;
        break;
      }
    }
  }
  return { redundant, equivalentLevel };
}
