import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { MigrationConfig, MigrationMeta } from "drizzle-orm/migrator";
import type postgres from "postgres";
import { migrateCanonical } from "../scripts/migration-runner.ts";
import { projectMigrationError } from "../scripts/migrate-evidence.ts";

// The two SQL fixtures are a proposal, not entries in the canonical journal.
const up = readFileSync(new URL("./fixtures/swim-import-outcomes.proposed.sql", import.meta.url), "utf8");
const down = readFileSync(new URL("./fixtures/swim-import-outcomes.proposed.down.sql", import.meta.url), "utf8");
const outcomeNames = ["swim_import_outcomes", "swim_current_import_outcomes"];
const functionNames = ["swim_confirm_import_outcome", "swim_import_outcomes_ready"];
const ledger = (sql: postgres.Sql) => sql`SELECT id,hash,created_at::text AS created_at
  FROM drizzle.__drizzle_migrations ORDER BY created_at,id`;

async function retainedCatalog(sql: postgres.Sql) {
  const [row] = await sql`SELECT encode(sha256(convert_to(jsonb_build_array(
    (SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity,
      c.relacl::text,c.reloptions) ORDER BY c.oid)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','v','m')
        AND NOT (n.nspname='public' AND c.relname=ANY(${outcomeNames}::text[]))),
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p
      WHERE p.polrelid IS DISTINCT FROM to_regclass('public.swim_import_outcomes')),
    (SELECT jsonb_agg(jsonb_build_array(oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,
      rolcanlogin,rolreplication,rolbypassrls) ORDER BY oid) FROM pg_roles),
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member) FROM pg_auth_members m),
    (SELECT jsonb_agg(jsonb_build_array(k.oid,pg_get_constraintdef(k.oid)) ORDER BY k.oid)
      FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace
      WHERE n.nspname IN ('public','auth') AND k.contype='f'
        AND k.conrelid IS DISTINCT FROM to_regclass('public.swim_import_outcomes')),
    (SELECT jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl::text)
      ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','auth') AND p.prokind IN ('f','p')
        AND NOT (n.nspname='public' AND p.proname=ANY(${functionNames}::text[]))),
    (SELECT jsonb_agg(jsonb_build_array(oid,nspowner,nspacl::text) ORDER BY oid)
      FROM pg_namespace WHERE nspname IN ('public','auth'))
    )::text,'UTF8')),'hex') AS fingerprint`;
  assert.match(String(row?.fingerprint), /^[a-f0-9]{64}$/);
  return String(row!.fingerprint);
}

async function assertAbsent(sql: postgres.Sql) {
  assert.equal((await sql`SELECT count(*)::int AS n FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(${outcomeNames}::text[])`)[0]!.n, 0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY(${functionNames}::text[])`)[0]!.n, 0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM pg_constraint
    WHERE conrelid='public.swim_import_matches'::regclass
      AND conname='swim_import_matches_owned_workout_id_key'`)[0]!.n, 0);
}

async function assertProposedBoundary(sql: postgres.Sql, stage: (name: string) => void) {
  stage("outcome-proposal-owner-policy");
  assert.equal((await sql`SELECT count(*)::int AS n FROM public.swim_import_outcomes`)[0]!.n, 0);
  const [table] = await sql`SELECT relrowsecurity, relforcerowsecurity
    FROM pg_class WHERE oid='public.swim_import_outcomes'::regclass`;
  assert.deepEqual({ ...table }, { relrowsecurity: true, relforcerowsecurity: false });
  const policies = await sql`SELECT polname,polcmd,polroles::text,
    pg_get_expr(polqual,polrelid) AS using_expression,
    pg_get_expr(polwithcheck,polrelid) AS check_expression
    FROM pg_policy WHERE polrelid='public.swim_import_outcomes'::regclass`;
  assert.equal(policies.length, 1);
  assert.equal(policies[0]!.polname, "swim_import_outcomes_owner");
  assert.equal(policies[0]!.polcmd, "*");
  assert.equal(policies[0]!.polroles, "{0}");
  const ownerPredicate = "((SELECTauth.uid()ASuid)=user_id)";
  assert.equal(String(policies[0]!.using_expression).replace(/\s+/g, ""), ownerPredicate);
  assert.equal(String(policies[0]!.check_expression).replace(/\s+/g, ""), ownerPredicate);
  assert.deepEqual((await sql`SELECT reloptions FROM pg_class
    WHERE oid='public.swim_current_import_outcomes'::regclass`)[0]!.reloptions, ["security_invoker=true"]);
  stage("outcome-proposal-role-grants");
  const grants = await sql`SELECT rolname,
    has_table_privilege(oid,'public.swim_import_outcomes','SELECT') AS read,
    has_table_privilege(oid,'public.swim_import_outcomes','INSERT') AS insert,
    has_table_privilege(oid,'public.swim_import_outcomes','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS other_write,
    has_table_privilege(oid,'public.swim_current_import_outcomes','SELECT') AS read_view,
    has_function_privilege(oid,'public.swim_confirm_import_outcome(uuid,uuid,uuid,text,uuid,integer)','EXECUTE') AS confirm,
    has_function_privilege(oid,'public.swim_import_outcomes_ready()','EXECUTE') AS ready
    FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','swim_writer') ORDER BY rolname`;
  assert.deepEqual(Array.from(grants, (row) => ({ ...row })), [
    { rolname: "anon", read: false, insert: false, other_write: false, read_view: false, confirm: false, ready: false },
    { rolname: "authenticated", read: true, insert: false, other_write: false, read_view: true, confirm: true, ready: true },
    { rolname: "service_role", read: false, insert: false, other_write: false, read_view: false, confirm: false, ready: false },
    { rolname: "swim_writer", read: true, insert: true, other_write: false, read_view: false, confirm: true, ready: false },
  ]);
  stage("outcome-proposal-function-identity");
  const [routine] = await sql`SELECT pg_get_userbyid(proowner) AS owner,prosecdef,proconfig
    FROM pg_proc WHERE oid='public.swim_confirm_import_outcome(uuid,uuid,uuid,text,uuid,integer)'::regprocedure`;
  assert.deepEqual({ ...routine }, {
    owner: "swim_writer", prosecdef: true, proconfig: ["search_path=pg_catalog, public", "row_security=on"],
  });
  stage("outcome-proposal-owned-foreign-keys");
  const foreignKeys = await sql`SELECT conname,convalidated,condeferrable,condeferred
    FROM pg_constraint WHERE conrelid='public.swim_import_outcomes'::regclass AND contype='f' ORDER BY conname`;
  assert.deepEqual(Array.from(foreignKeys, (row) => ({ ...row })), [
    { conname: "swim_import_outcomes_owned_match_fk", convalidated: true, condeferrable: true, condeferred: true },
    { conname: "swim_import_outcomes_owned_workout_fk", convalidated: true, condeferrable: true, condeferred: true },
    { conname: "swim_import_outcomes_user_id_fkey", convalidated: true, condeferrable: false, condeferred: false },
  ]);
}

export async function rehearseSwimOutcomeCompatibility(
  sql: postgres.Sql, migrations: readonly MigrationMeta[], config: MigrationConfig,
  stage: (name: string) => void,
): Promise<string[]> {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.platform, "linux");
  assert.deepEqual(sql.options.host, ["127.0.0.1"]);
  assert.deepEqual(sql.options.port, [5432]);
  assert.equal(sql.options.database, "swim_migration_runner_fresh");
  assert.equal(sql.options.max, 1);
  assert.equal((await sql`SELECT current_database() AS name`)[0]!.name, "swim_migration_runner_fresh");
  assert.equal((await sql`SELECT current_user AS actor`)[0]!.actor, "postgres");
  assert.equal((await sql`SELECT count(*)::int AS n FROM auth.users`)[0]!.n, 0);
  assert.equal(migrations.length, 157);
  await assertAbsent(sql);
  const before = await ledger(sql);
  assert.equal(before.length, 157);
  assert.deepEqual(before.map(({ hash, created_at }) => ({ hash, created_at })),
    migrations.map((migration) => ({ hash: migration.hash, created_at: String(migration.folderMillis) })));
  const retained = await retainedCatalog(sql);
  const hash = createHash("sha256").update(up).digest("hex");
  const proposed: MigrationMeta = {
    sql: ["SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'", up],
    hash, folderMillis: migrations[156]!.folderMillis + 1, bps: false,
  };
  const candidate = [...migrations, proposed];
  const refusalSql = "DO $$ BEGIN RAISE EXCEPTION 'Proposed append rollback' USING ERRCODE='P9003'; END $$;";
  stage("outcome-proposal-precommit-rollback");
  await assert.rejects(migrateCanonical(sql, [...candidate, {
    sql: ["SET LOCAL log_min_error_statement='panic'; SET LOCAL log_min_messages='panic'", refusalSql],
    hash: createHash("sha256").update(refusalSql).digest("hex"),
    folderMillis: proposed.folderMillis + 1, bps: false,
  }], config), (error: unknown) => {
    assert.equal(projectMigrationError(error, () => migrations).error.sqlstate, "P9003");
    return true;
  });
  assert.deepEqual(await ledger(sql), before);
  await assertAbsent(sql);
  assert.equal(await retainedCatalog(sql), retained);
  stage("outcome-proposal-main-compatible-append-and-replay");
  await migrateCanonical(sql, candidate, config);
  const appended = await ledger(sql);
  assert.equal(appended.length, 158);
  assert.deepEqual(appended.slice(0, 157), Array.from(before));
  assert.equal(appended[157]!.hash, hash);
  assert.equal(appended[157]!.created_at, String(proposed.folderMillis));
  assert.equal(await retainedCatalog(sql), retained);
  await assertProposedBoundary(sql, stage);
  stage("outcome-proposal-replay");
  await migrateCanonical(sql, candidate, config);
  assert.deepEqual(await ledger(sql), appended);
  stage("outcome-proposal-unused-down-up-retention");
  assert.match(down, /^BEGIN;\r?\n/);
  assert.match(down, /\r?\nCOMMIT;\r?\n?$/);
  const body = down.replace(/^BEGIN;\r?\n/, "").replace(/\r?\nCOMMIT;\r?\n?$/, "");
  await sql.begin((tx) => tx.unsafe(body));
  await assertAbsent(sql);
  assert.deepEqual(await ledger(sql), appended);
  assert.equal(await retainedCatalog(sql), retained);
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'");
    await tx.unsafe(up);
  });
  await assertProposedBoundary(sql, stage);
  stage("outcome-proposal-final-retention");
  assert.deepEqual(await ledger(sql), appended);
  assert.equal(await retainedCatalog(sql), retained);
  return ["outcome-proposal-atomic-rollback", "outcome-proposal-main-compatible-append-and-replay",
    "outcome-proposal-unused-down-up-retention"];
}
