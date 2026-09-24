import type postgres from "postgres";
import { z } from "zod";
import { requireInspection } from "./swim-production-readonly-guards";

const count = z.number().int().min(0).max(2147483647);
export const compositeFkViolationsSchema = z.object({
  program_instances_block_id_fkey: count,
  planned_sessions_block_id_fkey: count,
  swim_import_outcomes_owned_workout_fk: count,
  swim_import_outcomes_owned_match_fk: count,
  swim_plan_rehab_bindings_owned_plan_fk: count,
  swim_plan_rehab_bindings_owned_protocol_fk: count,
}).strict();
export type CompositeFkViolations = z.infer<typeof compositeFkViolationsSchema>;

export const MODULAR_REFERENCE_QUERIES = [
  { key: "program_instances_block_id_fkey", optional: null,
    sql: `SELECT count(*)::int AS violations FROM public.program_instances c
      WHERE c.user_id IS NOT NULL AND c.block_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM public.training_blocks p WHERE p.user_id=c.user_id AND p.id=c.block_id)` },
  { key: "planned_sessions_block_id_fkey", optional: null,
    sql: `SELECT count(*)::int AS violations FROM public.planned_sessions c
      WHERE c.user_id IS NOT NULL AND c.block_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM public.training_blocks p WHERE p.user_id=c.user_id AND p.id=c.block_id)` },
  { key: "swim_import_outcomes_owned_workout_fk", optional: "outcomes",
    sql: `SELECT count(*)::int AS violations FROM public.swim_import_outcomes c
      WHERE c.user_id IS NOT NULL AND c.workout_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM public.swim_workouts p WHERE p.user_id=c.user_id AND p.id=c.workout_id)` },
  { key: "swim_import_outcomes_owned_match_fk", optional: "outcomes",
    sql: `SELECT count(*)::int AS violations FROM public.swim_import_outcomes c
      WHERE c.user_id IS NOT NULL AND c.workout_id IS NOT NULL AND c.match_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM public.swim_import_matches p WHERE p.user_id=c.user_id AND p.workout_id=c.workout_id AND p.id=c.match_id)` },
  { key: "swim_plan_rehab_bindings_owned_plan_fk", optional: "bindings",
    sql: `SELECT count(*)::int AS violations FROM public.swim_plan_rehab_bindings c
      WHERE c.user_id IS NOT NULL AND c.plan_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM public.swim_plans p WHERE p.user_id=c.user_id AND p.id=c.plan_id)` },
  { key: "swim_plan_rehab_bindings_owned_protocol_fk", optional: "bindings",
    sql: `SELECT count(*)::int AS violations FROM public.swim_plan_rehab_bindings c
      WHERE c.user_id IS NOT NULL AND c.rehab_protocol_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM public.rehab_protocols p WHERE p.user_id=c.user_id AND p.id=c.rehab_protocol_id)` },
] as const;

export const MODULAR_REFERENCE_VISIBILITY_SQL = `SELECT
  to_regclass('public.swim_import_outcomes') IS NOT NULL AS outcomes,
  to_regclass('public.swim_plan_rehab_bindings') IS NOT NULL AS bindings,
  (SELECT bool_or(row_security_active(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('program_instances','planned_sessions','training_blocks',
      'swim_import_outcomes','swim_workouts','swim_import_matches','swim_plan_rehab_bindings','swim_plans','rehab_protocols')) AS filtered`;

export async function inspectModularReferences(sql: postgres.Sql | postgres.TransactionSql): Promise<CompositeFkViolations> {
  const visibility = z.array(z.object({ outcomes: z.boolean(), bindings: z.boolean(), filtered: z.literal(false) }).strict())
    .length(1).safeParse(Array.from(await sql.unsafe(MODULAR_REFERENCE_VISIBILITY_SQL)));
  requireInspection(visibility.success, "owned_reference_visibility");
  const counts: Record<string, number> = {};
  for (const query of MODULAR_REFERENCE_QUERIES) {
    // An absent additive table has no pre-existing rows to violate its new FKs.
    if (query.optional && !visibility.data[0]![query.optional]) { counts[query.key] = 0; continue; }
    const parsed = z.array(z.object({ violations: count }).strict()).length(1)
      .safeParse(Array.from(await sql.unsafe(query.sql)));
    requireInspection(parsed.success, "owned_reference_counts");
    counts[query.key] = parsed.data[0]!.violations;
  }
  return compositeFkViolationsSchema.parse(counts);
}

export function requireCompatibleModularReferences(counts: CompositeFkViolations) {
  const parsed = compositeFkViolationsSchema.safeParse(counts);
  requireInspection(parsed.success, "owned_reference_counts");
  requireInspection(Object.values(parsed.data).every((value) => value === 0), "owned_reference_conflict");
}
