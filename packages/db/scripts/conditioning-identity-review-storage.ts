import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type postgres from "postgres";
import { conditioningReviewMigrations, verifyConditioningReviewStorage } from "./conditioning-swim-review-storage";
import { ReviewStorageRefusal } from "./upgrade-swim-review-storage";

export function identityReviewMigrations() {
  const prefix = conditioningReviewMigrations();
  const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  if (migrations.length !== 159 || migrations.slice(0, 158).some((entry, index) =>
    entry.hash !== prefix[index]!.hash || entry.folderMillis !== prefix[index]!.folderMillis)) {
    throw new ReviewStorageRefusal("migration_source");
  }
  return migrations;
}
async function inspect(tx: postgres.TransactionSql, count: 158 | 159) {
  const migrations = identityReviewMigrations();
  const rows = await tx.unsafe("SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 160");
  if (rows.length !== count || rows.some((row, index) =>
    typeof row.id !== "number" || (index > 0 && row.id <= rows[index - 1]!.id) ||
    row.hash !== migrations[index]!.hash || String(row.created_at) !== String(migrations[index]!.folderMillis))) {
    throw new ReviewStorageRefusal("ledger_mismatch");
  }
  const [role] = await tx`SELECT NOT (rolsuper OR rolcanlogin OR rolinherit OR rolbypassrls
      OR rolcreaterole OR rolcreatedb OR rolreplication)
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS restricted,
    has_function_privilege(oid,'public.swim_request_user_id()','EXECUTE') AS helper
    FROM pg_roles WHERE rolname='conditioning_writer'`;
  if (!role?.restricted || role.helper !== (count === 159)) throw new ReviewStorageRefusal("writer_role");
  const helper = await tx`SELECT proowner='postgres'::regrole AND prosecdef
    AND provolatile='s' AND prorettype='uuid'::regtype AND pronargs=0
    AND prolang=(SELECT oid FROM pg_language WHERE lanname='sql')
    AND proconfig=ARRAY['search_path=pg_catalog']::text[]
    AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')=
      'c628b78ce1d2a3b15ddbaf7b0a5838fa26c925d332103e53f34ba73b9b227604' AS valid
    FROM pg_proc WHERE oid='public.swim_request_user_id()'::regprocedure`;
  if (helper.length !== 1 || helper[0]!.valid !== true) throw new ReviewStorageRefusal("capabilities");
  const callers = await tx`SELECT r.rolname, a.is_grantable,
    a.grantor='postgres'::regrole AS expected_grantor, a.privilege_type
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
    LEFT JOIN pg_roles r ON r.oid=a.grantee
    WHERE p.oid='public.swim_request_user_id()'::regprocedure ORDER BY r.rolname`;
  const expectedCallers = ["authenticated", ...(count === 159 ? ["conditioning_writer"] : []),
    "postgres", "service_role", "swim_writer"];
  if (callers.length !== expectedCallers.length || callers.some((row, index) =>
    row.rolname !== expectedCallers[index] || row.is_grantable !== false ||
    row.expected_grantor !== true || row.privilege_type !== "EXECUTE")) throw new ReviewStorageRefusal("capabilities");
  const targets = [...migrations[158]!.sql.join("\n").matchAll(
    /'(public\.[a-z_]+\([a-z,]*\))',\s*'([a-f0-9]{64})',\s*'([a-f0-9]{64})'/g,
  )].map((match) => ({ signature: match[1], hash: match[count === 158 ? 2 : 3] }));
  if (targets.length !== 5) throw new ReviewStorageRefusal("migration_source");
  const routines = await tx`SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=e.hash AS valid
    FROM jsonb_to_recordset(${JSON.stringify(targets)}::text::jsonb) AS e(signature text, hash text)
    LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)`;
  if (routines.length !== 5 || routines.some((row) => row.valid !== true)) throw new ReviewStorageRefusal("capabilities");
  await verifyConditioningReviewStorage(tx);
  return Array.from(rows);
}
export async function inspectIdentityReview(sql: postgres.Sql, count: 158 | 159) {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    await tx.unsafe("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='5s'");
    await inspect(tx, count);
  });
}
export async function appendIdentityReview(sql: postgres.Sql, guard: () => Promise<void>) {
  const migration = identityReviewMigrations()[158]!;
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='60s'");
    await tx.unsafe("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
    const before = await inspect(tx, 158);
    await guard();
    for (const statement of migration.sql) await tx.unsafe(statement);
    await tx.unsafe("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2)",
      [migration.hash, migration.folderMillis]);
    const after = await inspect(tx, 159);
    if (JSON.stringify(after.slice(0, 158)) !== JSON.stringify(before)) throw new ReviewStorageRefusal("ledger_mismatch");
    await guard();
  });
}
