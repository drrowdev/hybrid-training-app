import { z } from "zod";
import type { ProcessResult } from "./swim-acceptance-guards";
import { acceptanceAssert, type AcceptanceReporting } from "./swim-acceptance-reporting";

export type IdentityLevel = 146 | 147 | 148;
export const SHARED_COMPLETION_BODY_PINS = {
  original: "7d123bec0bbca374ea5ddad133640d86ff46ee3e36d6b00611a9d8d1d76b4a4d",
  amended: "cca40717ed9133607ea0706838ed999beea84af6a90336c66f61abe8b1690b3d",
} as const;

// Pinned prosrc MD5 equality checks from 0145/0146, not caller-supplied expectations.
export const SWIM_FUNCTION_CONTRACTS = [
  ["swim_local_today", "", "sql", "s", false, "da547ef0a54753f58484457237a6b261", "aa9c18164e2953f79526d00298e5557a"],
  ["swim_assert_start_safety", "jsonb", "plpgsql", "v", false, "a4a6e14ba9beff435e9d0f4bb8289d3b", "9590a28ad178ea631a561bf4666acb76"],
  ["swim_create_plan", "date,date,jsonb,jsonb,jsonb", "plpgsql", "v", true, "189b523e5aaa22bc021ac967370792b9", "732a84239559ea42cddfa92b34e76008"],
  ["swim_start_workout", "uuid,integer", "plpgsql", "v", true, "56ddb7e24af67490f11f3c48a209de94", "34d72608d4b43c45f048d92c33f17b98"],
  ["swim_set_plan_status", "uuid,integer,text", "plpgsql", "v", true, "ceac4e04200bf815e803fc426392117e", "cc013c6a3475b421ab1d49ed9284fc42"],
  ["swim_skip_workout", "uuid,integer,text", "plpgsql", "v", true, "b65003b0ee45a9fd293188115d043533", "9d52fa2a62e73d40b3c55653b07ae71a"],
  ["swim_update_plan", "uuid,integer,jsonb,jsonb,jsonb", "plpgsql", "v", true, "d1d79b3b03af189a8a7138d299edbac8", "4213a780ac7e9b5f82b1e2f76b54e406"],
  ["swim_resume_plan", "uuid,integer,jsonb,jsonb,jsonb", "plpgsql", "v", true, "82a35ffbf86d9eb0cfa2ad689a99471b", "831b4fb8761890802adda635e185bbe1"],
  ["swim_complete_workout", "uuid,integer,jsonb,uuid,uuid,text,boolean", "plpgsql", "v", true, "f0c0c34bc65e1c222740d8cb929e5dfb", "360c98a1f8f63e0fd9fe137fdde032ce"],
  ["swim_edit_result", "uuid,integer,jsonb,text,boolean,boolean", "plpgsql", "v", true, "05a6f31b63d82c444f26567709ba1d91", "76bde3a44c3887a59d70187debc9e73a"],
] as const;

// Tuple positions: fixed name, attributes match, original body match, up body match.
const functionEvidence = z.array(z.tuple([z.enum([
  "swim_local_today", "swim_assert_start_safety", "swim_create_plan", "swim_start_workout",
  "swim_set_plan_status", "swim_skip_workout", "swim_update_plan", "swim_resume_plan",
  "swim_complete_workout", "swim_edit_result",
]), z.boolean(), z.boolean(), z.boolean()])).length(10).refine(
  (entries) => new Set(entries.map(([name]) => name)).size === 10,
);
// Present: attributes/body match, effective writer/service/anon/authenticated EXECUTE,
// PUBLIC EXECUTE ACL entry, other non-owner direct grantee. Absence retains all other evidence.
const helperEvidence = z.union([
  z.tuple([z.literal("absent")]),
  z.tuple([z.literal("present"), z.boolean(), z.boolean(), z.boolean(),
    z.boolean(), z.boolean(), z.boolean(), z.boolean(), z.boolean(), z.boolean()]),
]);

const sharedEvidence = z.object({
  attributes: z.boolean(), original: z.boolean(), amended: z.boolean(),
  originalAcl: z.boolean(), amendedAcl: z.boolean(),
  authenticated: z.boolean(), service: z.boolean(), writer: z.boolean(), owner: z.boolean(),
  anon: z.boolean(), public: z.boolean(),
}).strict();

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
  serviceRoleAuthUsage: z.boolean(),
  serviceRoleAuthUidExecute: z.boolean(),
  serviceRoleLocalTodayExecute: z.boolean(),
  serviceRoleSafetyExecute: z.boolean(),
  helper: helperEvidence,
  shared: sharedEvidence,
  functions: functionEvidence,
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
    pg_catalog.to_regprocedure('public.swim_create_plan(date,date,jsonb,jsonb,jsonb)')::oid AS create_plan,
    pg_catalog.to_regrole('service_role')::oid AS service,
    pg_catalog.to_regrole('anon')::oid AS anon,
    pg_catalog.to_regrole('authenticated')::oid AS authenticated,
    pg_catalog.to_regprocedure('public.swim_request_user_id()')::oid AS helper,
    pg_catalog.to_regprocedure('public.complete_training_session_with_transition(uuid,text,uuid)')::oid AS shared,
    pg_catalog.to_regprocedure('public.swim_local_today()')::oid AS today,
    pg_catalog.to_regprocedure('public.swim_assert_start_safety(jsonb)')::oid AS safety
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
    ELSE 'other' END),
  pg_catalog.json_build_array('serviceRoleAuthUsage',
    CASE WHEN refs.service IS NOT NULL AND auth.oid IS NOT NULL
      THEN pg_catalog.has_schema_privilege(refs.service, auth.oid, 'USAGE') END),
  pg_catalog.json_build_array('serviceRoleAuthUidExecute',
    CASE WHEN refs.service IS NOT NULL AND uid.oid IS NOT NULL
      THEN pg_catalog.has_function_privilege(refs.service, uid.oid, 'EXECUTE') END),
  pg_catalog.json_build_array('serviceRoleLocalTodayExecute',
    CASE WHEN refs.service IS NOT NULL AND refs.today IS NOT NULL
      THEN pg_catalog.has_function_privilege(refs.service, refs.today, 'EXECUTE') END),
  pg_catalog.json_build_array('serviceRoleSafetyExecute',
    CASE WHEN refs.service IS NOT NULL AND refs.safety IS NOT NULL
      THEN pg_catalog.has_function_privilege(refs.service, refs.safety, 'EXECUTE') END),
  pg_catalog.json_build_array('helper', CASE
    WHEN helper_count.count = 0 THEN pg_catalog.json_build_array('absent')
    WHEN helper_count.count <> 1 OR helper.oid IS NULL OR helper_lang.oid IS NULL
      OR refs.postgres IS NULL OR refs.swim_writer IS NULL OR refs.service IS NULL
      OR refs.anon IS NULL OR refs.authenticated IS NULL THEN NULL
    ELSE pg_catalog.json_build_array('present',
      helper.proowner = refs.postgres AND helper.pronargs = 0 AND NOT helper.proretset
        AND helper.proallargtypes IS NULL
        AND helper.prorettype = 'pg_catalog.uuid'::pg_catalog.regtype
        AND helper_lang.lanname = 'sql' AND helper.provolatile = 's'
        AND helper.prosecdef AND NOT helper.proleakproof
        AND NOT helper.proisstrict AND helper.proparallel = 'u'
        AND helper.pronargdefaults = 0 AND helper.proargdefaults IS NULL
        AND helper.proargtypes = ''::pg_catalog.oidvector
        AND helper.proargmodes IS NULL AND helper.proargnames IS NULL
        AND helper.provariadic = 0 AND helper.prosupport = 0
        AND helper.probin IS NULL AND helper.prosqlbody IS NULL
        AND pg_catalog.has_function_privilege(refs.postgres, helper.oid, 'EXECUTE')
        AND COALESCE(helper.proconfig = ARRAY['search_path=pg_catalog']::text[], false)
        AND helper.prosrc = ' SELECT auth.uid() ',
      pg_catalog.has_function_privilege(refs.swim_writer, helper.oid, 'EXECUTE'),
      pg_catalog.has_function_privilege(refs.service, helper.oid, 'EXECUTE'),
      pg_catalog.has_function_privilege(refs.anon, helper.oid, 'EXECUTE'),
      pg_catalog.has_function_privilege(refs.authenticated, helper.oid, 'EXECUTE'),
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
        COALESCE(helper.proacl, pg_catalog.acldefault('f', helper.proowner))) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'),
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
        COALESCE(helper.proacl, pg_catalog.acldefault('f', helper.proowner))) acl
        WHERE acl.grantee NOT IN (helper.proowner, refs.swim_writer, refs.service, refs.authenticated)),
      ${[false, true].map((amended) => `(
        SELECT COALESCE(
          array_agg(acl.grantee ORDER BY acl.grantee) = (
            SELECT array_agg(grantee ORDER BY grantee)
            FROM unnest(ARRAY[refs.postgres, refs.service, refs.swim_writer${amended ? ", refs.authenticated" : ""}]) grantee)
          AND bool_and(acl.grantor = refs.postgres AND acl.privilege_type = 'EXECUTE' AND NOT acl.is_grantable), false)
        FROM pg_catalog.aclexplode(COALESCE(helper.proacl, pg_catalog.acldefault('f', helper.proowner))) acl
      )`).join(",\n")}
    ) END),
  pg_catalog.json_build_array('shared', CASE
    WHEN shared.oid IS NULL OR shared_lang.oid IS NULL OR refs.postgres IS NULL
      OR refs.authenticated IS NULL OR refs.service IS NULL OR refs.swim_writer IS NULL
      OR refs.anon IS NULL THEN NULL
    ELSE pg_catalog.json_build_array(
      pg_catalog.json_build_array('attributes',
        shared.proowner = refs.postgres AND shared_lang.lanname = 'plpgsql'
        AND shared.provolatile = 'v' AND NOT shared.prosecdef AND NOT shared.proleakproof
        AND NOT shared.proisstrict AND shared.proparallel = 'u'
        AND shared.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[]
        AND shared.pronargs = 3 AND shared.pronargdefaults = 1
        AND pg_catalog.pg_get_expr(shared.proargdefaults, 0) IS NOT DISTINCT FROM 'NULL::uuid'
        AND shared.proargtypes = '2950 25 2950'::pg_catalog.oidvector
        AND shared.proallargtypes IS NOT DISTINCT FROM ARRAY[2950,25,2950,2950,16]::oid[]
        AND shared.proargmodes IS NOT DISTINCT FROM ARRAY['i','i','i','t','t']::"char"[]
        AND shared.proargnames IS NOT DISTINCT FROM ARRAY['p_session_id','p_notes','p_completion_entry_id','user_id','transitioned']::text[]
        AND shared.prorettype = 'record'::pg_catalog.regtype AND shared.proretset
        AND shared.provariadic = 0 AND shared.prosupport = 0
        AND shared.probin IS NULL AND shared.prosqlbody IS NULL),
      pg_catalog.json_build_array('original', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(shared.prosrc, 'UTF8')), 'hex') = '${SHARED_COMPLETION_BODY_PINS.original}'),
      pg_catalog.json_build_array('amended', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(shared.prosrc, 'UTF8')), 'hex') = '${SHARED_COMPLETION_BODY_PINS.amended}'),
      ${[false, true].map((amended) => `pg_catalog.json_build_array('${amended ? "amendedAcl" : "originalAcl"}', (
        SELECT COALESCE(
          array_agg(acl.grantee ORDER BY acl.grantee) = (
            SELECT array_agg(grantee ORDER BY grantee)
            FROM unnest(ARRAY[refs.postgres, refs.authenticated, refs.service, refs.swim_writer${amended ? "" : ", 0::oid"}]) grantee)
          AND bool_and(acl.grantor = refs.postgres AND acl.privilege_type = 'EXECUTE' AND NOT acl.is_grantable), false)
        FROM pg_catalog.aclexplode(COALESCE(shared.proacl, pg_catalog.acldefault('f', shared.proowner))) acl
      ))`).join(",\n")},
      pg_catalog.json_build_array('authenticated', pg_catalog.has_function_privilege(refs.authenticated, shared.oid, 'EXECUTE')),
      pg_catalog.json_build_array('service', pg_catalog.has_function_privilege(refs.service, shared.oid, 'EXECUTE')),
      pg_catalog.json_build_array('writer', pg_catalog.has_function_privilege(refs.swim_writer, shared.oid, 'EXECUTE')),
      pg_catalog.json_build_array('owner', pg_catalog.has_function_privilege(refs.postgres, shared.oid, 'EXECUTE')),
      pg_catalog.json_build_array('anon', pg_catalog.has_function_privilege(refs.anon, shared.oid, 'EXECUTE')),
      pg_catalog.json_build_array('public', EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
        COALESCE(shared.proacl, pg_catalog.acldefault('f', shared.proowner))) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'))
    ) END),
  pg_catalog.json_build_array('functions', pg_catalog.json_build_array(
    ${SWIM_FUNCTION_CONTRACTS.map(([name, args, language, volatility, definer, original, up]) => `(
      SELECT CASE WHEN f.oid IS NULL OR l.oid IS NULL OR refs.swim_writer IS NULL THEN NULL
        ELSE pg_catalog.json_build_array('${name}',
          f.proowner = refs.swim_writer AND l.lanname = '${language}'
          AND NOT f.proretset
          AND f.prorettype = 'pg_catalog.${name === "swim_local_today" ? "date" : name === "swim_assert_start_safety" ? "void" : "jsonb"}'::pg_catalog.regtype
          AND f.provolatile = '${volatility}' AND f.prosecdef = ${definer}
          AND NOT f.proleakproof
          AND COALESCE(f.proconfig @> ARRAY['search_path=pg_catalog, public'${definer ? ", 'row_security=on'" : ""}]::text[]
            AND f.proconfig <@ ARRAY['search_path=pg_catalog, public'${definer ? ", 'row_security=on'" : ""}]::text[]
            AND pg_catalog.cardinality(f.proconfig) = ${definer ? 2 : 1}, false),
          pg_catalog.md5(f.prosrc) = '${original}', pg_catalog.md5(f.prosrc) = '${up}') END
      FROM (SELECT pg_catalog.to_regprocedure('public.${name}(${args})')::oid AS oid) exact
      LEFT JOIN pg_catalog.pg_proc f ON f.oid = exact.oid AND f.prokind = 'f'
      LEFT JOIN pg_catalog.pg_language l ON l.oid = f.prolang
    )`).join(",\n    ")}
  ))
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
LEFT JOIN pg_catalog.pg_proc helper ON helper.oid = refs.helper AND helper.prokind = 'f'
LEFT JOIN pg_catalog.pg_language helper_lang ON helper_lang.oid = helper.prolang
LEFT JOIN pg_catalog.pg_proc shared ON shared.oid = refs.shared AND shared.prokind = 'f'
LEFT JOIN pg_catalog.pg_language shared_lang ON shared_lang.oid = shared.prolang
LEFT JOIN LATERAL (
  SELECT count(*) AS count FROM pg_catalog.pg_proc f
  WHERE f.pronamespace = refs.public AND f.proname = 'swim_request_user_id'
) helper_count ON true
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
    const containsNull = (value: unknown): boolean =>
      value === null || (Array.isArray(value) && value.some(containsNull))
      || (typeof value === "object" && value !== null && Object.values(value).some(containsNull));
    if (parsed.data.some(([, value]) => containsNull(value))) return unavailable("missing-or-ambiguous-catalog");
    const input = Object.fromEntries(parsed.data);
    const shared = pairs.safeParse(input.shared);
    if (!shared.success || shared.data.length !== Object.keys(sharedEvidence.shape).length
      || new Set(shared.data.map(([key]) => key)).size !== shared.data.length) return unavailable("invalid-output");
    input.shared = Object.fromEntries(shared.data);
    const result = privileges.safeParse(input);
    return result.success ? { status: "available", observation: result.data } : unavailable("invalid-output");
  } catch {
    return unavailable("invalid-output");
  }
}

export type AuthBoundaryResult = "matched" | "unavailable" | "mismatched";

export function checkAuthBoundary(
  evidence: AuthPrivilegeEvidence, expected: IdentityLevel,
): AuthBoundaryResult {
  if (evidence.status !== "available") return "unavailable";
  const o = evidence.observation;
  if (![146, 147, 148].includes(expected)) return "mismatched";
  const helperMatches = expected === 146 ? o.helper[0] === "absent"
    : o.helper[0] === "present" && o.helper[1] && o.helper[2] && o.helper[3]
      && !o.helper[4] && o.helper[5] === (expected === 148) && !o.helper[6] && !o.helper[7]
      && o.helper[8] === (expected === 147) && o.helper[9] === (expected === 148);
  const s = o.shared;
  const sharedMatches = s.attributes && s.authenticated && s.service && s.writer && s.owner
    && s.original === (expected !== 148) && s.amended === (expected === 148)
    && s.originalAcl === (expected !== 148) && s.amendedAcl === (expected === 148)
    && s.anon === (expected !== 148) && s.public === (expected !== 148);
  return o.connectionRole === "postgres" && !o.swimWriterLogin && !o.swimWriterSuperuser
    && !o.swimWriterInherit && !o.swimWriterBypassRls && !o.swimWriterAuthUsage
    && o.swimWriterPublicUsage && o.serviceRoleAuthUsage && o.serviceRoleAuthUidExecute
    && o.serviceRoleLocalTodayExecute && o.serviceRoleSafetyExecute
    && o.swimCreatePlanOwner === "swim_writer" && o.swimCreatePlanSecurityDefiner
    && o.swimCreatePlanRowSecurity === "on" && helperMatches && sharedMatches
    && o.functions.every(([, attributes, original, up]) =>
      attributes && original === (expected === 146) && up === (expected !== 146))
    ? "matched" : "mismatched";
}

// The RPC stage records its own failure first. Never throw from a finally or mask it.
export async function enforceAuthBoundaryAfterRpc(
  boundary: AuthBoundaryResult, rpc: () => Promise<unknown>,
  reporting: Pick<AcceptanceReporting, "recordFailure">,
): Promise<void> {
  let failed = false;
  let primary: unknown;
  try { await rpc(); } catch (error) { failed = true; primary = error; }
  try {
    acceptanceAssert(boundary === "matched", "Swimming identity boundary unavailable or mismatched");
  } catch (error) {
    reporting.recordFailure("swimming identity boundary", error);
    if (!failed) throw error;
  }
  if (failed) throw primary;
}

export type PrivateCommand = (
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

// Private comparison material only: normalize default ACLs and entry ordering.
// Never attach these fingerprints to the public privilege observation/manifest.
export const SWIM_FUNCTION_ACLS_SQL = `
  BEGIN READ ONLY;
  SET LOCAL statement_timeout = '5s';
  SELECT pg_catalog.json_build_array(
    ${SWIM_FUNCTION_CONTRACTS.map(([name, args]) => `(
      SELECT pg_catalog.json_build_array('${name}', CASE WHEN f.oid IS NULL THEN NULL ELSE
        pg_catalog.md5(COALESCE((
          SELECT pg_catalog.json_agg(
            pg_catalog.json_build_array(a.grantor, a.grantee, a.privilege_type, a.is_grantable)
            ORDER BY a.grantor, a.grantee, a.privilege_type, a.is_grantable
          )::text FROM pg_catalog.aclexplode(
            COALESCE(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
        ), '[]')) END)
      FROM (SELECT pg_catalog.to_regprocedure('public.${name}(${args})')::oid AS oid) exact
      LEFT JOIN pg_catalog.pg_proc f ON f.oid = exact.oid AND f.prokind = 'f'
    )`).join(",\n")}
  );
  ROLLBACK;
  `;

export async function observeSwimFunctionAcls(command: PrivateCommand, dbId: string): Promise<string | null> {
  try {
    const { text, result } = await command("docker", [
      "exec", dbId, "psql", "-XqAt", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-c", SWIM_FUNCTION_ACLS_SQL,
    ], { capture: true, allowFailure: true, timeout: 10_000 });
    if (result.timedOut || result.code !== 0 || result.signal !== null) return null;
    const parsed = z.array(z.tuple([z.string(), z.string().regex(/^[a-f0-9]{32}$/)]))
      .length(SWIM_FUNCTION_CONTRACTS.length).safeParse(JSON.parse(text));
    if (!parsed.success || parsed.data.some(([name], index) => name !== SWIM_FUNCTION_CONTRACTS[index]![0])) return null;
    return JSON.stringify(parsed.data);
  } catch {
    return null;
  }
}
