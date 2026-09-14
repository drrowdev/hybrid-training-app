import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { z } from "zod";
import { verifyRefreshSource } from "./refresh-swim-review";
import { ReviewStorageRefusal } from "./upgrade-swim-review-storage";
import { parseMigrationScid, type MigrationDiagnostic } from "./migrate-evidence";
import {
  PRODUCTION, PRODUCTION_ROUTES, ProductionInspectionRefusal, requireInspection, productionDatabaseUrl,
  productionAlias, productionDeployment, productionDeploymentRoute, productionSettings,
} from "./swim-production-readonly-guards";
import {
  PRODUCTION_UPDATE, productionUpdateContext, productionUpdateDispatch, requireSwimmingDisabled,
  productionGitHubDeploymentsRoute, productionGitHubStatusRoute, productionVercelDeploymentIds, successfulProductionStatus,
} from "./swim-production-update-guards";
import {
  appendProductionSwimming, productionSwimmingMigrations, PRODUCTION_SWIM_BASELINE, type ProductionUpdateProgress,
} from "./swim-production-update-storage";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const record = z.record(z.unknown());
export async function updateProductionSwimming(env: NodeJS.ProcessEnv, sourceOnly = false) {
  const progress: ProductionUpdateProgress = {
    attemptedMigrations: 0, stagedMigrations: 0, commitAttempted: false, commitConfirmed: false,
  };
  const result = {
    scope: "swim-production-update", testedSha: /^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA : null,
    run: /^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? "") ? env.GITHUB_RUN_ID : null,
    project: PRODUCTION.project, alias: PRODUCTION.alias, referenceSha: PRODUCTION_UPDATE.reference.sha,
    referenceRun: PRODUCTION_UPDATE.reference.run, baseline: PRODUCTION_SWIM_BASELINE,
    status: "failed", stages: [] as { stage: string; status: "passed" | "failed"; code: string }[],
    progress, databaseConnectionAttempted: false, databaseClosed: false, httpRequests: 0,
    httpStatus: null as number | null, databaseCode: null as string | null,
    migrationDiagnostic: null as MigrationDiagnostic | null,
    completionAcl: { attempted: false, staged: false, verified: false },
    legacyExceptionsAcknowledged: false, manualReconciliation: false,
    gitHubDeploymentId: null as number | null, deployment: null as ReturnType<typeof productionDeployment> | null,
    ledger: null as { entries: number; retainedEntries: number; appendedEntries: number } | null,
  };
  const deadline = Date.now() + 180_000;
  let stage = "source", sql: postgres.Sql | undefined, deploymentId: string | undefined;
  const allowedGitHub = new Set<string>();
  const time = () => requireInspection(Date.now() < deadline, "deadline");
  const step = async (name: string, action: () => Promise<void> | void) => {
    stage = name; time(); await action(); time();
    result.stages.push({ stage: name, status: "passed", code: "passed" });
  };
  const source = () => {
    productionUpdateContext(env);
    verifyRefreshSource(env, {
      git: (...args) => {
        time();
        return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 15_000,
          env: { PATH: env.PATH ?? "", HOME: env.HOME ?? "", NODE_ENV: "production" },
          maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).trim();
      },
      event: () => {
        const path = env.GITHUB_EVENT_PATH;
        requireInspection(path && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() &&
          lstatSync(path).size <= 2 * 1024 * 1024, "event");
        const event = record.parse(JSON.parse(readFileSync(path, "utf8")));
        requireInspection(productionUpdateDispatch(record.parse(event.inputs), env), "event");
        return event;
      },
      regular: (path) => path.split("/").every((_, index, parts) => {
        const entry = lstatSync(resolve(root, ...parts.slice(0, index + 1)));
        return !entry.isSymbolicLink() && (index === parts.length - 1 ? entry.isFile() : entry.isDirectory());
      }),
    }, PRODUCTION_UPDATE);
    time();
  };
  const request = async (url: string, provider: "github" | "vercel") => {
    time();
    const vercelRoutes: string[] = [...Object.values(PRODUCTION_ROUTES),
      ...(deploymentId ? [productionDeploymentRoute(deploymentId)] : [])];
    requireInspection(++result.httpRequests <= 24 &&
      (provider === "github" ? allowedGitHub.has(url) : vercelRoutes.includes(url)), "http_boundary");
    const response = await fetch(url, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(Math.min(15_000, deadline - Date.now())),
      headers: { Authorization: `Bearer ${provider === "github" ? env.GH_TOKEN : env.VERCEL_REVIEW_TOKEN}`,
        ...(provider === "github" ? { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } : {}) },
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
    time();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
  };
  const snapshot = async () => {
    const project = await request(PRODUCTION_ROUTES.project, "vercel");
    const projectEnv = await request(PRODUCTION_ROUTES.projectEnv, "vercel");
    const sharedEnv = await request(PRODUCTION_ROUTES.sharedEnv, "vercel");
    const settings = productionSettings(project, projectEnv, sharedEnv);
    requireSwimmingDisabled(settings);
    const alias = productionAlias(await request(PRODUCTION_ROUTES.alias, "vercel"));
    requireInspection(deploymentId === undefined || deploymentId === alias.deploymentId, "alias_changed");
    deploymentId = alias.deploymentId;
    const deployment = productionDeployment(await request(productionDeploymentRoute(deploymentId), "vercel"),
      deploymentId, env.EXPECTED_SHA!);
    return { settings, deployment };
  };
  try {
    await step("source", source);
    const migrations = productionSwimmingMigrations();
    result.legacyExceptionsAcknowledged = true;
    if (sourceOnly) { result.status = "source_pass"; return result; }
    let url = "";
    await step("credentials", () => {
      url = productionDatabaseUrl(env.SUPABASE_PROD_DB_URL);
      for (const value of [env.GH_TOKEN, env.VERCEL_REVIEW_TOKEN]) {
        requireInspection(typeof value === "string" && value.length >= 20 && value.length <= 2048 &&
          !/[\s\x00-\x1f\x7f]/.test(value), "credentials");
      }
    });
    let before: Awaited<ReturnType<typeof snapshot>>;
    await step("deployment", async () => {
      const route = productionGitHubDeploymentsRoute(env.EXPECTED_SHA!);
      allowedGitHub.add(route);
      const ids = productionVercelDeploymentIds(await request(route, "github"), env.EXPECTED_SHA!);
      for (const id of ids) {
        const statusRoute = productionGitHubStatusRoute(id); allowedGitHub.add(statusRoute);
        if (successfulProductionStatus(await request(statusRoute, "github"))) { result.gitHubDeploymentId = id; break; }
      }
      requireInspection(result.gitHubDeploymentId !== null, "deployment_evidence");
      before = await snapshot(); result.deployment = before.deployment;
      source();
    });
    await step("append", async () => {
      result.databaseConnectionAttempted = true;
      sql = postgres(url, { max: 1, prepare: false, ssl: "require", connect_timeout: 10, onnotice: () => {},
        connection: { statement_timeout: 60_000, lock_timeout: 5_000, idle_in_transaction_session_timeout: 90_000,
          client_min_messages: "error", row_security: "on", application_name: "swim-production-update" },
      });
      const literal = (value: string) => value;
      for (const type of [1184, 1082, 1083, 1114]) {
        sql.options.parsers[type] = literal; sql.options.serializers[type] = literal;
      }
      sql.options.serializers[114] = literal; sql.options.serializers[3802] = literal;
      result.ledger = await appendProductionSwimming(sql, migrations, async (phase) => {
        source();
        if (phase === "before_commit") {
          requireInspection(JSON.stringify(await snapshot()) === JSON.stringify(before), "deployment_changed");
          requireInspection(successfulProductionStatus(await request(
            productionGitHubStatusRoute(result.gitHubDeploymentId!), "github")), "deployment_evidence");
          source();
        }
      }, progress, PRODUCTION_SWIM_BASELINE, result.completionAcl);
      await sql.end({ timeout: 5 }); sql = undefined; result.databaseClosed = true;
    });
    await step("completion", source);
    result.status = "update_pass";
  } catch (error) {
    if (error instanceof ProductionInspectionRefusal && error.httpStatus !== undefined) result.httpStatus = error.httpStatus;
    if (stage === "append" && error instanceof Error) {
      result.migrationDiagnostic = parseMigrationScid(Object.getOwnPropertyDescriptor(error, "message")?.value) ?? null;
      const code: unknown = Object.getOwnPropertyDescriptor(error, "code")?.value;
      if (typeof code === "string" && (/^[0-9A-Z]{5}$/.test(code) ||
        ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "CONNECT_TIMEOUT", "CONNECTION_CLOSED"].includes(code))) result.databaseCode = code;
    }
    result.stages.push({ stage, status: "failed",
      code: error instanceof ProductionInspectionRefusal || error instanceof ReviewStorageRefusal ? error.code : "refused" });
  } finally {
    if (sql) {
      try { await sql.end({ timeout: 5 }); result.databaseClosed = true; }
      catch { result.status = "failed"; result.stages.push({ stage: "close", status: "failed", code: "close_failed" }); }
    }
    result.manualReconciliation = result.status === "failed" && progress.attemptedMigrations > 0;
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== "--check-source")) {
    console.log("SWIM_PRODUCTION_UPDATE_REFUSED"); process.exitCode = 1; return;
  }
  const result = await updateProductionSwimming(process.env, args.length === 1);
  const marker = args.length ? "SWIM_PRODUCTION_UPDATE_SOURCE" : "SWIM_PRODUCTION_UPDATE_SUMMARY";
  const summary = () => `${marker}\n<pre>${JSON.stringify(result).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>\n`;
  try { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary()); }
  catch { result.status = "failed"; result.manualReconciliation = result.progress.attemptedMigrations > 0;
    result.stages.push({ stage: "report", status: "failed", code: "report_failed" }); }
  console.log(summary()); if (result.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
