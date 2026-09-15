import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { appendIdentityReview, inspectIdentityReview } from "../scripts/conditioning-identity-review-storage";

export async function exerciseConditioningIdentityAppend(database: postgres.Sql, preserve: () => Promise<void>) {
  const snapshot = () => database`SELECT to_jsonb(p) AS metadata FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid`;
  const policies = () => database`SELECT to_jsonb(p) AS metadata FROM pg_policy p ORDER BY p.oid`;
  const ledger = () => database`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
  const before = await snapshot(), beforePolicies = await policies(), beforeLedger = await ledger();
  await inspectIdentityReview(database, 158);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await ledger(), beforeLedger);
  let guards = 0;
  await assert.rejects(() => appendIdentityReview(database, async () => {
    if (++guards === 2) throw new Error("synthetic_identity_guard");
  }), /synthetic_identity_guard/);
  assert.equal(guards, 2);
  await inspectIdentityReview(database, 158);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await ledger(), beforeLedger);
  await preserve();
  await appendIdentityReview(database, async () => {});
  await inspectIdentityReview(database, 159);
  const afterLedger = await ledger(), after = await snapshot();
  assert.deepEqual(Array.from(afterLedger).slice(0, 158), Array.from(beforeLedger));
  assert.equal(afterLedger.length, 159);
  assert.deepEqual(await policies(), beforePolicies);
  await preserve();
  await assert.rejects(() => appendIdentityReview(database, async () => {}));
  assert.deepEqual(await ledger(), afterLedger);
  assert.deepEqual(await snapshot(), after);
  const down = readFileSync(new URL("../rollbacks/0158_conditioning_request_identity.down.sql", import.meta.url), "utf8")
    .replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "");
  await database.begin(async (tx) => {
    await tx.unsafe(down);
    // This ledger rewind is confined to the disposable service fixture.
    await tx`DELETE FROM drizzle.__drizzle_migrations WHERE id=${afterLedger[158]!.id}`;
  });
  await inspectIdentityReview(database, 158);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await ledger(), beforeLedger);
  assert.deepEqual(await policies(), beforePolicies);
  await preserve();
}

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
