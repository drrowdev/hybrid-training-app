import type postgres from "postgres";
import { z } from "zod";
import { requireInspection } from "./swim-production-readonly-guards";

const relations = ["swim_import_outcomes", "swim_current_import_outcomes", "swim_import_outcome_activity", "swim_plan_rehab_bindings"];
const functions = [
  "training_schedule_lock", "training_schedule_snapshot", "training_schedule_commit", "start_planned_session_atomically",
  "swim_import_outcomes_ready", "swim_confirm_import_outcome", "guard_program_block_identity", "guard_program_instance_identity",
  "sync_program_instance_lifecycle", "check_program_parent_consistency", "validate_owned_rehab_items", "guard_program_prescription",
  "independent_programs_ready", "independent_program_schedule_commit", "complete_program_if_settled", "commit_program_progression",
  "set_swim_rehab_bindings", "guard_swim_rehab_session", "start_swim_rehab_session",
];
export const MODULAR_CHANGED_FUNCTIONS = [
  "swim_create_plan", "swim_start_workout", "swim_set_plan_status", "swim_skip_workout", "swim_update_plan",
  "swim_resume_plan", "swim_complete_workout", "swim_edit_result", "complete_training_session_with_transition",
  "replace_hyrox_session_actuals", "insert_deload_week", "remove_deload_week", "insert_set_logs_with_bw_progress",
  "deploy_program_instance_atomically", "update_program_instance_atomically",
].map((name) => `function:public.${name}`);
export const MODULAR_REMOVED_INDEXES = [
  "index:public.training_blocks_one_visible_active_per_user", "index:public.program_instances_one_visible_active_per_user",
];
export const MODULAR_CHANGED_CONSTRAINTS: Record<string, string> = {
  "constraint:public.training_blocks.training_blocks_days_per_week_check":
    "CHECK (((days_per_week IS NULL) OR ((days_per_week >= 2) AND (days_per_week <= 7)) OR ((days_per_week = 1) AND (NOT (program_id IS DISTINCT FROM 'authored'::text)))))",
  "constraint:public.program_instances.program_instances_block_id_fkey":
    "FOREIGN KEY (user_id, block_id) REFERENCES training_blocks(user_id, id) ON DELETE SET NULL (block_id)",
  "constraint:public.planned_sessions.planned_sessions_block_id_fkey":
    "FOREIGN KEY (user_id, block_id) REFERENCES training_blocks(user_id, id) ON DELETE CASCADE",
};
const addedIndexes = [
  "swim_import_matches_owned_workout_id_key", "swim_import_outcomes_pkey", "swim_import_outcomes_owner_revision_key",
  "training_blocks_user_id_id_key", "training_blocks_one_active_per_kind", "training_blocks_one_active_legacy",
  "program_instances_one_active_per_block", "program_instances_one_active_orphan", "rehab_protocols_user_id_id_key",
  "swim_plan_rehab_bindings_pkey", "swim_plan_rehab_bindings_plan_id_rehab_protocol_id_key",
  "swim_plan_rehab_bindings_owner_idx", "swim_plan_rehab_bindings_protocol_idx",
];
const addedConstraints = [
  "swim_import_matches.swim_import_matches_owned_workout_id_key",
  "swim_import_outcomes.swim_import_outcomes_pkey", "swim_import_outcomes.swim_import_outcomes_user_id_fkey",
  "swim_import_outcomes.swim_import_outcomes_revision_check", "swim_import_outcomes.swim_import_outcomes_metadata_check",
  "swim_import_outcomes.swim_import_outcomes_owner_revision_key", "swim_import_outcomes.swim_import_outcomes_owned_workout_fk",
  "swim_import_outcomes.swim_import_outcomes_owned_match_fk", "training_blocks.training_blocks_program_kind_check",
  "training_blocks.training_blocks_user_id_id_key", "rehab_protocols.rehab_protocols_user_id_id_key",
  "swim_plan_rehab_bindings.swim_plan_rehab_bindings_local_protocol_id_check",
  "swim_plan_rehab_bindings.swim_plan_rehab_bindings_user_id_fkey", "swim_plan_rehab_bindings.swim_plan_rehab_bindings_pkey",
  "swim_plan_rehab_bindings.swim_plan_rehab_bindings_plan_id_rehab_protocol_id_key",
  "swim_plan_rehab_bindings.swim_plan_rehab_bindings_owned_plan_fk",
  "swim_plan_rehab_bindings.swim_plan_rehab_bindings_owned_protocol_fk",
];
const addedTriggers = [
  ...["training_blocks", "planned_sessions", "program_instances", "swim_plans", "swim_workouts", "sessions", "set_logs", "cardio_logs"]
    .map((name) => `${name}.${name}_schedule_lock`),
  "training_blocks.training_blocks_program_identity", "program_instances.program_instances_program_identity",
  "training_blocks.training_blocks_instance_lifecycle", "training_blocks.training_blocks_parent_consistency",
  "program_instances.program_instances_parent_consistency", "swim_plan_rehab_bindings.swim_plan_rehab_bindings_schedule_lock",
  "rehab_protocols.rehab_protocols_schedule_lock", "program_rehab_bindings.program_rehab_bindings_schedule_lock",
  "training_seasons.training_seasons_schedule_lock", "season_blocks.season_blocks_schedule_lock",
  "planned_sessions.planned_sessions_program_prescription", "sessions.sessions_swim_rehab_origin",
];
export const MODULAR_ADDED_CATALOG_KEYS = [
  ...relations.map((name) => `relation:public.${name}`), ...functions.map((name) => `function:public.${name}`),
  ...addedIndexes.map((name) => `index:public.${name}`), ...addedConstraints.map((name) => `constraint:public.${name}`),
  ...addedTriggers.map((name) => `trigger:public.${name}`),
  "policy:public.swim_import_outcomes.swim_import_outcomes_owner",
  "policy:public.swim_plan_rehab_bindings.swim_plan_rehab_bindings_owner",
  "column:public.training_blocks.program_kind",
];

// Catalog metadata only. Passwords, account rows, settings values and function bodies never leave Postgres.
export const MODULAR_CATALOG_SQL = `
WITH objects AS (
  SELECT 'global'::text AS key, jsonb_build_array(
    (SELECT jsonb_agg(jsonb_build_array(oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
      rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig) ORDER BY oid) FROM pg_roles),
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),
    (SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d),
    (SELECT jsonb_agg(jsonb_build_array(oid,nspname,nspowner,nspacl::text) ORDER BY oid)
      FROM pg_namespace WHERE nspname IN ('public','auth')),
    (SELECT jsonb_build_array(oid,datdba,datacl::text) FROM pg_database WHERE datname=current_database())
  ) AS value, NULL::jsonb AS security, NULL::text AS definition
  UNION ALL
  SELECT 'relation:'||n.nspname||'.'||c.relname,
    jsonb_build_array(c.oid,c.relkind,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,
      CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) ELSE NULL END),
    NULL::jsonb,NULL::text
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','v','m','S','f')
  UNION ALL
  SELECT 'column:'||n.nspname||'.'||c.relname||'.'||a.attname,
    jsonb_build_array(a.attrelid,a.attnum,a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,
      a.attcollation,a.attacl::text,pg_get_expr(d.adbin,d.adrelid)),NULL::jsonb,NULL::text
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','v','m','S','f') AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'function:'||n.nspname||'.'||p.proname,
    jsonb_build_array(p.oid,pg_get_functiondef(p.oid)),
    to_jsonb(p)-ARRAY['prosrc','probin','prosqlbody'],NULL::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','auth') AND p.prokind='f'
  UNION ALL
  SELECT 'constraint:'||n.nspname||'.'||c.relname||'.'||k.conname,
    jsonb_build_array(k.oid,pg_get_constraintdef(k.oid),k.convalidated,k.connoinherit),NULL::jsonb,
    CASE WHEN k.convalidated THEN pg_get_constraintdef(k.oid) ELSE NULL END
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','auth')
  UNION ALL
  SELECT 'index:'||n.nspname||'.'||c.relname,
    jsonb_build_array(c.oid,c.relowner,c.relacl::text,pg_get_indexdef(c.oid),i.indisvalid,i.indisready),NULL::jsonb,NULL::text
  FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','auth')
  UNION ALL
  SELECT 'policy:'||n.nspname||'.'||c.relname||'.'||p.polname,to_jsonb(p),NULL::jsonb,NULL::text
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','auth')
  UNION ALL
  SELECT 'trigger:'||n.nspname||'.'||c.relname||'.'||t.tgname,
    jsonb_build_array(t.oid,pg_get_triggerdef(t.oid),t.tgenabled),NULL::jsonb,NULL::text
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','auth') AND NOT t.tgisinternal
)
SELECT key, encode(sha256(convert_to(value::text,'UTF8')),'hex') AS fingerprint,
  CASE WHEN security IS NULL THEN NULL ELSE encode(sha256(convert_to(security::text,'UTF8')),'hex') END AS security,
  definition FROM objects ORDER BY key, fingerprint LIMIT 10001`;

const catalogRow = z.object({
  key: z.string(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  security: z.string().regex(/^[a-f0-9]{64}$/).nullable(), definition: z.string().nullable(),
}).strict();
export type ModularCatalog = z.infer<typeof catalogRow>[];
export async function modularCatalog(sql: postgres.Sql | postgres.TransactionSql): Promise<ModularCatalog> {
  const parsed = z.array(catalogRow).min(1).max(10000).safeParse(Array.from(await sql.unsafe(MODULAR_CATALOG_SQL)));
  requireInspection(parsed.success, "catalog_shape");
  // Unrelated overloads are retained as a group; all release-touched names must be unique.
  return parsed.data;
}
const addedColumn = (key: string) => relations.some((name) => key.startsWith(`column:public.${name}.`));
const rowsFor = (rows: ModularCatalog, key: string) => rows.filter((row) => row.key === key);
export function requireModularCatalogBaseline(before: ModularCatalog) {
  requireInspection(before.every((row) => !MODULAR_ADDED_CATALOG_KEYS.includes(row.key) && !addedColumn(row.key)), "catalog_baseline");
  requireInspection([...MODULAR_CHANGED_FUNCTIONS, ...MODULAR_REMOVED_INDEXES, ...Object.keys(MODULAR_CHANGED_CONSTRAINTS)]
    .every((key) => rowsFor(before, key).length === 1), "catalog_baseline");
}
export function verifyModularCatalog(before: ModularCatalog, after: ModularCatalog) {
  requireModularCatalogBaseline(before);
  for (const key of new Set(before.map((row) => row.key))) {
    const previous = rowsFor(before, key), current = rowsFor(after, key);
    if (MODULAR_REMOVED_INDEXES.includes(key)) {
      requireInspection(current.length === 0, "catalog_index_changed");
    } else if (MODULAR_CHANGED_FUNCTIONS.includes(key)) {
      requireInspection(current.length === 1 && previous[0]!.security === current[0]!.security, "catalog_function_security_changed");
    } else if (Object.hasOwn(MODULAR_CHANGED_CONSTRAINTS, key)) {
      requireInspection(current.length === 1 && current[0]!.definition === MODULAR_CHANGED_CONSTRAINTS[key], "catalog_constraint_changed");
    } else {
      requireInspection(JSON.stringify(previous) === JSON.stringify(current), "catalog_existing_changed");
    }
  }
  const existing = new Set(before.map((row) => row.key));
  const additions = after.filter((row) => !existing.has(row.key));
  requireInspection(MODULAR_ADDED_CATALOG_KEYS.every((key) => rowsFor(additions, key).length === 1) &&
    additions.every((row) => MODULAR_ADDED_CATALOG_KEYS.includes(row.key) || addedColumn(row.key)), "catalog_additions_changed");
}

export const MODULAR_ADDED_SECURITY_SQL = `
SELECT
  (SELECT count(*)=4 AND bool_and(c.relowner=current_user::regrole AND
    CASE WHEN c.relkind='r' THEN c.relrowsecurity ELSE 'security_invoker=true'=ANY(c.reloptions) END
    AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
    AND has_table_privilege('authenticated',c.oid,'SELECT')
    AND CASE WHEN c.relname='swim_plan_rehab_bindings'
      THEN has_table_privilege('authenticated',c.oid,'INSERT')
        AND has_table_privilege('authenticated',c.oid,'UPDATE') AND has_table_privilege('authenticated',c.oid,'DELETE')
      ELSE NOT has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') END)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]))
    AS relations,
  (SELECT count(*)=2 AND bool_and(p.polcmd='*' AND p.polpermissive AND p.polroles=ARRAY[0::oid] AND
    regexp_replace(pg_get_expr(p.polqual,p.polrelid),'\\s','','g')=CASE WHEN c.relname='swim_import_outcomes'
      THEN '((SELECTauth.uid()ASuid)=user_id)' ELSE '(auth.uid()=user_id)' END AND
    pg_get_expr(p.polqual,p.polrelid)=pg_get_expr(p.polwithcheck,p.polrelid))
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('swim_import_outcomes','swim_plan_rehab_bindings')) AS policies,
  (SELECT count(*)=19 AND bool_and(
    p.proowner=CASE WHEN p.proname='swim_confirm_import_outcome' THEN 'swim_writer'::regrole ELSE current_user::regrole END
    AND p.prosecdef=(p.proname='swim_confirm_import_outcome')
    AND p.proconfig=CASE WHEN p.proname='swim_import_outcomes_ready' THEN ARRAY['search_path=pg_catalog']
      WHEN p.proname='swim_confirm_import_outcome' THEN ARRAY['search_path=pg_catalog, public','row_security=on']
      ELSE ARRAY['search_path=pg_catalog, public'] END
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
    AND CASE WHEN p.proname=ANY($3::text[]) THEN has_function_privilege('authenticated',p.oid,'EXECUTE')
      WHEN p.proname='check_program_parent_consistency' THEN NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
      ELSE true END)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($2::text[]))
    AS functions`;

export async function verifyAddedModularSecurity(sql: postgres.Sql | postgres.TransactionSql) {
  const rows = await sql.unsafe(MODULAR_ADDED_SECURITY_SQL, [relations, functions, [
    "training_schedule_snapshot", "training_schedule_commit", "start_planned_session_atomically",
    "swim_import_outcomes_ready", "swim_confirm_import_outcome", "validate_owned_rehab_items", "independent_programs_ready",
    "independent_program_schedule_commit", "complete_program_if_settled", "commit_program_progression",
    "set_swim_rehab_bindings", "start_swim_rehab_session",
  ]]);
  requireInspection(rows.length === 1, "catalog_added_security_shape");
  for (const key of ["relations", "policies", "functions"] as const) {
    requireInspection(rows[0]![key] === true, `catalog_added_${key}_changed`);
  }
}
