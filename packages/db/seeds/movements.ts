/**
 * Movement catalog seed (~250 movements) for Phase 1.
 *
 * Organised by pattern + region per v2 vocabulary. Each movement carries
 * the metadata needed by the scheduler and the aesthetics dashboard.
 *
 * Helpers below set sensible category defaults; per-movement overrides
 * specify only what differs. Run with `pnpm db:seed`.
 */
import type { NewMovement } from "../src/schema/movements";
import { PATTERNS_PART_1 } from "./movements-part1";
import { PATTERNS_PART_2 } from "./movements-part2";
import { PATTERNS_PART_3 } from "./movements-part3";
import { deriveAccessoryRoles } from "./derive-roles";

const PRIMARY_MUSCLE_TAXONOMY_EXCEPTIONS = new Set([
  // The current enum has no hip-flexor category. A false quad/adductor tag
  // would corrupt volume and limitation logic, so region + protocol metadata
  // carry this movement until the taxonomy gains an exact muscle.
  "standing-banded-hip-flexion",
]);

export function requiresPrimaryMuscle(movement: {
  slug: string;
  pattern: string;
}): boolean {
  return (
    movement.pattern !== "carry" &&
    !PRIMARY_MUSCLE_TAXONOMY_EXCEPTIONS.has(movement.slug)
  );
}

/**
 * Apply deterministic role derivation to every movement so each seed row
 * ships with its `bulletproof_roles` + `functional_roles`. This is what
 * makes the seed the single source of truth for role tagging — a reseed
 * (run.ts upserts `excluded.bulletproof_roles`/`functional_roles`) now
 * PRESERVES the tags instead of wiping them. See `derive-roles.ts`.
 */
function withRoles(m: NewMovement): NewMovement {
  const { bulletproofRoles, functionalRoles } = deriveAccessoryRoles({
    slug: m.slug,
    pattern: m.pattern,
    bilateral: m.bilateral,
    isCompound: m.isCompound,
    primaryRegion: m.primaryRegion,
    experienceMin: m.experienceMin,
    functionalRoles: m.functionalRoles as string[] | undefined,
    metadata: m.metadata as Record<string, unknown> | undefined,
  });
  return { ...m, bulletproofRoles, functionalRoles };
}

export const SEED_MOVEMENTS: NewMovement[] = [
  ...PATTERNS_PART_1,
  ...PATTERNS_PART_2,
  ...PATTERNS_PART_3,
].map(withRoles);
