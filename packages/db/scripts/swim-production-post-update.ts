import { z } from "zod";
import { MIGRATION_DIAGNOSTIC_FIELDS } from "./migrate-evidence";
import { requireInspection } from "./swim-production-readonly-guards";
import { PRODUCTION_SWIM_BASELINE, type productionHistoryInventory, type productionSchemaInventory } from "./swim-production-reconciliation";

export const SHARED_PRE_FIELDS = MIGRATION_DIAGNOSTIC_FIELDS.attributes.slice(2, 25);
export const SHARED_ACL_ROLES = ["postgres", "authenticated", "service_role", "anon", "public", "swim_writer", "other"] as const;
export const SHARED_PRIVILEGE_ROLES = ["postgres", "authenticated", "service_role", "anon"] as const;

export const POST_UPDATE_CATALOG_SQL = `
WITH roles AS (
  SELECT
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres') AS owner,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated') AS authenticated,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role') AS service,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='anon') AS anon,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='swim_writer') AS writer
), shared AS (
  SELECT p.* FROM pg_catalog.pg_proc p
  WHERE p.oid=pg_catalog.to_regprocedure('public.complete_training_session_with_transition(uuid,text,uuid)')
), acl AS (
  SELECT a.* FROM shared p
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
), defaults AS (
  SELECT a.* FROM pg_catalog.pg_default_acl d
  CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
  CROSS JOIN roles r
  WHERE d.defaclrole=r.owner AND d.defaclobjtype='f'
    AND d.defaclnamespace IN (0::oid,pg_catalog.to_regnamespace('public')::oid)
)
SELECT
  EXISTS (SELECT 1 FROM shared) AS shared_present,
  r.writer IS NOT NULL AS writer_present,
  EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND (left(c.relname,5)='swim_' OR c.relname='sessions_user_id_id_key')) AS swim_objects,
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND left(p.proname,5)='swim_') AS swim_routines,
  (SELECT ARRAY[
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')
      IS NOT DISTINCT FROM '7d123bec0bbca374ea5ddad133640d86ff46ee3e36d6b00611a9d8d1d76b4a4d',
    p.proowner IS NOT DISTINCT FROM r.owner,
    p.prolang IS NOT DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql'),
    p.prokind IS NOT DISTINCT FROM 'f',
    p.provolatile IS NOT DISTINCT FROM 'v',
    p.prosecdef IS NOT DISTINCT FROM false,
    p.proleakproof IS NOT DISTINCT FROM false,
    p.proisstrict IS NOT DISTINCT FROM false,
    p.proparallel IS NOT DISTINCT FROM 'u',
    p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[],
    p.pronargs IS NOT DISTINCT FROM 3::smallint,
    p.pronargdefaults IS NOT DISTINCT FROM 1::smallint,
    pg_catalog.pg_get_expr(p.proargdefaults,0) IS NOT DISTINCT FROM 'NULL::uuid',
    p.proargtypes IS NOT DISTINCT FROM '2950 25 2950'::pg_catalog.oidvector,
    p.proallargtypes IS NOT DISTINCT FROM ARRAY[2950,25,2950,2950,16]::oid[],
    p.proargmodes IS NOT DISTINCT FROM ARRAY['i','i','i','t','t']::"char"[],
    p.proargnames IS NOT DISTINCT FROM ARRAY['p_session_id','p_notes','p_completion_entry_id','user_id','transitioned']::text[],
    p.prorettype IS NOT DISTINCT FROM 'record'::pg_catalog.regtype,
    p.proretset IS NOT DISTINCT FROM true,
    p.provariadic IS NOT DISTINCT FROM 0::oid,
    p.prosupport IS NOT DISTINCT FROM 0::pg_catalog.regproc,
    p.probin IS NULL, p.prosqlbody IS NULL
  ] FROM shared p) AS shared_attributes,
  ARRAY[
    (SELECT count(*)::integer FROM acl WHERE grantee=r.owner),
    (SELECT count(*)::integer FROM acl WHERE grantee=r.authenticated),
    (SELECT count(*)::integer FROM acl WHERE grantee=r.service),
    (SELECT count(*)::integer FROM acl WHERE grantee=r.anon),
    (SELECT count(*)::integer FROM acl WHERE grantee=0),
    (SELECT count(*)::integer FROM acl WHERE grantee=r.writer),
    (SELECT count(*)::integer FROM acl
      WHERE NOT(grantee=ANY(pg_catalog.array_remove(ARRAY[r.owner,r.authenticated,r.service,r.anon,0::oid,r.writer],NULL))))
  ] AS shared_acl_counts,
  (SELECT bool_and(grantor=r.owner AND privilege_type='EXECUTE' AND NOT is_grantable) FROM acl) AS shared_acl_options,
  (SELECT ARRAY[
    pg_catalog.has_function_privilege(r.owner,p.oid,'EXECUTE'),
    pg_catalog.has_function_privilege(r.authenticated,p.oid,'EXECUTE'),
    pg_catalog.has_function_privilege(r.service,p.oid,'EXECUTE'),
    pg_catalog.has_function_privilege(r.anon,p.oid,'EXECUTE')
  ] FROM shared p) AS shared_privileges,
  (SELECT count(*)::integer FROM defaults
    WHERE NOT(grantee=ANY(pg_catalog.array_remove(ARRAY[r.owner,r.authenticated,r.service,r.anon,0::oid],NULL)))) AS other_default_grants,
  (SELECT count(*)::integer FROM defaults WHERE is_grantable) AS default_grant_options
FROM roles r`;

export function productionCompletionCatalog(raw: unknown) {
  const count = z.number().int().min(0).max(128);
  const parsed = z.array(z.object({
    shared_present: z.boolean(), writer_present: z.boolean(), swim_objects: z.boolean(), swim_routines: z.boolean(),
    shared_attributes: z.array(z.boolean()).length(SHARED_PRE_FIELDS.length).nullable(),
    shared_acl_counts: z.array(count).length(SHARED_ACL_ROLES.length),
    shared_acl_options: z.boolean().nullable(),
    shared_privileges: z.array(z.boolean().nullable()).length(SHARED_PRIVILEGE_ROLES.length).nullable(),
    other_default_grants: count, default_grant_options: count,
  }).strict()).length(1).safeParse(raw);
  requireInspection(parsed.success, "post_update_shape");
  return parsed.data[0]!;
}

export function productionPostUpdateInventory(raw: unknown,
  history: Pick<ReturnType<typeof productionHistoryInventory>, "complete" | "rowsRead" | "fingerprint">,
  schema: ReturnType<typeof productionSchemaInventory>) {
  const row = productionCompletionCatalog(raw);
  const historyUnchanged = history.complete && history.rowsRead === PRODUCTION_SWIM_BASELINE.entries &&
    history.fingerprint === PRODUCTION_SWIM_BASELINE.fingerprint;
  const schemaRestored = !row.writer_present && !row.swim_objects && !row.swim_routines &&
    schema.tables.every((entry) => !entry.present) && schema.functions.every((entry) => entry.definitions === 0) &&
    !schema.shared.swim_result && schema.shared.completion_body === "before" &&
    schema.shared.movement_keys?.length === 2 && new Set(schema.shared.movement_keys.map((entry) => entry.name)).size === 2 &&
    schema.shared.movement_keys.every((entry) => entry.validated && !entry.deferrable && !entry.deferred && entry.deleteAction === "r");
  return {
    historyUnchanged, schemaRestored, rollbackVerified: historyUnchanged && schemaRestored,
    sharedPresent: row.shared_present,
    sharedAttributes: row.shared_attributes === null ? null : Object.fromEntries(
      SHARED_PRE_FIELDS.map((name, index) => [name, row.shared_attributes![index]])),
    sharedAclCounts: Object.fromEntries(SHARED_ACL_ROLES.map((name, index) => [name, row.shared_acl_counts[index]])),
    sharedAclOptionsMatch: row.shared_acl_options,
    sharedPrivileges: row.shared_privileges === null ? null : Object.fromEntries(
      SHARED_PRIVILEGE_ROLES.map((name, index) => [name, row.shared_privileges![index]])),
    otherDefaultGrants: row.other_default_grants, defaultGrantOptions: row.default_grant_options,
    updaterRetryAuthorized: false,
  };
}
