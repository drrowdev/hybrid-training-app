/**
 * @hta/tacticalbarbell — Tactical Barbell as a pluggable platform program.
 *
 * A pure, faithful encoding of K. Black's Tactical Barbell strength templates
 * (Operator, Fighter, Zulu, Gladiator, Mass, Grey Man) implementing the
 * @hta/program-core ProgramEngine contract. No DB, no UI.
 */
export {
  TB_TEMPLATES,
  TB_MOVEMENT_LABEL,
  getTbTemplate,
  type TbTemplate,
  type TbWeekScheme,
  type TbPercentWave,
  type TbWeeklySession,
  type TbStructure,
  type TbMovement,
} from "./templates";
export { roundToIncrement } from "./rounding";
export { tacticalBarbellEngine, type TbInstance, type TbClusterLift } from "./program";
