/**
 * DB columns the training-max resolution queries select. Shared by the query
 * call sites (`fillSessionFromPlan`, `quick-generate-resolve`) AND the schema
 * column-contract test, so a column rename or typo - like the `value_kg`
 * regression that silently broke materialised set weights and the Quick Workout
 * "Generate" button - fails in CI rather than at runtime.
 *
 * `TM_RESOLUTION_SELECT` is a literal `as const` so the Supabase client keeps
 * full result typing; `TM_RESOLUTION_COLUMNS` is derived from the same literal
 * so the query and the contract test can never drift.
 *
 * The training max is then computed as `one_rm_kg x (tm_percent ??
 * profiles.tm_percent_default ?? 90) / 100`.
 */
export const TM_RESOLUTION_SELECT = "movement_id, one_rm_kg, tm_percent" as const;

/** The individual column names, derived from the literal select. */
export const TM_RESOLUTION_COLUMNS: readonly string[] =
  TM_RESOLUTION_SELECT.split(", ");