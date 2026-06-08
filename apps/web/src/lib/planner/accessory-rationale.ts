/**
 * Plain-language "why was this accessory chosen" sentences.
 *
 * The accessory picker selects every accessory deterministically from one of
 * three triggers — a durability-floor role, a functional-role requirement, or
 * the largest open per-muscle volume gap. That trigger is known at pick time
 * but was previously discarded (the `rationale` string was left empty). This
 * module turns the known trigger into a short, plain-English explanation we can
 * surface per movement, so the user can see *why this specific movement* is in
 * their session — no AI required, because the engine already knows.
 *
 * Copy guidelines: calm and concrete, no hype, no internal bucket names
 * (the user never sees "bulletproof role" or "DC-O4"), no forbidden program
 * names. One sentence each.
 */
import type { BulletproofRole, FunctionalRole } from "./accessory-roles";

export type AccessoryReason = "durability" | "functional" | "aesthetic" | "power" | "focus";

const DURABILITY_WHY: Record<BulletproofRole, string> = {
  carry:
    "A loaded carry to build grip and a braced trunk — strengths your barbell lifts lean on but rarely train head-on.",
  heavy_isometric:
    "A hard static hold to build tendon and joint strength that your main lifts don't target directly.",
  hsr: "Heavy, slow reps to make the tendon stronger and more resilient over time.",
  alfredson_eccentric:
    "Slow lowering work to keep an irritable tendon healthy and able to take load.",
  plyometric_low:
    "Low-impact jumps to keep your tendons springy and reactive.",
  plyometric_high:
    "Explosive jumps to build power and stiff, responsive tendons.",
};

const FUNCTIONAL_WHY: Record<FunctionalRole, string> = {
  single_leg:
    "Single-leg work to even out left-to-right strength and sharpen the balance two-leg lifts skip.",
  anti_rotation:
    "Core work that resists twisting — it protects your spine when you load up.",
  anti_extension:
    "Core bracing the big lifts assume you have but don't build on their own.",
  loaded_mobility:
    "Loaded mobility to own the end of your range with control, not just flexibility.",
  compound_assistance:
    "Assistance work that reinforces and strengthens your main-lift pattern.",
  velocity_cued:
    "Moved fast on purpose — it trains how quickly you can produce force.",
  hip_stabilizer:
    "Hip-stability work for steadier, healthier squats and runs.",
  ankle_foot:
    "Ankle and foot strength for a more stable base under load.",
  shoulder_stability:
    "Rotator-cuff and scapular work to keep your shoulders healthy under pressing volume.",
  pull:
    "A pulling movement to balance all the pressing — your main lifts never train the back directly, so this keeps it from falling behind.",
  power_olympic:
    "An explosive lift to build full-body power and rate of force.",
  power_plyometric:
    "Jump-based work to build reactive, springy power.",
  power_ballistic:
    "An explosive throw-style movement to train pure speed-strength.",
};

const POWER_WHY =
  "Explosive, low-rep work done fresh with full rest — built to add power, not fatigue.";

/** Turn a fine-grained muscle enum (e.g. `side_delts`) into readable text. */
export function humanizeMuscle(muscle: string): string {
  return muscle.replace(/_/g, " ").trim();
}

/**
 * Build the plain-language reason for an accessory pick from its known trigger.
 * Falls back to a generic-but-honest sentence if the specific role/muscle is
 * missing, so a new role can never produce an empty or broken explanation.
 */
export function accessoryRationale(input: {
  reason: AccessoryReason;
  bulletproofRole?: BulletproofRole;
  functionalRole?: FunctionalRole;
  gapMuscle?: string;
}): string {
  switch (input.reason) {
    case "durability":
      return (
        (input.bulletproofRole && DURABILITY_WHY[input.bulletproofRole]) ||
        "Durability work to keep the tissues your main lifts stress healthy and resilient."
      );
    case "functional":
      return (
        (input.functionalRole && FUNCTIONAL_WHY[input.functionalRole]) ||
        "Movement-quality work that fills a gap your main lifts leave."
      );
    case "power":
      return POWER_WHY;
    case "aesthetic": {
      const muscle = input.gapMuscle ? humanizeMuscle(input.gapMuscle) : null;
      return muscle
        ? `Adds direct ${muscle} volume — your main lift trains it only lightly, so this tops it up.`
        : "Adds direct volume to a muscle your main lift trains only lightly.";
    }
    case "focus": {
      const muscle = input.gapMuscle ? humanizeMuscle(input.gapMuscle) : null;
      return muscle
        ? `Direct ${muscle} work — it's your focus muscle, so the plan guarantees a baseline of it even when accessory volume is low.`
        : "Direct work for your focus muscle — guaranteed a baseline even when accessory volume is low.";
    }
  }
}
