/**
 * The plate step every load in the app is rounded to.
 *
 * One home (plan §6.9). The engines take it as `ctx.roundingKg`, the deploy
 * path may override it per instance, and anything that has to REPRODUCE a load
 * the engines already wrote — the legacy warm-up recovery, the training-max
 * alignment — has to use the same number or it lands a plate away.
 */
export const DEFAULT_ROUNDING_KG = 2.5;
