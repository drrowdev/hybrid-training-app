import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { SEED_MOVEMENTS, requiresPrimaryMuscle } from "../seeds/movements";
import { projectMigrationError } from "./migrate-evidence";
import { verifyMigrationDependencyParity } from "./migrate-with-evidence";

export const APPLICATION_SHA = "82337d2b36436bbe15532b4204e3ee96ba55b3f7";
const branch = "refs/heads/copilot/new-acceptance-cases";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
export const SETUP_PATHS = [
  ".github/workflows/ci.yml",
  "packages/db/scripts/prepare-swim-review.ts",
  "packages/db/scripts/__tests__/prepare-swim-review.test.ts",
  "HANDOFF.md",
] as const;

function requireTrue(value: unknown): asserts value is true {
  if (value !== true) throw new Error("Review bootstrap guard refused");
}

export function validateContext(env: NodeJS.ProcessEnv) {
  requireTrue(env.GITHUB_ACTIONS === "true" &&
    env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === "drrowdev/hybrid-training-app" &&
    env.GITHUB_REF_TYPE === "branch" && env.GITHUB_REF === branch &&
    env.GITHUB_JOB === "prepare-swim-review" &&
    ((env.PREPARE_SWIM_REVIEW === "true" && env.INSPECT_SWIM_REVIEW === "false") ||
      (env.PREPARE_SWIM_REVIEW === "false" && env.INSPECT_SWIM_REVIEW === "true")) &&
    env.MIGRATE_PRODUCTION === "false" && env.ALLOW_UNDEPLOYED === "false" &&
    env.SWIM_ACCEPTANCE === "false" &&
    /^[0-9a-f]{40}$/.test(env.EXPECTED_SHA ?? "") &&
    env.EXPECTED_SHA === env.GITHUB_SHA && env.EXPECTED_SHA !== APPLICATION_SHA);
  return env.INSPECT_SWIM_REVIEW === "true";
}

export function validateSourceDiff(paths: string[]) {
  requireTrue(paths.length > 0 && paths.every((path) =>
    (SETUP_PATHS as readonly string[]).includes(path)));
}

export function verifySource(env: NodeJS.ProcessEnv) {
  validateContext(env);
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: repositoryRoot, encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  requireTrue(git("rev-parse", "HEAD") === env.EXPECTED_SHA);
  git("merge-base", "--is-ancestor", APPLICATION_SHA, "HEAD");
  requireTrue(git("status", "--porcelain", "--untracked-files=all") === "");
  validateSourceDiff(git("diff", "--name-only", "--no-renames", APPLICATION_SHA, "HEAD").split("\n"));
  for (const path of SETUP_PATHS) {
    requireTrue(git("ls-tree", "HEAD", "--", path).startsWith("100644 blob "));
  }
  requireTrue(git("ls-remote", "--exit-code",
    "https://github.com/drrowdev/hybrid-training-app.git", branch) ===
    `${env.EXPECTED_SHA}\t${branch}`);
}

export function validateDatabaseUrl(raw: string | undefined): string {
  if (typeof raw !== "string") throw new Error("Review credentials missing");
  requireTrue(typeof raw === "string" && raw.length > 0 && raw.length <= 4096 &&
    !/[\s\\]/.test(raw));
  const url = new URL(raw);
  const password = decodeURIComponent(url.password);
  requireTrue(url.protocol === "postgresql:" &&
    url.hostname === "aws-0-eu-north-1.pooler.supabase.com" &&
    url.username === "postgres.whwilnhqfiaquwxgkxwt" &&
    url.port === "5432" && url.pathname === "/postgres" && url.hash === "" &&
    url.search === "?sslmode=require" &&
    password.length >= 12 && password.length <= 1024 &&
    !/[\s\x00-\x1f\x7f]/.test(password) &&
    !/password|placeholder|change.?me|example|your.?|<|>|\$\{/i.test(password));
  // Reject URL parser normalization and ambiguous authority/percent encodings.
  requireTrue(raw === `postgresql://${url.username}:${encodeURIComponent(password)}@${url.host}/postgres?sslmode=require`);
  return raw;
}

export type Pristine = {
  publicEmpty: boolean; ledgerAbsent: boolean; schemasExpected: boolean;
  publicCodeEmpty: boolean; usersEmpty: boolean; storageEmpty: boolean; visible: boolean;
};
type Predicate = boolean | "unreadable";
const platformKeys = ["present", "ownerExpected", "relationsEmpty", "typesEmpty", "oneRoutine",
  "signatureExpected", "languageExpected", "securityDefiner", "searchPathEmpty",
  "publicExecuteRevoked", "pgbouncerExecuteGranted"] as const;
type Platform = { [K in typeof platformKeys[number]]: Predicate };
const schemaOwners = ["postgres", "supabase_admin", "supabase_auth_admin", "supabase_storage_admin", "other"] as const;
type SchemaMetadata = {
  status: "readable" | "empty" | "invalid" | "unreadable" | "overflow";
  entries: {
    name: string;
    owner: typeof schemaOwners[number];
    relations: { count: number; saturated: boolean };
    routines: { count: number; saturated: boolean };
    types: { count: number; saturated: boolean };
    extensionMember: boolean;
  }[];
};
type Inspection = {
  predicates: { [K in keyof Pristine]: Predicate };
  schemaCounts: {
    unexpectedNamespaces: number | "unreadable";
    postgresOwnedRelations: number | "unreadable";
  };
  unexpectedSchemas?: SchemaMetadata;
  pgbouncer: Platform;
};
function unreadableInspection(): Inspection {
  return {
    predicates: {
      visible: "unreadable", publicEmpty: "unreadable", ledgerAbsent: "unreadable",
      schemasExpected: "unreadable", publicCodeEmpty: "unreadable",
      usersEmpty: "unreadable", storageEmpty: "unreadable",
    },
    schemaCounts: { unexpectedNamespaces: "unreadable", postgresOwnedRelations: "unreadable" },
    pgbouncer: Object.fromEntries(platformKeys.map((key) => [key, "unreadable"])) as Platform,
  };
}
function predicate(value: unknown): Predicate {
  return typeof value === "boolean" ? value : "unreadable";
}
function count(value: unknown): number | "unreadable" {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1000 ?
    value : "unreadable";
}
export function assertPristine(state: Inspection["predicates"]) {
  for (const key of ["publicEmpty", "ledgerAbsent", "schemasExpected",
    "publicCodeEmpty", "usersEmpty", "storageEmpty", "visible"] as const) requireTrue(state[key]);
}

type Client = {
  query(text: string, parameters?: string[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
};
type Phase = "source" | "credentials" | "canonical" | "client" | "preflight" |
  "migrate" | "seed" | "verify" | "close";
type Evidence = {
  phase: Phase; status: "passed" | "failed";
  code?: ReturnType<typeof projectMigrationError>["error"];
  mode?: "read-only";
  inspection?: Inspection;
};
export function emitEvidence(record: Evidence) {
  const data = JSON.stringify({ scope: "swim-review-bootstrap", ...record });
  console.log(data);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const escaped = data.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `<pre>${escaped}</pre>\n`);
  }
}
export type Runtime = {
  source(): void;
  canonical(): { hash: string; folderMillis: number }[];
  connect(url: string): Client;
  migrate(client: Client): Promise<void>;
  seed(url: string, signal: AbortSignal): Promise<void>;
  emit(record: Evidence): void;
};

const emptyAccounts = `
  SELECT NOT EXISTS (SELECT 1 FROM auth.users)
    AND NOT EXISTS (SELECT 1 FROM auth.identities)
    AND NOT EXISTS (SELECT 1 FROM auth.sessions)
    AND NOT EXISTS (SELECT 1 FROM auth.refresh_tokens) AS "usersEmpty",
    NOT EXISTS (SELECT 1 FROM storage.objects)
    AND NOT EXISTS (SELECT 1 FROM storage.buckets) AS "storageEmpty"`;

const unexpectedNamespaceFilter = `
  n.nspname NOT IN ('public', 'auth', 'storage', 'extensions', 'graphql', 'graphql_public',
    'realtime', 'supabase_functions', 'vault', 'net',
    'pg_catalog', 'information_schema', 'pg_toast')
    AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'`;

// Supabase postgres 2f5f2c2: pgbouncer_auth_schema.sql. Never read or execute its body.
const platformShape = `
  SELECT n.oid IS NOT NULL AS present,
    COALESCE(r.rolname = 'pgbouncer', false) AS "ownerExpected",
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace = n.oid) AS "relationsEmpty",
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type WHERE typnamespace = n.oid) AS "typesEmpty",
    (SELECT count(*) = 1 FROM (SELECT 1 FROM pg_catalog.pg_proc
      WHERE pronamespace = n.oid LIMIT 2) routines) AS "oneRoutine",
    COALESCE(p.proname = 'get_auth' AND p.prokind = 'f' AND p.pronargs = 1
      AND p.pronargdefaults = 0 AND p.provariadic = 0
      AND p.proargtypes[0] = 'pg_catalog.text'::regtype
      AND p.proallargtypes = ARRAY['pg_catalog.text'::regtype, 'pg_catalog.text'::regtype,
        'pg_catalog.text'::regtype]::oid[]
      AND p.proargmodes = ARRAY['i', 't', 't']::"char"[]
      AND p.proargnames = ARRAY['p_usename', 'username', 'password']
      AND p.proretset AND p.prorettype = 'pg_catalog.record'::regtype, false) AS "signatureExpected",
    COALESCE(l.lanname = 'plpgsql', false) AS "languageExpected",
    COALESCE(p.prosecdef, false) AS "securityDefiner",
    COALESCE(p.proconfig = ARRAY['search_path=""'] OR p.proconfig = ARRAY['search_path='],
      false) AS "searchPathEmpty",
    p.oid IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS "publicExecuteRevoked",
    EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      JOIN pg_catalog.pg_roles grantee ON grantee.oid = a.grantee
      WHERE grantee.rolname = 'pgbouncer' AND a.privilege_type = 'EXECUTE') AS "pgbouncerExecuteGranted"
  FROM (SELECT 1) singleton
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'pgbouncer'
  LEFT JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
  LEFT JOIN LATERAL (
    SELECT oid, proname, prokind, pronargs, pronargdefaults, provariadic, proargtypes,
      proallargtypes, proargmodes, proargnames, proretset, prorettype, prolang,
      prosecdef, proconfig, proacl, proowner
    FROM pg_catalog.pg_proc WHERE pronamespace = n.oid ORDER BY oid LIMIT 1
  ) p ON true
  LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang`;

async function inspectUnexpectedSchemas(client: Client, expected: number | "unreadable",
  recognized: boolean): Promise<SchemaMetadata> {
  const rows = await client.query(`
    SELECT CASE WHEN n.nspname ~ '^[a-z_][a-z0-9_]{0,62}$' THEN n.nspname ELSE NULL END AS name,
      CASE WHEN r.rolname IN ('postgres', 'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin')
        THEN r.rolname ELSE 'other' END AS owner,
      (SELECT count(*)::int FROM (SELECT 1 FROM pg_catalog.pg_class c
        WHERE c.relnamespace = n.oid LIMIT 1000) relations) AS relations,
      (SELECT count(*)::int FROM (SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.pronamespace = n.oid LIMIT 1000) routines) AS routines,
      (SELECT count(*)::int FROM (SELECT 1 FROM pg_catalog.pg_type t
        WHERE t.typnamespace = n.oid LIMIT 1000) types) AS types,
      EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_catalog.pg_namespace'::regclass AND d.objid = n.oid
          AND d.objsubid = 0 AND d.refclassid = 'pg_catalog.pg_extension'::regclass
          AND d.deptype = 'e') AS "extensionMember"
    FROM pg_catalog.pg_namespace n
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
    WHERE ${unexpectedNamespaceFilter}
      AND NOT ($1::boolean AND n.nspname = 'pgbouncer')
    ORDER BY n.oid LIMIT 17`, [String(recognized)]);
  if (rows.length > 16) return { status: "overflow", entries: [] };
  if (rows.length !== expected) return { status: "invalid", entries: [] };
  const entries: SchemaMetadata["entries"] = [];
  for (const row of rows) {
    const relations = count(row.relations);
    const routines = count(row.routines);
    const types = count(row.types);
    const owner = schemaOwners.find((owner) => owner === row.owner);
    if (typeof row.name !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(row.name) ||
      /[^a-z0-9_]/.test(row.name) || entries.some((entry) => entry.name === row.name) ||
      owner === undefined || relations === "unreadable" || routines === "unreadable" ||
      types === "unreadable" || typeof row.extensionMember !== "boolean") {
      return { status: "invalid", entries: [] };
    }
    entries.push({
      name: row.name, owner,
      relations: { count: relations, saturated: relations === 1000 },
      routines: { count: routines, saturated: routines === 1000 },
      types: { count: types, saturated: types === 1000 },
      extensionMember: row.extensionMember,
    });
  }
  return { status: entries.length === 0 ? "empty" : "readable", entries };
}

export async function preflight(client: Client, inspection = unreadableInspection(), inspectOnly = false) {
  const rows = await client.query(`
    SELECT current_user = 'postgres' AND session_user = 'postgres' AND
      EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user
        AND (rolsuper OR rolbypassrls)) AS visible,
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public') AS "publicEmpty",
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relname = '__drizzle_migrations')
      AS "ledgerAbsent",
    (SELECT count(*)::int FROM (SELECT 1 FROM pg_catalog.pg_namespace n
      WHERE ${unexpectedNamespaceFilter}
      LIMIT 1000) unexpected) AS "unexpectedNamespaces",
    (SELECT count(*)::int FROM (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('public', 'pg_catalog', 'information_schema', 'pg_toast')
        AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relowner = 'postgres'::regrole
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
      LIMIT 1000) owned) AS "postgresOwnedRelations",
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid AND d.deptype = 'e'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typelem = 0 AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_type'::regclass
          AND d.objid = t.oid AND d.deptype = 'e')) AS "publicCodeEmpty",
    (SELECT row_to_json(platform) FROM (${platformShape}) platform) AS pgbouncer`);
  const row = rows.length === 1 ? rows[0] : undefined;
  for (const key of ["visible", "publicEmpty", "ledgerAbsent", "publicCodeEmpty"] as const) {
    inspection.predicates[key] = predicate(row?.[key]);
  }
  inspection.schemaCounts.unexpectedNamespaces = count(row?.unexpectedNamespaces);
  inspection.schemaCounts.postgresOwnedRelations = count(row?.postgresOwnedRelations);
  const platform = row?.pgbouncer;
  for (const key of platformKeys) {
    inspection.pgbouncer[key] = predicate(platform && typeof platform === "object" ?
      (platform as Record<string, unknown>)[key] : undefined);
  }
  const recognized = platformKeys.every((key) => inspection.pgbouncer[key] === true);
  // The raw count includes pgbouncer; only this exact decision removes it from both views.
  if (recognized && typeof inspection.schemaCounts.unexpectedNamespaces === "number") {
    const rawCount = inspection.schemaCounts.unexpectedNamespaces;
    inspection.schemaCounts.unexpectedNamespaces = rawCount === 0 ? "unreadable" :
      rawCount === 1000 ? 1000 : rawCount - 1;
  }
  const { unexpectedNamespaces, postgresOwnedRelations } = inspection.schemaCounts;
  inspection.predicates.schemasExpected =
    unexpectedNamespaces === "unreadable" || postgresOwnedRelations === "unreadable" ?
      "unreadable" : unexpectedNamespaces === 0 && postgresOwnedRelations === 0;
  const accounts = await client.query(emptyAccounts);
  const account = accounts.length === 1 ? accounts[0] : undefined;
  for (const key of ["usersEmpty", "storageEmpty"] as const) {
    inspection.predicates[key] = predicate(account?.[key]);
  }
  if (inspectOnly) {
    inspection.unexpectedSchemas = await inspectUnexpectedSchemas(client, unexpectedNamespaces, recognized);
    requireTrue(inspection.unexpectedSchemas.status === "readable" || inspection.unexpectedSchemas.status === "empty");
  }
  requireTrue(inspection.pgbouncer.present === false || recognized);
  assertPristine(inspection.predicates);
}

export async function verifyResult(client: Client, canonical: { hash: string; folderMillis: number }[]) {
  const ledger = await client.query(
    'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id');
  requireTrue(ledger.length === 150 && canonical.length === 150);
  ledger.forEach((row, i) => requireTrue(row.id === i + 1 &&
    row.hash === canonical[i]!.hash && String(row.created_at) === String(canonical[i]!.folderMillis)));
  const counts = await client.query(`SELECT
    (SELECT count(*)::int FROM public.movements WHERE user_id IS NULL) AS global,
    (SELECT count(*)::int FROM public.movements WHERE user_id IS NULL
      AND slug IN (SELECT jsonb_array_elements_text($1::jsonb))) AS seeded,
    public.swim_storage_ready() AS ready`, [JSON.stringify(SEED_MOVEMENTS.map((m) => m.slug))]);
  requireTrue(counts.length === 1 && counts[0]!.global === 334 &&
    counts[0]!.seeded === 330 && counts[0]!.ready === true);
  const accounts = await client.query(emptyAccounts);
  requireTrue(accounts.length === 1 && accounts[0]!.usersEmpty === true && accounts[0]!.storageEmpty === true);
  // Only the two global catalog tables may contain rows after canonical setup.
  const tables = await client.query(`SELECT c.relname AS name FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`);
  requireTrue(tables.length > 0 && tables.length <= 200);
  for (const table of tables) {
    requireTrue(typeof table.name === "string" && /^[a-z_][a-z0-9_]*$/.test(table.name));
    const condition = table.name === "movements" ? " WHERE user_id IS NOT NULL" :
      table.name === "movement_instructions" ?
        " WHERE NOT EXISTS (SELECT 1 FROM public.movements m WHERE m.id = movement_id AND m.user_id IS NULL)" : "";
    const result = await client.query(`SELECT NOT EXISTS (SELECT 1 FROM public."${table.name}"${condition}) AS empty`);
    requireTrue(result.length === 1 && result[0]!.empty === true);
  }
}

export function runSeed(url: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const bounded = new URL(url);
  for (const [key, value] of Object.entries({
    connect_timeout: "10", statement_timeout: "60000", lock_timeout: "5000",
    idle_in_transaction_session_timeout: "60000", client_min_messages: "error",
  })) bounded.searchParams.set(key, value);
  return new Promise((done, fail) => {
    // The unchanged CLI can print SQL/rows/errors: discard both streams at the OS boundary.
    const child = spawn(process.execPath, ["--import", "tsx", "seeds/run.ts"], {
      cwd: packageRoot, stdio: "ignore",
      env: { PATH: process.env.PATH ?? "", DATABASE_URL: bounded.toString(), PGSSLMODE: "require" },
    });
    let expired = false;
    const abort = () => { expired = true; child.kill("SIGKILL"); };
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, 90_000);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    child.once("error", () => { cleanup(); fail(new Error("Seed process failed")); });
    child.once("close", (code) => {
      cleanup();
      if (code === 0 && !expired) done();
      else fail(new Error(expired ? "Seed deadline exceeded" : "Seed process failed"));
    });
  });
}

export function defaultRuntime(inspectOnly = false): Runtime {
  let sql: ReturnType<typeof postgres>;
  return {
    source: () => verifySource(process.env),
    canonical: () => {
      requireTrue(!existsSync(resolve(packageRoot, ".env.local")));
      verifyMigrationDependencyParity();
      const journal = JSON.parse(readFileSync(resolve(packageRoot, "drizzle/meta/_journal.json"), "utf8"));
      const migrations = readMigrationFiles({ migrationsFolder: resolve(packageRoot, "drizzle") });
      requireTrue(journal.entries.length === 150 && migrations.length === 150 &&
        journal.entries.every((entry: { idx: number; when: number }, i: number) =>
          entry.idx === i && entry.when === migrations[i]!.folderMillis &&
          (i === 0 || entry.when > migrations[i - 1]!.folderMillis)));
      requireTrue(SEED_MOVEMENTS.length === 330 && new Set(SEED_MOVEMENTS.map((m) => m.slug)).size === 330 &&
        SEED_MOVEMENTS.every((m) => (m.primaryMuscles?.length ?? 0) > 0 || !requiresPrimaryMuscle(m)));
      return migrations;
    },
    connect: (url) => {
      sql = postgres(url, {
        max: 1, prepare: false, ssl: "require", connect_timeout: 10,
        onnotice: () => {}, connection: {
          statement_timeout: 60_000, lock_timeout: 5_000,
          idle_in_transaction_session_timeout: 60_000, client_min_messages: "error", row_security: "off",
          ...(inspectOnly ? { default_transaction_read_only: true } : {}),
        },
      });
      // Preserve the canonical CLI driver's migration literal serialization.
      const passthrough = (value: string) => value;
      for (const type of [1184, 1082, 1083, 1114]) {
        sql.options.parsers[type] = passthrough;
        sql.options.serializers[type] = passthrough;
      }
      sql.options.serializers[114] = passthrough;
      sql.options.serializers[3802] = passthrough;
      return {
        query: async (text, parameters = []) => Array.from(await sql.unsafe(text, parameters)),
        close: () => sql.end({ timeout: 5 }),
      };
    },
    migrate: async () => { await migrate(drizzle(sql), { migrationsFolder: resolve(packageRoot, "drizzle") }); },
    seed: runSeed,
    emit: emitEvidence,
  };
}

export async function prepareReview(raw: string | undefined, runtime: Runtime, inspectOnly = false): Promise<boolean> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 300_000);
  async function bounded<T>(operation: () => Promise<T>): Promise<T> {
    controller.signal.throwIfAborted();
    let abort: () => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(new Error("Review deadline exceeded"));
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    try { return await Promise.race([operation(), stopped]); }
    finally { controller.signal.removeEventListener("abort", abort); }
  }
  let client: Client | undefined;
  let phase: Phase = "source";
  let passed = false;
  const inspection = unreadableInspection();
  if (inspectOnly) inspection.unexpectedSchemas = { status: "unreadable", entries: [] };
  const emit = (record: Evidence) => runtime.emit({
    ...record, ...(inspectOnly ? { mode: "read-only" as const } : {}),
    ...(inspectOnly && phase === "preflight" ? { inspection: structuredClone(inspection) } : {}),
  });
  const complete = () => emit({ phase, status: "passed" });
  try {
    runtime.source(); complete();
    phase = "credentials";
    const url = validateDatabaseUrl(raw); complete();
    phase = "canonical";
    const canonical = runtime.canonical(); complete();
    phase = "client";
    client = runtime.connect(url); complete();
    phase = "preflight";
    await preflight({
      query: (text, parameters) => bounded(() => client!.query(text, parameters)),
      close: () => client!.close(),
    }, inspection, inspectOnly); complete();
    if (!inspectOnly) {
      phase = "migrate";
      await bounded(() => runtime.migrate(client!)); complete();
      phase = "seed";
      await bounded(() => runtime.seed(url, controller.signal)); complete();
      phase = "verify";
      await bounded(() => verifyResult(client!, canonical)); complete();
    }
    passed = true;
  } catch (error) {
    emit({ phase, status: "failed", code: projectMigrationError(error).error });
  } finally {
    clearTimeout(deadline);
    controller.abort();
    if (client) {
      phase = "close";
      try { await client.close(); complete(); }
      catch (error) {
        passed = false;
        emit({ phase, status: "failed", code: projectMigrationError(error).error });
      }
    }
  }
  return passed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // No inherited raw CLI streams or evidence collector files, and no retry/cleanup of database state.
  const main = async () => {
    const inspectOnly = validateContext(process.env);
    if (process.argv[2] === "--check-source") {
      requireTrue(process.argv.length === 3);
      verifySource(process.env);
      emitEvidence({ phase: "source", status: "passed", ...(inspectOnly ? { mode: "read-only" } : {}) });
      return true;
    }
    requireTrue(inspectOnly ? process.argv.length === 3 && process.argv[2] === "--inspect-only" :
      process.argv.length === 2);
    return prepareReview(process.env.SWIM_REVIEW_DATABASE_URL, defaultRuntime(inspectOnly), inspectOnly);
  };
  main().then((passed) => {
    process.exit(passed ? 0 : 1);
  }, (error) => {
    try {
      emitEvidence({ phase: "source", status: "failed",
        ...(process.env.INSPECT_SWIM_REVIEW === "true" ? { mode: "read-only" } : {}),
        code: projectMigrationError(error).error });
    } finally { process.exit(1); }
  });
}
