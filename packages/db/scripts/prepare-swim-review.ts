import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
    env.PREPARE_SWIM_REVIEW === "true" &&
    env.MIGRATE_PRODUCTION === "false" && env.ALLOW_UNDEPLOYED === "false" &&
    env.SWIM_ACCEPTANCE === "false" &&
    /^[0-9a-f]{40}$/.test(env.EXPECTED_SHA ?? "") &&
    env.EXPECTED_SHA === env.GITHUB_SHA && env.EXPECTED_SHA !== APPLICATION_SHA);
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
export function assertPristine(state: Pristine) {
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
};
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

export async function preflight(client: Client) {
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
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace
      WHERE nspname NOT IN ('public', 'auth', 'storage', 'extensions', 'graphql', 'graphql_public',
        'realtime', 'supabase_functions', 'vault', 'net',
        'pg_catalog', 'information_schema', 'pg_toast')
      AND nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('public', 'pg_catalog', 'information_schema', 'pg_toast')
        AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relowner = 'postgres'::regrole
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    ) AS "schemasExpected",
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid AND d.deptype = 'e'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typelem = 0 AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_type'::regclass
          AND d.objid = t.oid AND d.deptype = 'e')) AS "publicCodeEmpty"`);
  const accounts = await client.query(emptyAccounts);
  requireTrue(rows.length === 1 && accounts.length === 1);
  assertPristine({ ...rows[0], ...accounts[0] } as Pristine);
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

export function defaultRuntime(): Runtime {
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
    emit: (record) => console.log(JSON.stringify({ scope: "swim-review-bootstrap", ...record })),
  };
}

export async function prepareReview(raw: string | undefined, runtime: Runtime): Promise<boolean> {
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
  const complete = () => runtime.emit({ phase, status: "passed" });
  try {
    runtime.source(); complete();
    phase = "credentials";
    const url = validateDatabaseUrl(raw); complete();
    phase = "canonical";
    const canonical = runtime.canonical(); complete();
    phase = "client";
    client = runtime.connect(url); complete();
    phase = "preflight";
    await bounded(() => preflight(client!)); complete();
    phase = "migrate";
    await bounded(() => runtime.migrate(client!)); complete();
    phase = "seed";
    await bounded(() => runtime.seed(url, controller.signal)); complete();
    phase = "verify";
    await bounded(() => verifyResult(client!, canonical)); complete();
    passed = true;
  } catch (error) {
    runtime.emit({ phase, status: "failed", code: projectMigrationError(error).error });
  } finally {
    clearTimeout(deadline);
    controller.abort();
    if (client) {
      phase = "close";
      try { await client.close(); complete(); }
      catch (error) {
        passed = false;
        runtime.emit({ phase, status: "failed", code: projectMigrationError(error).error });
      }
    }
  }
  return passed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // No inherited raw CLI streams or evidence collector files, and no retry/cleanup of database state.
  const main = async () => {
    if (process.argv[2] === "--check-source") {
      verifySource(process.env);
      console.log('{"scope":"swim-review-bootstrap","phase":"source","status":"passed"}');
      return true;
    }
    requireTrue(process.argv.length === 2);
    return prepareReview(process.env.SWIM_REVIEW_DATABASE_URL, defaultRuntime());
  };
  main().then((passed) => {
    process.exit(passed ? 0 : 1);
  }, (error) => {
    console.log(JSON.stringify({ scope: "swim-review-bootstrap", status: "failed",
      code: projectMigrationError(error).error }));
    process.exit(1);
  });
}
