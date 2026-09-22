import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { z } from "zod";
import {
  PRODUCTION, PRODUCTION_ROUTES, ProductionInspectionRefusal, requireInspection,
  productionDatabaseUrl, productionRequestAllowed, productionAlias, productionDeployment,
  productionDeploymentRoute, productionSettings,
} from "./swim-production-readonly-guards";
import {
  productionSchemaInventory, SCHEMA_TABLE_SQL, SCHEMA_FUNCTION_SQL, SCHEMA_SHARED_SQL,
  SWIM_SCHEMA_TABLES, SWIM_SCHEMA_FUNCTIONS,
} from "./swim-production-reconciliation";
import {
  MODULAR_PREFLIGHT, modularPreflightContext, modularMigrationInventory, type ModularMigration,
} from "./modular-production-preflight-guards";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const record = z.record(z.unknown());
const journalSchema = z.object({ entries: z.array(z.object({
  idx: z.number().int().nonnegative(), tag: z.string(), when: z.number().int().positive(),
  version: z.string(), breakpoints: z.boolean(),
})).min(MODULAR_PREFLIGHT.sourceCount).max(164) });
type Stage = { stage: string; status: "passed" | "failed"; code: string };

export async function inspectModularProduction(env: NodeJS.ProcessEnv, sourceOnly = false) {
  const result = {
    scope: "modular-production-preflight",
    testedSha: /^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA : null,
    run: /^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? "") ? env.GITHUB_RUN_ID : null,
    mainSha: MODULAR_PREFLIGHT.main, project: PRODUCTION.project, alias: PRODUCTION.alias,
    status: "failed", stages: [] as Stage[], httpRequests: 0, httpStatus: null as number | null,
    databaseReadAttempted: false, databaseClosed: false, writesAttempted: false,
    deployment: null as ReturnType<typeof productionDeployment> | null,
    settings: null as ReturnType<typeof productionSettings> | null,
    inventory: null as ReturnType<typeof modularMigrationInventory> | null,
    schema: null as ReturnType<typeof productionSchemaInventory> | null,
  };
  const deadline = Date.now() + 180_000;
  let stage = "source", deploymentId: string | undefined, sql: postgres.Sql | undefined;
  const time = () => requireInspection(Date.now() < deadline, "deadline");
  const git = (...args: string[]) => {
    time();
    return execFileSync("git", args, { cwd: root, timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: env.PATH ?? "", HOME: env.HOME ?? "", NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("utf8").trim();
  };
  const step = async (name: string, action: () => void | Promise<void>) => {
    stage = name; time(); await action(); time();
    result.stages.push({ stage: name, status: "passed", code: "passed" });
  };
  const source = (): ModularMigration[] => {
    requireInspection(env.GITHUB_ACTIONS === "true", "context");
    const eventPath = env.GITHUB_EVENT_PATH;
    requireInspection(eventPath && lstatSync(eventPath).isFile() && !lstatSync(eventPath).isSymbolicLink() &&
      lstatSync(eventPath).size <= 2 * 1024 * 1024, "event");
    const inputs = record.parse(record.parse(JSON.parse(readFileSync(eventPath, "utf8"))).inputs);
    const sha = modularPreflightContext(inputs, env);
    requireInspection(git("rev-parse", "HEAD") === sha &&
      git("status", "--porcelain", "--untracked-files=all") === "", "checkout");
    git("merge-base", "--is-ancestor", MODULAR_PREFLIGHT.main, "HEAD");
    for (const [ref, expected] of [
      [`refs/heads/${MODULAR_PREFLIGHT.branch}`, sha], ["refs/heads/main", MODULAR_PREFLIGHT.main],
    ]) requireInspection(git("ls-remote", "--exit-code",
      "https://github.com/drrowdev/hybrid-training-app.git", ref!) === `${expected}\t${ref}`, "live_ref");
    for (const entry of git("ls-tree", "-r", "HEAD").split("\n")) {
      const match = /^(100644|100755) blob [a-f0-9]{40}\t([^\t\r\n]+)$/.exec(entry);
      requireInspection(match?.[2] && match[2].split("/").every((_, index, parts) => {
        const item = lstatSync(resolve(root, ...parts.slice(0, index + 1)));
        return !item.isSymbolicLink() && (index === parts.length - 1 ? item.isFile() : item.isDirectory());
      }), "source_path");
    }
    const journal = journalSchema.parse(JSON.parse(readFileSync(resolve(root, "packages/db/drizzle/meta/_journal.json"), "utf8")));
    const baseline = journalSchema.parse(JSON.parse(git("show", `${MODULAR_PREFLIGHT.main}:packages/db/drizzle/meta/_journal.json`)));
    requireInspection(baseline.entries.length === MODULAR_PREFLIGHT.sourceCount &&
      JSON.stringify(journal.entries.slice(0, MODULAR_PREFLIGHT.sourceCount)) === JSON.stringify(baseline.entries) &&
      journal.entries.every((entry, index) => entry.idx === index), "source_journal");
    const existing = new Set(git("ls-tree", "-r", "--name-only", MODULAR_PREFLIGHT.main, "--", "packages/db/drizzle").split("\n"));
    requireInspection(git("diff", "--name-only", MODULAR_PREFLIGHT.main, "HEAD", "--", "packages/db/drizzle")
      .split("\n").every((path) => !path || path === "packages/db/drizzle/meta/_journal.json" || !existing.has(path)),
    "applied_migration_changed");
    const migrations = readMigrationFiles({ migrationsFolder: resolve(root, "packages/db/drizzle") });
    requireInspection(migrations.length === journal.entries.length, "source_journal");
    return migrations.map((entry, index) => ({
      tag: journal.entries[index]!.tag, hash: entry.hash, folderMillis: entry.folderMillis,
    }));
  };
  const request = async (url: string) => {
    time();
    requireInspection(++result.httpRequests <= 10 &&
      productionRequestAllowed(url, "GET", undefined, deploymentId), "http_boundary");
    const response = await fetch(url, { method: "GET", redirect: "error",
      signal: AbortSignal.timeout(Math.min(15_000, deadline - Date.now())),
      headers: { Authorization: ["Bearer", env.VERCEL_REVIEW_TOKEN].join(" ") },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProductionInspectionRefusal("http_status", response.status);
    }
    const reader = response.body?.getReader();
    requireInspection(reader, "http_body");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > 1024 * 1024) { await reader.cancel(); throw new ProductionInspectionRefusal("http_size"); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
  };
  const snapshot = async () => {
    const project = await request(PRODUCTION_ROUTES.project);
    const projectEnv = await request(PRODUCTION_ROUTES.projectEnv);
    const sharedEnv = await request(PRODUCTION_ROUTES.sharedEnv);
    const alias = productionAlias(await request(PRODUCTION_ROUTES.alias));
    requireInspection(deploymentId === undefined || deploymentId === alias.deploymentId, "alias_changed");
    deploymentId = alias.deploymentId;
    return { settings: productionSettings(project, projectEnv, sharedEnv),
      deployment: productionDeployment(await request(productionDeploymentRoute(deploymentId)), deploymentId, MODULAR_PREFLIGHT.main) };
  };
  try {
    await step("source", () => { source(); });
    if (sourceOnly) { result.status = "source_pass"; return result; }
    let databaseUrl = "";
    await step("credentials", () => {
      databaseUrl = productionDatabaseUrl(env.SUPABASE_PROD_DB_URL);
      requireInspection(typeof env.VERCEL_REVIEW_TOKEN === "string" && env.VERCEL_REVIEW_TOKEN.length >= 20 &&
        env.VERCEL_REVIEW_TOKEN.length <= 2048 && !/[\s\x00-\x1f\x7f]/.test(env.VERCEL_REVIEW_TOKEN), "credentials");
    });
    let before: Awaited<ReturnType<typeof snapshot>>;
    await step("deployment", async () => {
      before = await snapshot(); result.deployment = before.deployment; result.settings = before.settings;
    });
    await step("ledger", async () => {
      const migrations = source();
      sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: "require", connect_timeout: 10, onnotice: () => {},
        connection: { default_transaction_read_only: true, statement_timeout: 10_000, lock_timeout: 5_000,
          idle_in_transaction_session_timeout: 15_000, client_min_messages: "error", application_name: "modular-production-preflight" },
      });
      result.databaseReadAttempted = true;
      await sql.begin(async (tx) => {
        await tx.unsafe("SET TRANSACTION READ ONLY");
        await tx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        result.inventory = modularMigrationInventory(Array.from(await tx.unsafe(
          "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 512")), migrations);
        await step("schema", async () => {
          result.schema = productionSchemaInventory(
            Array.from(await tx.unsafe(SCHEMA_TABLE_SQL, [[...SWIM_SCHEMA_TABLES]])),
            Array.from(await tx.unsafe(SCHEMA_FUNCTION_SQL, [[...SWIM_SCHEMA_FUNCTIONS]])),
            Array.from(await tx.unsafe(SCHEMA_SHARED_SQL)));
        });
        stage = "ledger";
      });
      await sql.end({ timeout: 5 }); sql = undefined; result.databaseClosed = true;
    });
    await step("completion", async () => {
      source(); requireInspection(JSON.stringify(await snapshot()) === JSON.stringify(before), "deployment_changed"); source();
    });
    result.status = "inspection_pass";
  } catch (error) {
    if (error instanceof ProductionInspectionRefusal && error.httpStatus !== undefined) result.httpStatus = error.httpStatus;
    result.stages.push({ stage, status: "failed", code: error instanceof ProductionInspectionRefusal ? error.code : "refused" });
  } finally {
    if (sql) {
      try { await sql.end({ timeout: 5 }); result.databaseClosed = true; }
      catch { result.status = "failed"; result.stages.push({ stage: "close", status: "failed", code: "close_failed" }); }
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== "--check-source")) {
    console.log("MODULAR_PRODUCTION_PREFLIGHT_REFUSED"); process.exitCode = 1; return;
  }
  const result = await inspectModularProduction(process.env, args.length === 1);
  const marker = args.length ? "MODULAR_PRODUCTION_PREFLIGHT_SOURCE" : "MODULAR_PRODUCTION_PREFLIGHT_SUMMARY";
  const summary = () => `${marker}\n<pre>${JSON.stringify(result).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>\n`;
  try { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary()); }
  catch { result.status = "failed"; result.stages.push({ stage: "report", status: "failed", code: "report_failed" }); }
  console.log(summary());
  if (result.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
