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

export const SEED_MOVEMENTS: NewMovement[] = [
  ...PATTERNS_PART_1,
  ...PATTERNS_PART_2,
  ...PATTERNS_PART_3,
];
