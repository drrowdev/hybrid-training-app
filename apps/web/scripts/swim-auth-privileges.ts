import { z } from "zod";
import type { ProcessResult } from "./swim-acceptance-guards";

const owner = z.enum(["supabase_admin", "supabase_auth_admin", "postgres", "swim_writer", "other"]);
const privileges = z.object({
  connectionRole: z.enum(["postgres", "other"]),
  postgresSuperuser: z.boolean(),
  postgresInherit: z.boolean(),
  postgresMemberOfSupabaseAdmin: z.boolean(),
  postgresInheritsSupabaseAdmin: z.boolean(),
  postgresAuthUsage: z.boolean(),
  postgresAuthUsageGrantOption: z.boolean(),
  swimWriterAuthUsage: z.boolean(),
  swimWriterPublicUsage: z.boolean(),
  postgresAuthUidExecute: z.boolean(),
  swimWriterAuthUidExecute: z.boolean(),
  postgresAuthUidExecuteGrantOption: z.boolean(),
  authOwner: owner,
  authUidOwner: owner,
  swimCreatePlanOwner: owner,
  swimWriterLogin: z.boolean(),
  swimWriterSuperuser: z.boolean(),
  swimWriterInherit: z.boolean(),
  swimWriterBypassRls: z.boolean(),
  swimCreatePlanSecurityDefiner: z.boolean(),
  swimCreatePlanRowSecurity: z.enum(["on", "off", "absent", "other"]),
}).strict();

type UnavailableReason = "command-failed" | "timeout-or-output-limit" | "invalid-output" | "missing-or-ambiguous-catalog";
export type AuthPrivilegeEvidence =
  | { status: "available"; observation: z.infer<typeof privileges> }
  | { status: "unavailable"; reason: UnavailableReason };

// Fixed signatures and swim role: packages/db/drizzle/0145_standalone_pool_swimming.sql.
// Pairs preserve duplicate-field evidence that JSON object parsing would discard.
export const AUTH_PRIVILEGES_SQL = `
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
WITH refs AS (
  SELECT pg_catalog.to_regrole('postgres')::oid AS postgres,
    pg_catalog.to_regrole('swim_writer')::oid AS swim_writer,
    pg_catalog.to_regrole('supabase_admin')::oid AS supabase_admin,
    pg_catalog.to_regnamespace('auth')::oid AS auth,
    pg_catalog.to_regnamespace('public')::oid AS public,
    pg_catalog.to_regprocedure('auth.uid()')::oid AS uid,
    pg_catalog.to_regprocedure('public.swim_create_plan(date,date,jsonb,jsonb,jsonb)')::oid AS create_plan
)
SELECT pg_catalog.json_build_array(
  pg_catalog.json_build_array('connectionRole', CASE WHEN current_user = 'postgres' THEN 'postgres' ELSE 'other' END),
  pg_catalog.json_build_array('postgresSuperuser', postgres.rolsuper),
  pg_catalog.json_build_array('postgresInherit', postgres.rolinherit),
  pg_catalog.json_build_array('postgresMemberOfSupabaseAdmin',
    CASE WHEN postgres.oid IS NOT NULL AND admin.oid IS NOT NULL
      THEN pg_catalog.pg_has_role(postgres.oid, admin.oid, 'MEMBER') END),
  pg_catalog.json_build_array('postgresInheritsSupabaseAdmin',
    CASE WHEN postgres.oid IS NOT NULL AND admin.oid IS NOT NULL
      THEN pg_catalog.pg_has_role(postgres.oid, admin.oid, 'USAGE') END),
  pg_catalog.json_build_array('postgresAuthUsage',
    CASE WHEN postgres.oid IS NOT NULL AND auth.oid IS NOT NULL
      THEN pg_catalog.has_schema_privilege(postgres.oid, auth.oid, 'USAGE') END),
  pg_catalog.json_build_array('postgresAuthUsageGrantOption',
    CASE WHEN postgres.oid IS NOT NULL AND auth.oid IS NOT NULL
      THEN pg_catalog.has_schema_privilege(postgres.oid, auth.oid, 'USAGE WITH GRANT OPTION') END),
  pg_catalog.json_build_array('swimWriterAuthUsage',
    CASE WHEN writer.oid IS NOT NULL AND auth.oid IS NOT NULL
      THEN pg_catalog.has_schema_privilege(writer.oid, auth.oid, 'USAGE') END),
  pg_catalog.json_build_array('swimWriterPublicUsage',
    CASE WHEN writer.oid IS NOT NULL AND public.oid IS NOT NULL
      THEN pg_catalog.has_schema_privilege(writer.oid, public.oid, 'USAGE') END),
  pg_catalog.json_build_array('postgresAuthUidExecute',
    CASE WHEN postgres.oid IS NOT NULL AND uid.oid IS NOT NULL
      THEN pg_catalog.has_function_privilege(postgres.oid, uid.oid, 'EXECUTE') END),
  pg_catalog.json_build_array('swimWriterAuthUidExecute',
    CASE WHEN writer.oid IS NOT NULL AND uid.oid IS NOT NULL
      THEN pg_catalog.has_function_privilege(writer.oid, uid.oid, 'EXECUTE') END),
  pg_catalog.json_build_array('postgresAuthUidExecuteGrantOption',
    CASE WHEN postgres.oid IS NOT NULL AND uid.oid IS NOT NULL
      THEN pg_catalog.has_function_privilege(postgres.oid, uid.oid, 'EXECUTE WITH GRANT OPTION') END),
  pg_catalog.json_build_array('authOwner', CASE
    WHEN auth_owner.oid IS NULL THEN NULL
    WHEN auth_owner.rolname IN ('supabase_admin', 'supabase_auth_admin', 'postgres', 'swim_writer')
      THEN auth_owner.rolname ELSE 'other' END),
  pg_catalog.json_build_array('authUidOwner', CASE
    WHEN uid_owner.oid IS NULL THEN NULL
    WHEN uid_owner.rolname IN ('supabase_admin', 'supabase_auth_admin', 'postgres', 'swim_writer')
      THEN uid_owner.rolname ELSE 'other' END),
  pg_catalog.json_build_array('swimCreatePlanOwner', CASE
    WHEN plan_owner.oid IS NULL THEN NULL
    WHEN plan_owner.rolname IN ('supabase_admin', 'supabase_auth_admin', 'postgres', 'swim_writer')
      THEN plan_owner.rolname ELSE 'other' END),
  pg_catalog.json_build_array('swimWriterLogin', writer.rolcanlogin),
  pg_catalog.json_build_array('swimWriterSuperuser', writer.rolsuper),
  pg_catalog.json_build_array('swimWriterInherit', writer.rolinherit),
  pg_catalog.json_build_array('swimWriterBypassRls', writer.rolbypassrls),
  pg_catalog.json_build_array('swimCreatePlanSecurityDefiner', plan.prosecdef),
  pg_catalog.json_build_array('swimCreatePlanRowSecurity', CASE
    WHEN plan.oid IS NULL THEN NULL
    WHEN config.count = 0 THEN 'absent'
    WHEN config.count <> 1 OR config.value IS NULL THEN NULL
    WHEN config.value = 'row_security=on' THEN 'on'
    WHEN config.value = 'row_security=off' THEN 'off'
    ELSE 'other' END)
)
FROM refs
LEFT JOIN pg_catalog.pg_roles postgres ON postgres.oid = refs.postgres
LEFT JOIN pg_catalog.pg_roles writer ON writer.oid = refs.swim_writer
LEFT JOIN pg_catalog.pg_roles admin ON admin.oid = refs.supabase_admin
LEFT JOIN pg_catalog.pg_namespace auth ON auth.oid = refs.auth
LEFT JOIN pg_catalog.pg_namespace public ON public.oid = refs.public
LEFT JOIN pg_catalog.pg_proc uid ON uid.oid = refs.uid AND uid.prokind = 'f'
LEFT JOIN pg_catalog.pg_proc plan ON plan.oid = refs.create_plan AND plan.prokind = 'f'
LEFT JOIN pg_catalog.pg_roles auth_owner ON auth_owner.oid = auth.nspowner
LEFT JOIN pg_catalog.pg_roles uid_owner ON uid_owner.oid = uid.proowner
LEFT JOIN pg_catalog.pg_roles plan_owner ON plan_owner.oid = plan.proowner
LEFT JOIN LATERAL (
  SELECT count(*) AS count, min(setting) AS value
  FROM pg_catalog.unnest(plan.proconfig) AS settings(setting)
  WHERE setting IS NULL OR pg_catalog.split_part(setting, '=', 1) = 'row_security'
) config ON true;
ROLLBACK;
`;

const unavailable = (reason: UnavailableReason): AuthPrivilegeEvidence => ({ status: "unavailable", reason });
const pairs = z.array(z.tuple([z.string(), z.unknown()]));

export function projectAuthPrivilegeOutput(text: string): AuthPrivilegeEvidence {
  try {
    const parsed = pairs.safeParse(JSON.parse(text));
    if (!parsed.success) return unavailable("invalid-output");
    const keys = parsed.data.map(([key]) => key);
    if (keys.length !== Object.keys(privileges.shape).length || new Set(keys).size !== keys.length ||
        keys.some((key) => !Object.hasOwn(privileges.shape, key))) return unavailable("invalid-output");
    if (parsed.data.some(([, value]) => value === null)) return unavailable("missing-or-ambiguous-catalog");
    const result = privileges.safeParse(Object.fromEntries(parsed.data));
    return result.success ? { status: "available", observation: result.data } : unavailable("invalid-output");
  } catch {
    return unavailable("invalid-output");
  }
}

type PrivateCommand = (
  executable: string, args: string[], options: { capture: true; allowFailure: true; timeout: number },
) => Promise<{ text: string; result: ProcessResult }>;

export async function observeAuthPrivileges(command: PrivateCommand, dbId: string): Promise<AuthPrivilegeEvidence> {
  try {
    const { text, result } = await command("docker", [
      "exec", dbId, "psql", "-XqAt", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-c", AUTH_PRIVILEGES_SQL,
    ], { capture: true, allowFailure: true, timeout: 10_000 });
    // The existing command cap terminates the child and sets timedOut on overflow.
    if (result.timedOut) return unavailable("timeout-or-output-limit");
    if (result.code !== 0 || result.signal !== null) return unavailable("command-failed");
    return projectAuthPrivilegeOutput(text);
  } catch {
    return unavailable("command-failed");
  }
}
