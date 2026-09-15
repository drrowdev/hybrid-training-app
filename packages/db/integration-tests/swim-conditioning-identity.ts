import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type postgres from "postgres";

export async function exerciseConditioningIdentity(
  database: postgres.Sql, owner: string, mark: (stage: string) => void,
) {
  const up = readFileSync(new URL("../drizzle/0158_conditioning_request_identity.sql", import.meta.url), "utf8");
  const down = readFileSync(new URL("../rollbacks/0158_conditioning_request_identity.down.sql", import.meta.url), "utf8")
    .replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "");
  const snapshot = () => database`SELECT to_jsonb(p) AS metadata FROM pg_proc p
    WHERE p.oid IN (
      'public.swim_request_user_id()'::regprocedure,
      'public.deploy_program_instance_atomically(jsonb,jsonb,jsonb,jsonb)'::regprocedure,
      'public.swim_conditioning_replay(uuid,jsonb)'::regprocedure,
      'public.deploy_program_with_swimming(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
      'public.swim_change_conditioning(uuid,jsonb)'::regprocedure,
      'public.swim_lock_conditioning_program(uuid)'::regprocedure
    ) ORDER BY p.oid`;
  const probe = () => database.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: owner })}, true)`;
    await tx`SELECT * FROM public.deploy_program_with_swimming(null,null,null,null,null,null,null)`;
  });
  const denied = (message: string, code: string) => (error: unknown) =>
    error instanceof Error && error.message === message && "code" in error && error.code === code;
  mark("conditioning-identity-reproduce-managed-auth");
  // The service's synthetic auth schema is owned by postgres; hosted auth is not.
  await database.unsafe("REVOKE USAGE ON SCHEMA auth FROM conditioning_writer");
  assert.equal((await database`SELECT has_schema_privilege('conditioning_writer','auth','USAGE') AS allowed`)[0]!.allowed, false);
  await assert.rejects(probe, denied("permission denied for schema auth", "42501"));
  const before = await snapshot();
  const authBefore = await database`SELECT nspacl FROM pg_namespace WHERE nspname='auth'`;
  mark("conditioning-identity-guarded-repair");
  await database.begin((tx) => tx.unsafe(up));
  await assert.rejects(probe, denied("CONDITIONING_INVALID_REQUEST", "22023"));
  assert.deepEqual(await database`SELECT nspacl FROM pg_namespace WHERE nspname='auth'`, authBefore);
  const callers = await database`SELECT rolname,has_function_privilege(
    oid,'public.swim_request_user_id()','EXECUTE') AS allowed FROM pg_roles
    WHERE rolname IN ('anon','authenticated','service_role','swim_writer','conditioning_writer')`;
  assert.deepEqual(Object.fromEntries(callers.map((row) => [row.rolname, row.allowed])), {
    anon: false, authenticated: true, service_role: true, swim_writer: true, conditioning_writer: true,
  });
  const repaired = await snapshot();
  await assert.rejects(() => database.begin((tx) => tx.unsafe(up)), denied("CONDITIONING_IDENTITY_BASELINE", "P0001"));
  assert.deepEqual(await snapshot(), repaired);
  const revert = () => database.begin((tx) => tx.unsafe(down));
  mark("conditioning-identity-rollback-and-restore");
  await revert();
  assert.deepEqual(await snapshot(), before);
  await assert.rejects(probe, denied("permission denied for schema auth", "42501"));
  await database.begin((tx) => tx.unsafe(up));
  assert.deepEqual(await snapshot(), repaired);
  await assert.rejects(probe, denied("CONDITIONING_INVALID_REQUEST", "22023"));
  // All existing atomic save, lifecycle, history and two-owner cases now run
  // without managed-auth schema access for conditioning_writer.
  return revert;
}
