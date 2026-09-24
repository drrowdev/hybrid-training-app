import type postgres from "postgres";
import { z } from "zod";
import { ProductionInspectionRefusal, requireInspection } from "./swim-production-readonly-guards";
import { MODULAR_CATALOG_MANIFEST } from "./modular-production-catalog-manifest";
import { MODULAR_RELEASE_MIGRATIONS } from "./modular-production-preflight-guards";

requireInspection(JSON.stringify(MODULAR_CATALOG_MANIFEST.migrations) === JSON.stringify(MODULAR_RELEASE_MIGRATIONS), "catalog_source");
export const MODULAR_ADDED_CATALOG_KEYS: readonly string[] = MODULAR_CATALOG_MANIFEST.keys;
const relations = MODULAR_ADDED_CATALOG_KEYS.filter((key) => key.startsWith("relation:public.")).map((key) => key.slice(16));
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
const difference = z.object({
  category: z.enum(["catalog", "global", "relations", "columns", "functions", "constraints", "indexes", "policies", "triggers"]),
  direction: z.enum(["missing", "unexpected", "changed"]),
}).strict();
export type ModularCatalogDiagnostic = z.infer<typeof difference>[];
export class ModularCatalogRefusal extends ProductionInspectionRefusal {
  readonly diagnostic: ModularCatalogDiagnostic;
  constructor(code: string, differences: ModularCatalogDiagnostic) {
    super(code);
    const unique = [...new Map(differences.map((item) => [`${item.category}:${item.direction}`, item])).values()];
    this.diagnostic = z.array(difference).min(1).max(27).parse(unique)
      .sort((a, b) => `${a.category}:${a.direction}`.localeCompare(`${b.category}:${b.direction}`));
  }
}
function category(key: string): ModularCatalogDiagnostic[number]["category"] {
  switch (key.split(":")[0]) {
    case "global": return "global";
    case "relation": return "relations";
    case "column": return "columns";
    case "function": return "functions";
    case "constraint": return "constraints";
    case "index": return "indexes";
    case "policy": return "policies";
    case "trigger": return "triggers";
    default: return "catalog";
  }
}
function requireCatalog(value: boolean, code: string, key: string, direction: ModularCatalogDiagnostic[number]["direction"] = "changed") {
  if (!value) throw new ModularCatalogRefusal(code, [{ category: category(key), direction }]);
}

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
  -- Raw argument-default trees contain parser positions, not just semantics.
  SELECT 'function:'||n.nspname||'.'||p.proname,
    jsonb_build_array(p.oid,pg_get_functiondef(p.oid)),
    (to_jsonb(p)-ARRAY['prosrc','probin','prosqlbody','proargdefaults']) ||
      jsonb_build_object('proargdefaults',pg_get_expr(p.proargdefaults,0)),NULL::text
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
const rowsFor = (rows: ModularCatalog, key: string) => rows.filter((row) => row.key === key);
export function requireModularCatalogBaseline(before: ModularCatalog) {
  requireInspection(before.every((row) => !MODULAR_ADDED_CATALOG_KEYS.includes(row.key)), "catalog_baseline");
  requireInspection([...MODULAR_CHANGED_FUNCTIONS, ...MODULAR_REMOVED_INDEXES, ...Object.keys(MODULAR_CHANGED_CONSTRAINTS)]
    .every((key) => rowsFor(before, key).length === 1), "catalog_baseline");
}
export function verifyModularCatalog(before: ModularCatalog, after: ModularCatalog) {
  requireModularCatalogBaseline(before);
  for (const key of new Set(before.map((row) => row.key))) {
    const previous = rowsFor(before, key), current = rowsFor(after, key);
    if (MODULAR_REMOVED_INDEXES.includes(key)) {
      requireCatalog(current.length === 0, "catalog_index_changed", key, "unexpected");
    } else if (MODULAR_CHANGED_FUNCTIONS.includes(key)) {
      requireCatalog(current.length === 1 && previous[0]!.security === current[0]!.security, "catalog_function_security_changed", key);
    } else if (Object.hasOwn(MODULAR_CHANGED_CONSTRAINTS, key)) {
      requireCatalog(current.length === 1 && current[0]!.definition === MODULAR_CHANGED_CONSTRAINTS[key], "catalog_constraint_changed", key);
    } else {
      requireCatalog(JSON.stringify(previous) === JSON.stringify(current), "catalog_existing_changed", key,
        current.length < previous.length ? "missing" : current.length > previous.length ? "unexpected" : "changed");
    }
  }
  const existing = new Set(before.map((row) => row.key));
  const additions = after.filter((row) => !existing.has(row.key));
  const differences: ModularCatalogDiagnostic = [];
  for (const key of new Set([...MODULAR_ADDED_CATALOG_KEYS, ...additions.map((row) => row.key)])) {
    const expected = MODULAR_ADDED_CATALOG_KEYS.includes(key) ? 1 : 0;
    const actual = rowsFor(additions, key).length;
    if (actual !== expected) differences.push({ category: category(key), direction: actual < expected ? "missing" : "unexpected" });
  }
  if (differences.length) throw new ModularCatalogRefusal("catalog_additions_changed", differences);
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
  (SELECT count(*)=jsonb_array_length($2::jsonb) AND bool_and(
    p.proowner=CASE WHEN expected.owner='current_user' THEN current_user::regrole ELSE expected.owner::regrole END
    AND p.prosecdef=expected.definer AND p.proconfig=expected.config
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
    AND CASE WHEN p.proname=ANY($3::text[]) THEN has_function_privilege('authenticated',p.oid,'EXECUTE')
      WHEN p.proname='check_program_parent_consistency' THEN NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
      ELSE true END)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN jsonb_to_recordset($2::jsonb) AS expected(name text,owner text,definer boolean,config text[]) ON expected.name=p.proname
    WHERE n.nspname='public')
    AS functions`;

export async function verifyAddedModularSecurity(sql: postgres.Sql | postgres.TransactionSql) {
  const functions = MODULAR_CATALOG_MANIFEST.functions.map((entry) => ({ ...entry, config: [...entry.config] }));
  const rows = await sql.unsafe(MODULAR_ADDED_SECURITY_SQL, [relations, sql.json(functions), [
    "training_schedule_snapshot", "training_schedule_commit", "start_planned_session_atomically",
    "swim_import_outcomes_ready", "swim_confirm_import_outcome", "validate_owned_rehab_items", "independent_programs_ready",
    "independent_program_schedule_commit", "complete_program_if_settled", "commit_program_progression",
    "set_swim_rehab_bindings", "start_swim_rehab_session",
  ]]);
  requireInspection(rows.length === 1, "catalog_added_security_shape");
  for (const key of ["relations", "policies", "functions"] as const) {
    if (rows[0]![key] !== true) throw new ModularCatalogRefusal(`catalog_added_${key}_changed`, [{ category: key, direction: "changed" }]);
  }
}
