/**
 * Tendon-floor guarantee — DC-O4 weekly tissue-stack floor as an explicit,
 * context-aware, offline-checkable invariant (ADR 0024 addendum).
 *
 * The dynamic accessory picker (accessory-picker.ts) already fills the DC-O4
 * durability floor FIRST, accumulated across the week, and the Low/Med/High
 * accessory-volume lever only ever trims AESTHETIC items — so the floor is
 * structurally protected from the volume lever. The remaining risk is the
 * onboarding ramp shrinking the per-session budget on zero-aesthetic
 * archetypes; that is held off the floor reserve in assemble-prescription via
 * `FLOOR_FUNCTIONAL_RESERVE`.
 *
 * This module provides the pure, DB-free machinery to ASSERT the guarantee:
 *   - `contextualFloor` — the floor a given user context can actually be held
 *     to (plyometrics are clinically suppressed for tendinopathy AND for
 *     beginner/novice tiers, mirroring the picker's experience-band filter).
 *   - `countFloorRoles` — tally bulletproof roles from a materialised week's
 *     accessory + tendon prescription items, mirroring the runtime
 *     tissue-stack query but operating offline on `PrescriptionItem[]` + a
 *     movement→roles map.
 *   - `checkTendonFloor` — does a week meet a (contextual) floor? Returns the
 *     per-role deficits when not.
 *
 * Used by the cross-archetype CI invariant test; reusable by any future
 * runtime disclosure surface.
 */
import type { DeclaredExperience } from "@hta/engine";
import type { PrescriptionItem } from "@hta/db";
import {
  DC_O4_FLOOR,
  FLOOR_PLYOMETRIC_TOTAL,
  type BulletproofRole,
} from "./accessory-roles";

/** Beginner/novice tiers whose plyometric exposure the picker suppresses. */
const PLYO_SUPPRESSED_TIERS: ReadonlySet<DeclaredExperience> =
  new Set<DeclaredExperience>(["beginner_lt_6m", "novice_6m_2y"]);

export type FloorContext = {
  /** Active tendinopathy flag for the loaded region — suppresses plyometrics. */
  tendinopathyActive: boolean;
  /** Declared experience tier (null = undeclared). Beginner/novice suppress plyometrics. */
  experience: DeclaredExperience | null;
};

export type FloorRoleCount = Record<BulletproofRole, number>;

export function emptyFloorCount(): FloorRoleCount {
  return {
    heavy_isometric: 0,
    hsr: 0,
    alfredson_eccentric: 0,
    plyometric_low: 0,
    plyometric_high: 0,
    carry: 0,
  };
}

/**
 * The DC-O4 floor a given user context can legitimately be held to.
 *
 * Plyometrics are a clinical/skill exposure, not a universal requirement: they
 * are suppressed when a tendinopathy flag is active (reactive tissue) and for
 * beginner/novice tiers (the picker drops high-skill plyometric candidates via
 * the experience-band filter). In both cases the floor's plyometric line drops
 * to zero so the guarantee stays HONEST rather than demanding work the engine
 * is correctly withholding.
 *
 * Isometric, HSR and carry floors are universal — every context must hit them.
 */
export function contextualFloor(ctx: FloorContext): FloorRoleCount {
  const floor: FloorRoleCount = { ...DC_O4_FLOOR };
  const plyoSuppressed =
    ctx.tendinopathyActive ||
    (ctx.experience != null && PLYO_SUPPRESSED_TIERS.has(ctx.experience));
  if (plyoSuppressed) {
    floor.plyometric_low = 0;
    floor.plyometric_high = 0;
  }
  return floor;
}

/**
 * Tally bulletproof roles across a materialised week's prescription items.
 *
 * Only accessory + tendon items carry tissue-stack roles; main lifts, cardio
 * and warmups are ignored. Each item is mapped to its movement's bulletproof
 * roles via `roleBySlug` (built from the tagged movement catalog), mirroring
 * the runtime `getCurrentWeekTissueStackGaps` query which reads
 * `movements.bulletproof_roles`.
 */
export function countFloorRoles(
  weekItems: readonly PrescriptionItem[],
  roleBySlug: ReadonlyMap<string, readonly BulletproofRole[]>,
): FloorRoleCount {
  const count = emptyFloorCount();
  for (const item of weekItems) {
    if (item.kind !== "accessory" && item.kind !== "tendon") continue;
    const slug = item.movementSlug ?? "";
    const roles = roleBySlug.get(slug);
    if (!roles) continue;
    for (const role of roles) count[role] += 1;
  }
  return count;
}

export type FloorCheck = {
  met: boolean;
  /** Per-role shortfalls, only present when the floor is not met. */
  deficits: { role: "heavy_isometric" | "hsr" | "carry" | "plyometric"; have: number; need: number }[];
};

/**
 * Does a week's role tally satisfy the (contextual) DC-O4 floor?
 *
 * Plyometric low + high are merged against `FLOOR_PLYOMETRIC_TOTAL` (either
 * intensity counts toward the single plyometric exposure). The plyometric line
 * is only checked when the contextual floor still requires it.
 */
export function checkTendonFloor(
  count: FloorRoleCount,
  floor: FloorRoleCount,
): FloorCheck {
  const deficits: FloorCheck["deficits"] = [];
  if (count.heavy_isometric < floor.heavy_isometric) {
    deficits.push({ role: "heavy_isometric", have: count.heavy_isometric, need: floor.heavy_isometric });
  }
  if (count.hsr < floor.hsr) {
    deficits.push({ role: "hsr", have: count.hsr, need: floor.hsr });
  }
  if (count.carry < floor.carry) {
    deficits.push({ role: "carry", have: count.carry, need: floor.carry });
  }
  const plyoRequired = floor.plyometric_low + floor.plyometric_high > 0;
  if (plyoRequired) {
    const plyo = count.plyometric_low + count.plyometric_high;
    if (plyo < FLOOR_PLYOMETRIC_TOTAL) {
      deficits.push({ role: "plyometric", have: plyo, need: FLOOR_PLYOMETRIC_TOTAL });
    }
  }
  return { met: deficits.length === 0, deficits };
}
