/**
 * Skip reasons exposed in the per-set "skip with reason" picker.
 *
 * Mirrors the SQL CHECK constraint on `set_logs.skip_reason`
 * (migration 0037). The DB schema re-exports the same constant from
 * `@hta/db`, but importing that package into a client component
 * drags Postgres / Drizzle into the browser bundle — so the
 * client-side picker uses this small local copy instead.
 *
 * If a new chip is added: update the CHECK constraint AND this list
 * AND the re-export in `packages/db/src/schema/set-logs.ts`.
 */
export const SKIP_REASONS = [
  "pain",
  "fatigue",
  "time",
  "equipment",
  "other",
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

const SKIP_REASON_LABELS: Readonly<Record<SkipReason, string>> = {
  pain: "Pain",
  fatigue: "Fatigue",
  time: "Time",
  equipment: "Equipment",
  other: "Other",
};

/**
 * The display label for a stored skip reason. The column holds the slug; every
 * surface that shows a reason to a lifter goes through here.
 *
 * Unknown values pass through: a reason written before this allowlist, or by a
 * newer client, is still better shown than swallowed.
 */
export function skipReasonLabel(reason: string): string {
  return SKIP_REASON_LABELS[reason as SkipReason] ?? reason;
}
