/**
 * @hta/hyrox — the HYROX program engine (ADR 0050).
 */
export {
  hyroxEngine,
  hyroxMeta,
  hyroxRef,
  parseHyroxRef,
  WEEKS_BY_EXPERIENCE,
  DEFAULT_SESSIONS_BY_EXPERIENCE,
  MIN_SESSIONS_PER_WEEK,
  MAX_SESSIONS_PER_WEEK,
  type HyroxInstance,
  type HyroxExperience,
  type HyroxDivision,
} from "./program";

export {
  buildHyroxGrid,
  sessionsInGrid,
  gridSessionsResolve,
  PHASE_NAME,
  type HyroxDayCell,
  type HyroxWeekPlan,
  type HyroxPhaseId,
  type HyroxGridInput,
} from "./phases";

export {
  HYROX_SESSIONS,
  getHyroxSession,
  modalityOf,
  type HyroxSession,
  type HyroxCategory,
  type HyroxZone,
  type HyroxUnit,
} from "./sessions";

export {
  HYROX_STATIONS,
  getStation,
  stationLoadLabel,
  type HyroxStation,
  type StationLoad,
} from "./divisions";

export { prescribeSession, deloadPrescription, type PrescribeArgs } from "./prescription";
