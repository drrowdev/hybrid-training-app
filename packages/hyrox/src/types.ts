/**
 * HYROX — shared value types used by both the engine (program.ts) and the phase
 * grid generator (phases.ts). Kept in their own module to avoid a circular import.
 */

/** Athlete experience tier — drives default block length + session volume. */
export type HyroxExperience = "beginner" | "intermediate" | "advanced";

/** Race division — drives station weights / rep standards. */
export type HyroxDivision = "open" | "pro" | "doubles";
