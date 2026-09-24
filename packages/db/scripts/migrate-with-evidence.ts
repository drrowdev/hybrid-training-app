import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { MigrationConfig } from "drizzle-orm/migrator";
import type { Sql } from "postgres";
import { migrateCanonical } from "./migration-runner";
import {
  appendMigrationShutdown, MIGRATION_EVIDENCE_ENV, openMigrationEvidence, projectMigrationError,
  type CanonicalMigrations, type MigrationPhase, type MigrationShutdown, type MigrationTerminal,
} from "./migrate-evidence";

export const MIGRATION_SHUTDOWN_MS = 5000;
const configSchema = z.object({
  dialect: z.literal("postgresql"), out: z.literal("./drizzle"),
  schema: z.literal("./src/schema/*.ts"), strict: z.literal(true), verbose: z.literal(true),
  dbCredentials: z.object({ url: z.string().min(1) }).strict(),
}).strict();
type Config = z.infer<typeof configSchema>;
type Client = { end(options: { timeout: number }): Promise<void> };
type Dependencies = {
  createClient(config: Config): Client;
  migrate(client: Client, config: MigrationConfig): Promise<void>;
  readMigrations(config: MigrationConfig): CanonicalMigrations;
};
export type MigrationEntryRuntime = {
  loadConfig(): Promise<unknown>;
  loadDependencies(): Promise<Dependencies>;
};
export type MigrationEntryResult = {
  exitCode: 0 | 1;
  failed: boolean;
  failure?: unknown;
  diagnostic?: ReturnType<typeof projectMigrationError>;
  terminalRecorded: boolean;
  secondary: ("collector-failed" | "shutdown-failed" | "shutdown-timed-out")[];
};
export type MigrationEvidenceCommand = "db:migrate:evidence";

function packageInfo(require: NodeRequire, specifier: string, name: string) {
  let directory = dirname(realpathSync(require.resolve(specifier)));
  while (dirname(directory) !== directory) {
    const path = join(directory, "package.json");
    if (existsSync(path)) {
      const value = JSON.parse(readFileSync(path, "utf8")) as { name?: string; version?: string };
      if (value.name === name) return { directory, version: value.version };
    }
    directory = dirname(directory);
  }
  throw new Error("Migration dependency parity failed");
}

// Resolve from the installed CLI itself, not the workspace's lockfile or web package.
export function verifyMigrationDependencyParity() {
  const entry = createRequire(import.meta.url);
  const kit = packageInfo(entry, "drizzle-kit", "drizzle-kit");
  const cli = createRequire(join(kit.directory, "bin.cjs"));
  let pgAbsent = false;
  try { cli.resolve("pg"); }
  catch (error) {
    pgAbsent = error instanceof Error && Object.getOwnPropertyDescriptor(error, "code")?.value === "MODULE_NOT_FOUND";
  }
  if (!pgAbsent || cli.resolve.paths("pg")?.some((path) => existsSync(join(path, "pg")))) {
    throw new Error("Migration CLI driver parity failed");
  }
  if (kit.version !== "0.30.6" || packageInfo(cli, "postgres", "postgres").version !== "3.4.9" ||
      packageInfo(cli, "drizzle-orm", "drizzle-orm").version !== "0.44.7") {
    throw new Error("Migration dependency version parity failed");
  }
  for (const specifier of ["postgres", "drizzle-orm", "drizzle-orm/postgres-js",
    "drizzle-orm/postgres-js/migrator", "drizzle-orm/migrator"]) {
    if (realpathSync(cli.resolve(specifier)) !== realpathSync(entry.resolve(specifier))) {
      throw new Error("Migration module parity failed");
    }
  }
  return { driver: "postgres" as const, kit: "0.30.6", orm: "0.44.7", postgres: "3.4.9", pgAbsent: true as const };
}

export async function loadMigrationDependencies(): Promise<Dependencies> {
  verifyMigrationDependencyParity();
  const [{ default: postgres }, { readMigrationFiles }] = await Promise.all([
    import("postgres"), import("drizzle-orm/migrator"),
  ]);
  return {
    createClient(config) {
      const client = postgres(config.dbCredentials.url, { max: 1 });
      const passthrough = (value: string) => value;
      for (const type of [1184, 1082, 1083, 1114, 1182, 1185, 1115, 1231]) {
        client.options.parsers[type] = passthrough;
        client.options.serializers[type] = passthrough;
      }
      client.options.serializers[114] = passthrough;
      client.options.serializers[3802] = passthrough;
      return client;
    },
    migrate: (client, config) => migrateCanonical(client as Sql, readMigrationFiles(config), config),
    readMigrations: readMigrationFiles,
  };
}

async function shutdown(client: Client | undefined): Promise<MigrationShutdown> {
  if (!client) return { event: "shutdown", status: "not-created", error: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => client.end({ timeout: MIGRATION_SHUTDOWN_MS / 1000 })).then(
        (): MigrationShutdown => ({ event: "shutdown", status: "closed", error: null }),
        (error): MigrationShutdown => ({ event: "shutdown", status: "failed", error: projectMigrationError(error).error }),
      ),
      new Promise<MigrationShutdown>((done) => {
        timer = setTimeout(() => done({ event: "shutdown", status: "timed-out", error: null }), MIGRATION_SHUTDOWN_MS);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

const defaultRuntime: MigrationEntryRuntime = {
  // Never import the CWD-writing normalizer here. Its separate pre-step is outside this envelope.
  loadConfig: async () => (await import("../drizzle.config")).default,
  loadDependencies: loadMigrationDependencies,
};

export async function runMigrationWithEvidence(path: string, runtime: MigrationEntryRuntime = defaultRuntime) {
  // Invalid/missing paths abort before config, dependencies, client creation or migration.
  return executeMigration(runtime, { path, writer: openMigrationEvidence(path) });
}

export function runNormalMigration(runtime: MigrationEntryRuntime = defaultRuntime) {
  return executeMigration(runtime);
}

async function executeMigration(
  runtime: MigrationEntryRuntime,
  evidence?: { path: string; writer: ReturnType<typeof openMigrationEvidence> },
): Promise<MigrationEntryResult> {
  const result: MigrationEntryResult = { exitCode: 0, failed: false, terminalRecorded: false, secondary: [] };
  let phase: MigrationPhase = "config";
  let client: Client | undefined;
  let dependencies: Dependencies | undefined;
  let config: MigrationConfig | undefined;
  let terminal: MigrationTerminal;
  try {
    const tracked = configSchema.parse(await runtime.loadConfig());
    config = { migrationsFolder: tracked.out };
    phase = "dependencies";
    dependencies = await runtime.loadDependencies();
    phase = "client";
    client = dependencies.createClient(tracked);
    phase = "migrate";
    await dependencies.migrate(client, config);
    terminal = { event: "terminal", status: "success", phase, error: null, position: { status: "unmatched" } };
  } catch (error) {
    result.failed = true;
    result.failure = error;
    result.exitCode = 1;
    const projection = projectMigrationError(error, config && dependencies ?
      () => dependencies!.readMigrations(config!) : undefined);
    result.diagnostic = projection;
    terminal = { event: "terminal", status: "failure", phase, ...projection };
  }
  // The primary outcome is durable and CLOSED before even invoking client.end.
  if (evidence) {
    try { evidence.writer.terminal(terminal); result.terminalRecorded = true; }
    catch { result.exitCode = 1; result.secondary.push("collector-failed"); }
  }
  const closed = await shutdown(client);
  if (closed.status === "failed" || closed.status === "timed-out") {
    result.exitCode = 1;
    result.secondary.push(closed.status === "failed" ? "shutdown-failed" : "shutdown-timed-out");
  }
  if (evidence) {
    try { appendMigrationShutdown(evidence.path, evidence.writer.identity, closed); }
    catch { result.exitCode = 1; if (!result.secondary.includes("collector-failed")) result.secondary.push("collector-failed"); }
  }
  return result;
}

export function publishMigrationResult(result: MigrationEntryResult) {
  const record = JSON.stringify({ scope: "db-migrate", status: result.exitCode === 0 ? "passed" : "failed",
    ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}), secondary: result.secondary });
  if (result.exitCode === 0) console.log(record);
  else {
    const scid = result.diagnostic?.error.scid;
    const prefix = scid ? `PostgresError: SCID/1/${scid.guard}/${scid.phase}/${scid.object}/${scid.bits}\n` : "";
    console.error(prefix + record);
  }
}

// Importing this module performs no environment reads, file writes or migration.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrationWithEvidence(process.env[MIGRATION_EVIDENCE_ENV] ?? "").then((result) => {
    publishMigrationResult(result);
    process.exit(result.exitCode);
  }, () => {
    console.error("Migration evidence entry aborted");
    process.exit(1);
  });
}
