import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { z } from "zod";
import { verifyRefreshSource } from "./refresh-swim-review";
import {
  PRODUCTION, PRODUCTION_ROUTES, ProductionInspectionRefusal, productionProfile,
  productionContext, productionDispatch, productionDatabaseUrl, productionRequestAllowed, productionAlias,
  productionDeploymentRoute, productionDeployment, productionSettings, productionLedger, productionLedgerDiagnostics, requireInspection,
} from "./swim-production-readonly-guards";
import {
  historicalMigrationHashes, productionHistoryInventory, productionSchemaInventory,
  SCHEMA_TABLE_SQL, SCHEMA_FUNCTION_SQL, SCHEMA_SHARED_SQL, SWIM_SCHEMA_TABLES, SWIM_SCHEMA_FUNCTIONS,
} from "./swim-production-reconciliation";
import { POST_UPDATE_CATALOG_SQL, productionPostUpdateInventory } from "./swim-production-post-update";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const jsonRecord = z.record(z.unknown());
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export async function inspectProduction(env: NodeJS.ProcessEnv, sourceOnly = false) {
  const postUpdate = env.PRODUCTION_READONLY_SCOPE === "post_update";
  const reconciliation = postUpdate || env.PRODUCTION_READONLY_SCOPE === "reconciliation", profile = productionProfile(env);
  const mainSha = profile.expectedMain ?? PRODUCTION.main;
  const result = {
    scope: postUpdate ? "swim-production-post-update" : reconciliation ? "swim-production-reconciliation" : "swim-production-readonly",
    testedSha: /^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA : null,
    run: /^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? "") ? env.GITHUB_RUN_ID : null,
    mainSha, project: PRODUCTION.project, alias: PRODUCTION.alias,
    referenceSha: profile.reference.sha, referenceRun: profile.reference.run,
    status: "failed", stages: [] as { stage: string; status: "passed" | "failed"; code: string }[],
    httpStatus: null as number | null,
    databaseCode: null as string | null,
    databaseReadAttempted: false, databaseClosed: false, httpRequests: 0, writesAttempted: false,
    deployment: null as ReturnType<typeof productionDeployment> | null,
    settings: null as ReturnType<typeof productionSettings> | null,
    ledger: null as ReturnType<typeof productionLedger> | null,
    ledgerDiagnostics: null as ReturnType<typeof productionLedgerDiagnostics> | null,
    inventory: null as ReturnType<typeof productionHistoryInventory> | null,
    schema: null as ReturnType<typeof productionSchemaInventory> | null,
    ...(postUpdate ? { postUpdate: null as ReturnType<typeof productionPostUpdateInventory> | null } : {}),
  };
  const deadline = Date.now() + 180_000;
  let stage = "source", deploymentId: string | undefined, sql: postgres.Sql | undefined;
  const gitBytes = (args: string[], input?: string) => {
    requireInspection(Date.now() < deadline, "deadline");
    return execFileSync("git", args, { cwd: root, timeout: 15_000, input,
      env: { PATH: env.PATH ?? "", HOME: env.HOME ?? "", NODE_ENV: "production" },
      maxBuffer: 2 * 1024 * 1024, stdio: ["pipe", "pipe", "ignore"] });
  };
  const step = async (name: string, action: () => Promise<void> | void) => {
    stage = name; requireInspection(Date.now() < deadline, "deadline"); await action();
    requireInspection(Date.now() < deadline, "deadline");
    result.stages.push({ stage: name, status: "passed", code: "passed" });
  };
  const source = () => {
    productionContext(env);
    verifyRefreshSource(env, {
      git: (...args) => gitBytes(args).toString("utf8").trim(),
      event: () => {
        const path = env.GITHUB_EVENT_PATH;
        requireInspection(path && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() &&
          lstatSync(path).size <= 2 * 1024 * 1024, "event");
        const event = jsonRecord.parse(JSON.parse(readFileSync(path, "utf8")));
        requireInspection(productionDispatch(jsonRecord.parse(event.inputs), env), "event");
        return event;
      },
      regular: (path) => path.split("/").every((_, index, parts) => {
        const entry = lstatSync(resolve(root, ...parts.slice(0, index + 1)));
        return !entry.isSymbolicLink() && (index === parts.length - 1 ? entry.isFile() : entry.isDirectory());
      }),
    }, profile);
  };
  const request = async (url: string) => {
    requireInspection(Date.now() < deadline && ++result.httpRequests <= 12 &&
      productionRequestAllowed(url, "GET", undefined, deploymentId), "http_boundary");
    const response = await fetch(url, { method: "GET", redirect: "error",
      signal: AbortSignal.timeout(Math.min(15_000, deadline - Date.now())),
      headers: { Authorization: ["Bearer", env.VERCEL_REVIEW_TOKEN].join(" ") },
    });
    if (!response.ok) { await response.body?.cancel(); throw new ProductionInspectionRefusal("http_status", response.status); }
    const reader = response.body?.getReader();
    requireInspection(reader, "http_body");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 1024 * 1024) { await reader.cancel(); throw new ProductionInspectionRefusal("http_size"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
  };
  const snapshot = async () => {
    const project = await request(PRODUCTION_ROUTES.project);
    const projectEnv = await request(PRODUCTION_ROUTES.projectEnv), sharedEnv = await request(PRODUCTION_ROUTES.sharedEnv);
    const alias = productionAlias(await request(PRODUCTION_ROUTES.alias));
    if (deploymentId !== undefined) requireInspection(alias.deploymentId === deploymentId, "alias_changed");
    deploymentId = alias.deploymentId;
    return { settings: productionSettings(project, projectEnv, sharedEnv),
      deployment: productionDeployment(await request(productionDeploymentRoute(deploymentId)), deploymentId, mainSha) };
  };
  try {
    await step("source", source);
    let history: ReturnType<typeof historicalMigrationHashes> | undefined;
    if (reconciliation) await step("source_history", () => { history = historicalMigrationHashes(gitBytes); });
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
      source();
      const expected = readMigrationFiles({ migrationsFolder: resolve(root, "packages/db/drizzle") });
      requireInspection(expected.length === PRODUCTION.candidateCount, "source_journal");
      sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: "require", connect_timeout: 10, onnotice: () => {},
        connection: { default_transaction_read_only: true, statement_timeout: 10_000, lock_timeout: 5_000,
          idle_in_transaction_session_timeout: 15_000, client_min_messages: "error", application_name: "swim-production-readonly" },
      });
      result.databaseReadAttempted = true;
      result.ledger = await sql.begin(async (tx) => {
        await tx.unsafe("SET TRANSACTION READ ONLY");
        if (reconciliation) {
          await tx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
          requireInspection(history, "history_shape");
          const journal = z.object({ entries: z.array(z.object({
            tag: z.string().regex(/^\d{4}_[A-Za-z0-9_-]+$/),
          })).length(PRODUCTION.candidateCount) }).parse(JSON.parse(
            readFileSync(resolve(root, "packages/db/drizzle/meta/_journal.json"), "utf8")));
          const sourceEntries = expected.map((entry, index) => ({ ...entry, tag: journal.entries[index]!.tag }));
          const rows = await tx.unsafe("SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 512");
          result.inventory = productionHistoryInventory(Array.from(rows), sourceEntries, history);
          requireInspection(result.inventory.complete, "ledger_inventory_limit");
          await step("schema", async () => {
            const tables = await tx.unsafe(SCHEMA_TABLE_SQL, [[...SWIM_SCHEMA_TABLES]]);
            const functions = await tx.unsafe(SCHEMA_FUNCTION_SQL, [[...SWIM_SCHEMA_FUNCTIONS]]);
            const shared = await tx.unsafe(SCHEMA_SHARED_SQL);
            result.schema = productionSchemaInventory(Array.from(tables), Array.from(functions), Array.from(shared));
          });
          if (postUpdate) await step("post_update", async () => {
            requireInspection(result.inventory && result.schema, "post_update_shape");
            const rows = await tx.unsafe(POST_UPDATE_CATALOG_SQL);
            result.postUpdate = productionPostUpdateInventory(Array.from(rows), result.inventory, result.schema);
          });
          stage = "ledger";
          return null;
        }
        const rows = await tx.unsafe("SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 156");
        result.ledgerDiagnostics = productionLedgerDiagnostics(Array.from(rows), expected);
        return productionLedger(Array.from(rows), expected);
      });
      await sql.end({ timeout: 5 }); sql = undefined; result.databaseClosed = true;
    });
    await step("completion", async () => {
      source(); requireInspection(equal(await snapshot(), before), "deployment_changed"); source();
    });
    result.status = postUpdate ? "post_update_pass" : reconciliation ? "reconciliation_pass" : "inspection_pass";
  } catch (error) {
    if (error instanceof ProductionInspectionRefusal && error.httpStatus !== undefined) result.httpStatus = error.httpStatus;
    if (["ledger", "schema", "post_update"].includes(stage) && error instanceof Error) {
      const code: unknown = Object.getOwnPropertyDescriptor(error, "code")?.value;
      if (typeof code === "string" && (/^[0-9A-Z]{5}$/.test(code) ||
        ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "CONNECT_TIMEOUT", "CONNECTION_CLOSED"].includes(code))) {
        result.databaseCode = code;
      }
    }
    result.stages.push({ stage, status: "failed",
      code: error instanceof ProductionInspectionRefusal ? error.code : "refused" });
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
    console.log("SWIM_PRODUCTION_READONLY_REFUSED"); process.exitCode = 1; return;
  }
  const result = await inspectProduction(process.env, args.length === 1);
  const marker = args.length ? "SWIM_PRODUCTION_READONLY_SOURCE" : result.scope === "swim-production-post-update"
    ? "SWIM_PRODUCTION_POST_UPDATE_SUMMARY" : result.scope === "swim-production-reconciliation"
      ? "SWIM_PRODUCTION_RECONCILIATION_SUMMARY" : "SWIM_PRODUCTION_READONLY_SUMMARY";
  const summary = () => `${marker}\n<pre>${JSON.stringify(result).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>\n`;
  try { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary()); }
  catch { result.status = "failed"; result.stages.push({ stage: "report", status: "failed", code: "report_failed" }); }
  console.log(summary()); if (result.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
