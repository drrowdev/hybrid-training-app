/**
 * @hta/green — Tactical Barbell's Green Protocol as a pluggable platform program.
 *
 * A concurrent strength + endurance system that COMPOSES the @hta/tacticalbarbell
 * strength engine and layers structured conditioning on a weekly grid, over the
 * @hta/program-core ProgramEngine contract. Pure — no DB, no UI.
 */
export {
  CONDITIONING_SESSIONS,
  getConditioningSession,
  type ConditioningSession,
  type IntensityZone,
  type ConditioningUnit,
} from "./conditioning";
export {
  GREEN_PHASES,
  getGreenPhase,
  strengthTemplatesInPhase,
  type GreenPhase,
  type GreenWeek,
  type GreenBenchmark,
  type DayCell,
  type GreenStrength,
} from "./phases";
export { greenProtocolEngine, greenStrengthTemplateByRef, type GreenInstance } from "./program";
export { suggestTbSessions, isGenericSlot } from "./tb-suggestions";
