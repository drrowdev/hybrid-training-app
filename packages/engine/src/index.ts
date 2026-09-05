/**
 * @hta/engine — the hybrid programming engine.
 *
 * Implements v2's ceiling math (DC-C*), archetype budgets (DC-F*),
 * bucket pressure, stall diagnosis (DC-H*), planning pseudocode (v2 §11).
 *
 * Phase 0: stub. Real engine lands in Phase 2.
 */

export const ENGINE_VERSION = "0.0.0" as const;

export {
  isRecoveredWeek,
  median,
  pickCeilingBase,
  type WeekRecoveryInput,
  type WeekRecoveryResult,
  type CeilingBaseFormula,
  type CeilingBaseResult,
  type CeilingBasisWeek,
} from "./recovered-weeks";

export {
  classifyBodyweightRatio,
  classifyAbsoluteThreshold,
  computeTier,
  DECLARED_TO_TIER,
  MAIN_LIFTS,
  type TierLevel,
  type DeclaredExperience,
  type MainLift,
  type TierInputs,
  type TierResult,
  type Contributor,
} from "./tier-detection";

export * from "./swimming";
