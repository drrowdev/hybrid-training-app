import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import postgres from "postgres";
import { z } from "zod";
import { migrateCanonical } from "../scripts/migration-runner.ts";
import { projectMigrationError } from "../scripts/migrate-evidence.ts";
import { rehearseSwimOutcomeCompatibility } from "./swim-outcome-compatibility-rehearsal.ts";

const execute = promisify(execFile);
const databases = ["swim_migration_runner_fresh", "swim_migration_runner_incremental"] as const;
const fixtureRoles = ["anon", "authenticated", "service_role", "swim_writer"] as const;
const config = { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) };
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const normalFailureSchema = z.object({
  scope: z.literal("db-migrate"), status: z.literal("failed"),
  diagnostic: z.object({
    error: z.object({ sqlstate: z.string().regex(/^[0-9A-Z]{5}$/).nullable() }),
    position: z.union([
      z.object({ status: z.literal("unmatched") }),
      z.object({ status: z.literal("matched"), migrationIndex: z.number().int().min(0).max(157),
        statementIndex: z.number().int().min(0).max(9999) }),
    ]),
  }),
});

export class MigrationRunnerRehearsalError extends Error {
  constructor(
    readonly diagnostic: { sqlstate: string | null; position: { status: "unmatched" } |
      { status: "matched"; migrationIndex: number; statementIndex: number } },
    cause: unknown,
    readonly cleanupFailed = false,
  ) {
    super("Normal migration rehearsal failed", { cause });
  }
}

const authFixture = `
  CREATE SCHEMA auth;
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT (NULLIF(current_setting('request.jwt.claims', true),'')::jsonb->>'sub')::uuid
  $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
`;

const settings = (client: postgres.Sql) => client`SELECT current_user AS actor, session_user AS session_actor,
  current_setting('role') AS role_setting,
  current_setting('search_path') AS path, current_setting('statement_timeout') AS statement_timeout,
  current_setting('lock_timeout') AS lock_timeout`;
const ledger = (client: postgres.Sql) => client`SELECT id,hash,created_at::text AS created_at
  FROM drizzle.__drizzle_migrations ORDER BY created_at,id`;
async function assertLedger(client: postgres.Sql, migrations: MigrationMeta[]) {
  const rows = await ledger(client);
  assert.deepEqual(rows.map(({ hash, created_at }) => ({ hash, created_at })),
    migrations.map((migration) => ({ hash: migration.hash, created_at: String(migration.folderMillis) })));
  return rows;
}
function synthetic(sql: string, when: number): MigrationMeta {
  return { sql: [sql], hash: createHash("sha256").update(sql).digest("hex"), folderMillis: when, bps: false };
}

async function normalCommand(url: string) {
  assert.equal(existsSync(new URL("../.env.local", import.meta.url)), false);
  const env = Object.fromEntries(["PATH", "HOME", "PNPM_HOME", "TMPDIR", "TEMP", "TMP"].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]!]] : []));
  try {
    const result = await execute("pnpm", ["run", "db:migrate"], {
      cwd: packageDirectory, env: { ...env, DATABASE_URL: url, PGSSLMODE: "disable" },
      timeout: 120_000, maxBuffer: 128 * 1024,
    });
    assert.ok(result.stdout.split(/\r?\n/).some((line) => {
      try { const value = JSON.parse(line); return value.scope === "db-migrate" && value.status === "passed"; }
      catch { return false; }
    }), "Normal migration success record missing");
  } catch (error) {
    if (error instanceof Error && "stderr" in error && typeof error.stderr === "string") {
      for (const line of error.stderr.split(/\r?\n/)) {
        let value: unknown;
        try { value = JSON.parse(line); } catch { continue; }
        const parsed = normalFailureSchema.safeParse(value);
        if (parsed.success) throw new MigrationRunnerRehearsalError({
          sqlstate: parsed.data.diagnostic.error.sqlstate, position: parsed.data.diagnostic.position,
        }, error);
      }
    }
    throw error;
  }
}

export async function rehearseMigrationRunner(
  admin: postgres.Sql, stage: (name: string) => void,
): Promise<string[]> {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.platform, "linux");
  assert.deepEqual(admin.options.host, ["127.0.0.1"]);
  assert.deepEqual(admin.options.port, [5432]);
  assert.equal(admin.options.database, "swim_pool_test");
  assert.equal((await admin`SELECT current_database() AS name`)[0]!.name, "swim_pool_test");
  const inventory = async () => ({
    databases: await admin`SELECT oid,datname,datdba FROM pg_catalog.pg_database ORDER BY oid`,
    roles: await admin`SELECT oid,rolname,rolsuper,rolinherit,rolcanlogin,rolbypassrls FROM pg_catalog.pg_roles ORDER BY oid`,
    memberships: await admin`SELECT roleid,member,grantor,admin_option,inherit_option,set_option
      FROM pg_catalog.pg_auth_members ORDER BY roleid,member,grantor`,
  });
  const original = await inventory();
  for (const name of databases) assert.ok(!original.databases.some((row) => row.datname === name));
  for (const name of fixtureRoles) assert.ok(!original.roles.some((row) => row.rolname === name));
  const migrations = readMigrationFiles(config);
  assert.equal(migrations.length, 159);
  const stages: string[] = [];
  for (const name of databases) {
    let client: postgres.Sql | undefined;
    let created = false;
    let primary: unknown;
    let failed = false;
    const cleanup: unknown[] = [];
    try {
      stage(`migration-runner-${name.endsWith("fresh") ? "fresh" : "incremental"}-fixture`);
      await admin`CREATE DATABASE ${admin(name)}`;
      created = true;
      const url = `postgres://postgres@127.0.0.1:5432/${name}`;
      client = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 5, idle_timeout: 5 });
      await client.begin((tx) => tx.unsafe(authFixture));
      if (name === databases[0]) {
        stage("migration-runner-reproduces-canonical-155-search-path-failure");
        const before = await settings(client);
        await assert.rejects(migrate(drizzle(client), config), (error: unknown) => {
          const projected = projectMigrationError(error, () => migrations);
          assert.equal(projected.error.sqlstate, "42704");
          assert.deepEqual(projected.position, { status: "matched", migrationIndex: 155, statementIndex: 0 });
          return true;
        });
        assert.equal((await ledger(client)).length, 0);
        assert.equal((await client`SELECT to_regclass('public.movements') AS value`)[0]!.value, null);
        assert.deepEqual(await settings(client), before);
        stages.push("migration-runner-canonical-155-failure-reproduced-and-rolled-back");
        stage("migration-runner-normal-command-full-159");
        await normalCommand(url);
        const rows = await assertLedger(client, migrations);
        assert.equal((await client`SELECT count(*)::int AS n FROM public.movements
          WHERE user_id IS NULL AND slug='hip-flexor-raise-kettlebell'`)[0]!.n, 1);
        assert.ok((await client`SELECT to_regprocedure('public.training_schedule_snapshot()') AS value`)[0]!.value);
        await normalCommand(url);
        assert.deepEqual(await ledger(client), rows);
        stages.push("migration-runner-normal-full-159-and-replay");
        stages.push(...await rehearseSwimOutcomeCompatibility(client, migrations, config, stage));
        assert.deepEqual(await settings(client), before);
      } else {
        stage("migration-runner-existing-ledger-prefix");
        await client.unsafe("SET ROLE postgres");
        await client`SELECT set_config('search_path','pg_catalog',false),
          set_config('statement_timeout','15000',false), set_config('lock_timeout','5000',false)`;
        const before = await settings(client);
        await migrateCanonical(client, migrations.slice(0, 150), config);
        const prefix = await assertLedger(client, migrations.slice(0, 150));
        assert.deepEqual(await settings(client), before);
        stage("migration-runner-precommit-failure-retains-prefix");
        const rollbackBatch = [
          ...migrations.slice(0, 151),
          synthetic(`
            DO $$ BEGIN
              IF current_schema() <> 'public' OR current_setting('search_path') <> 'public'
                OR (current_schemas(true))[1] <> 'pg_catalog'
                OR current_user <> 'postgres' OR length('ok') <> 2
                OR to_regclass('public.swim_connections') IS NULL
                OR (SELECT count(*) FROM drizzle.__drizzle_migrations) <> 151 THEN
                RAISE EXCEPTION 'Migration boundary proof failed' USING ERRCODE='P9002';
              END IF;
            END $$;
            CREATE TYPE migration_boundary_type AS ENUM ('proof');
            CREATE TABLE migration_boundary_table (value migration_boundary_type);
            DO $$ BEGIN
              IF to_regtype('public.migration_boundary_type') IS NULL
                OR to_regclass('public.migration_boundary_table') IS NULL THEN
                RAISE EXCEPTION 'Migration namespace proof failed' USING ERRCODE='P9002';
              END IF;
            END $$;
          `, migrations[150]!.folderMillis + 1),
          synthetic("DO $$ BEGIN RAISE EXCEPTION 'Synthetic precommit refusal' USING ERRCODE='P9001'; END $$;",
            migrations[150]!.folderMillis + 2),
        ];
        await assert.rejects(migrateCanonical(client, rollbackBatch, config), (error: unknown) => {
          const projected = projectMigrationError(error, () => rollbackBatch);
          assert.equal(projected.error.sqlstate, "P9001");
          assert.deepEqual(projected.position, { status: "matched", migrationIndex: 152, statementIndex: 0 });
          return true;
        });
        assert.deepEqual(await ledger(client), prefix);
        for (const relation of ["public.swim_connections", "public.swim_imports", "public.migration_boundary_table"]) {
          assert.equal((await client`SELECT to_regclass(${relation}) AS value`)[0]!.value, null);
        }
        assert.equal((await client`SELECT to_regtype('public.migration_boundary_type') AS value`)[0]!.value, null);
        assert.deepEqual(await settings(client), before);
        stages.push("migration-runner-public-ddl-and-precommit-rollback-retains-prefix");
        stage("migration-runner-incremental-157-to-159");
        await migrateCanonical(client, migrations.slice(0, 157), config);
        await assertLedger(client, migrations.slice(0, 157));
        stages.push(...await rehearseSwimOutcomeCompatibility(client, migrations, config, stage));
        await migrateCanonical(client, migrations, config);
        const completed = await assertLedger(client, migrations);
        assert.deepEqual(completed.slice(0, 150), Array.from(prefix));
        assert.deepEqual(await settings(client), before);
        await migrateCanonical(client, migrations, config);
        assert.deepEqual(await ledger(client), completed);
        assert.deepEqual(await settings(client), before);
        stages.push("migration-runner-incremental-ledger-replay-and-settings-preserved");
      }
    } catch (error) {
      primary = error;
      failed = true;
    } finally {
      if (client) {
        try { await client.end({ timeout: 5 }); } catch (error) { cleanup.push(error); }
      }
      if (created && cleanup.length === 0) {
        try { await admin`DROP DATABASE ${admin(name)}`; } catch (error) { cleanup.push(error); }
      }
      if (created && cleanup.length === 0) {
        for (const role of fixtureRoles) {
          try {
            if ((await admin`SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=${role}`).length) {
              await admin`DROP ROLE ${admin(role)}`;
            }
          } catch (error) { cleanup.push(error); }
        }
      }
      try { assert.deepEqual(await inventory(), original); } catch (error) { cleanup.push(error); }
    }
    if (failed || cleanup.length) {
      const projected = projectMigrationError(primary, () => migrations);
      const diagnostic = primary instanceof MigrationRunnerRehearsalError ? primary.diagnostic :
        { sqlstate: projected.error.sqlstate, position: projected.position };
      const cause = cleanup.length ? new AggregateError(failed ? [primary, ...cleanup] : cleanup,
        "Migration rehearsal cleanup failed", failed ? { cause: primary } : undefined) : primary;
      throw new MigrationRunnerRehearsalError(diagnostic, cause, cleanup.length > 0);
    }
  }
  stages.push("migration-runner-owned-database-role-inventory-restored");
  return stages;
}
