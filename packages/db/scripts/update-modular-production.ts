import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { z } from "zod";
import { MODULAR_PREFLIGHT, MODULAR_DISABLED_OPERATIONS } from "./modular-production-preflight-guards";
import {
  PRODUCTION, PRODUCTION_ROUTES, ProductionInspectionRefusal, requireInspection, productionDatabaseUrl,
  productionAlias, productionDeployment, productionDeploymentRoute, productionSettings,
} from "./swim-production-readonly-guards";
import { appendModularProduction, modularUpdateMigrations } from "./modular-production-update-storage";

export const MODULAR_UPDATE_INPUT = "update_modular_production";
export function modularUpdateDispatch(inputs: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (inputs?.[MODULAR_UPDATE_INPUT] !== "true") return false;
  requireInspection(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === "drrowdev/hybrid-training-app" && env.GITHUB_REF_TYPE === "branch" &&
    env.GITHUB_REF === "refs/heads/main" &&
    typeof inputs.expected_sha === "string" && /^[a-f0-9]{40}$/.test(inputs.expected_sha) &&
    inputs.expected_sha === env.GITHUB_SHA && inputs.expected_sha !== MODULAR_PREFLIGHT.main &&
    inputs.inspect_swim_production === "false" && inputs.review_upgrade_read_only === "false" &&
    inputs.production_readonly_scope === "preflight" &&
    MODULAR_DISABLED_OPERATIONS.filter((key) => key !== MODULAR_UPDATE_INPUT).every((key) => inputs[key] === "false") &&
    Object.keys(inputs).every((key) => [MODULAR_UPDATE_INPUT, ...MODULAR_DISABLED_OPERATIONS,
      "inspect_swim_production", "review_upgrade_read_only", "production_readonly_scope", "expected_sha"].includes(key)), "dispatch");
  return true;
}

export function modularMergeCandidate(parents: string, sha: string, mainTree: string, sourceTree: string) {
  const fields = parents.split(" ");
  requireInspection(fields.length === 3 && fields[0] === sha && fields[1] === MODULAR_PREFLIGHT.main &&
    /^[a-f0-9]{40}$/.test(fields[2]!) && fields[2] !== fields[1] &&
    /^[a-f0-9]{40}$/.test(mainTree) && mainTree === sourceTree, "reviewed_merge");
  return fields[2]!;
}

export function modularQualifiedRun(raw: unknown, workflow: number, sha: string) {
  const parsed = z.object({ workflow_runs: z.array(z.object({
    id: z.number().int().positive(), workflow_id: z.literal(workflow), head_sha: z.literal(sha),
    head_branch: z.literal(MODULAR_PREFLIGHT.branch), status: z.literal("completed"),
    conclusion: z.literal("success"), run_attempt: z.literal(1),
  }).passthrough()).min(1).max(10) }).safeParse(raw);
  requireInspection(parsed.success, "qualification_run");
  return parsed.data.workflow_runs[0]!.id;
}

export function modularQualifiedJobs(raw: unknown, run: number, sha: string, required: readonly string[]) {
  const parsed = z.object({ jobs: z.array(z.object({
    run_id: z.literal(run), head_sha: z.literal(sha), name: z.string(), status: z.string(),
    conclusion: z.string().nullable(),
  }).passthrough()).max(100) }).safeParse(raw);
  requireInspection(parsed.success && required.every((name) => {
    const matches = parsed.data.jobs.filter((job) => job.name === name);
    return matches.length === 1 && matches[0]!.status === "completed" && matches[0]!.conclusion === "success";
  }), "qualification_jobs");
}

export async function modularQualifiedNativeRun(raw: unknown, sha: string, jobs: (run: number) => Promise<unknown>) {
  const parsed = z.object({ workflow_runs: z.array(z.object({
    id: z.number().int().positive(), workflow_id: z.literal(279507729), head_sha: z.literal(sha),
    head_branch: z.literal(MODULAR_PREFLIGHT.branch), status: z.literal("completed"),
  }).passthrough()).min(1).max(10) }).safeParse(raw);
  requireInspection(parsed.success, "qualification_run");
  for (const candidate of parsed.data.workflow_runs) {
    const result = await jobs(candidate.id);
    const jobList = z.object({ jobs: z.array(z.object({
      run_id: z.literal(candidate.id), head_sha: z.literal(sha), name: z.string(),
      conclusion: z.string().nullable(),
    }).passthrough()).max(100) }).safeParse(result);
    requireInspection(jobList.success, "qualification_jobs");
    const native = jobList.data.jobs.filter((job) => job.name === "disposable swim RPC and browser acceptance");
    requireInspection(native.length <= 1, "qualification_jobs");
    if (native.length === 0 || native[0]!.conclusion === "skipped") continue;
    const id = modularQualifiedRun({ workflow_runs: [candidate] }, 279507729, sha);
    modularQualifiedJobs(result, id, sha,
      ["author identity guard", "lint + typecheck + test + build", "disposable swim RPC and browser acceptance"]);
    return id;
  }
  requireInspection(false, "qualification_run");
}

export function requireModularProductionBindings(settings: ReturnType<typeof productionSettings>) {
  requireInspection(settings.valuesRead === false && settings.flags.length === 7 &&
    new Set(settings.flags.map((flag) => flag.key)).size === 7 && settings.flags.every((flag) =>
    flag.configured === !["ENABLE_E2E_FIXTURES", "NEXT_PUBLIC_BUILD_SHA"].includes(flag.key)), "production_bindings");
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export async function updateModularProduction(env: NodeJS.ProcessEnv, sourceOnly = false) {
  const result = {
    scope: "modular-production-update",
    testedSha: /^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA : null,
    run: /^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? "") ? env.GITHUB_RUN_ID : null,
    project: PRODUCTION.project, alias: PRODUCTION.alias, candidateSha: null as string | null,
    status: "failed", stages: [] as { stage: string; status: "passed" | "failed"; code: string }[],
    progress: { attemptedMigrations: 0, stagedMigrations: 0, commitAttempted: false, commitConfirmed: false },
    qualification: null as { native: number; storage: number } | null,
    databaseConnectionAttempted: false, databaseClosed: false, manualReconciliation: false,
    httpRequests: 0, httpStatus: null as number | null, databaseCode: null as string | null,
    deployment: null as ReturnType<typeof productionDeployment> | null,
    ledger: null as Awaited<ReturnType<typeof appendModularProduction>> | null,
  };
  let stage = "source", sql: postgres.Sql | undefined, deploymentId: string | undefined;
  const deadline = Date.now() + 180_000;
  const time = () => requireInspection(Date.now() < deadline, "deadline");
  const step = async (name: string, action: () => Promise<void> | void) => {
    stage = name; time(); await action(); time(); result.stages.push({ stage: name, status: "passed", code: "passed" });
  };
  const git = (...args: string[]) => {
    time();
    return execFileSync("git", args, { cwd: root, timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: env.PATH ?? "", HOME: env.HOME ?? "" }, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8").trim();
  };
  const source = () => {
    requireInspection(env.GITHUB_ACTIONS === "true" && env.GITHUB_JOB === "update-modular-production" &&
      env.GITHUB_RUN_ATTEMPT === "1" && /^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? "") &&
      env.RUNNER_ENVIRONMENT === "github-hosted" && env.RUNNER_OS === "Linux" && env.RUNNER_ARCH === "X64" &&
      env.GITHUB_WORKFLOW_REF === "drrowdev/hybrid-training-app/.github/workflows/ci.yml@refs/heads/main" &&
      env.GITHUB_WORKFLOW_SHA === env.EXPECTED_SHA, "context");
    const path = env.GITHUB_EVENT_PATH;
    requireInspection(path && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && lstatSync(path).size <= 2 * 1024 * 1024, "event");
    const inputs = z.record(z.unknown()).parse(z.record(z.unknown()).parse(JSON.parse(readFileSync(path, "utf8"))).inputs);
    requireInspection(modularUpdateDispatch(inputs, env) && env.EXPECTED_SHA === inputs.expected_sha, "context");
    const sha = env.EXPECTED_SHA!;
    requireInspection(git("rev-parse", "HEAD") === sha && git("status", "--porcelain", "--untracked-files=all") === "", "checkout");
    const candidate = modularMergeCandidate(git("rev-list", "--parents", "-n", "1", "HEAD"), sha,
      git("rev-parse", "HEAD^{tree}"), git("rev-parse", "HEAD^2^{tree}"));
    for (const [ref, expected] of [["refs/heads/main", sha], [`refs/heads/${MODULAR_PREFLIGHT.branch}`, candidate]]) {
      requireInspection(git("ls-remote", "--exit-code", "https://github.com/drrowdev/hybrid-training-app.git", ref!) === `${expected}\t${ref}`, "live_ref");
    }
    const journal = z.object({ entries: z.array(z.unknown()).length(159) }).parse(
      JSON.parse(readFileSync(resolve(root, "packages/db/drizzle/meta/_journal.json"), "utf8")));
    const before = z.object({ entries: z.array(z.unknown()).length(156) }).parse(
      JSON.parse(git("show", `${MODULAR_PREFLIGHT.main}:packages/db/drizzle/meta/_journal.json`)));
    requireInspection(JSON.stringify(journal.entries.slice(0, 156)) === JSON.stringify(before.entries), "source_journal");
    const prior = new Set(git("ls-tree", "-r", "--name-only", MODULAR_PREFLIGHT.main, "--", "packages/db/drizzle").split("\n"));
    requireInspection(git("diff", "--name-only", MODULAR_PREFLIGHT.main, "HEAD", "--", "packages/db/drizzle")
      .split("\n").every((path) => !path || path === "packages/db/drizzle/meta/_journal.json" || !prior.has(path)), "applied_migration_changed");
    result.candidateSha = candidate;
    return candidate;
  };
  const allowedGitHub = new Set<string>();
  const request = async (url: string, github = false) => {
    time();
    const allowedVercel: string[] = [...Object.values(PRODUCTION_ROUTES), ...(deploymentId ? [productionDeploymentRoute(deploymentId)] : [])];
    requireInspection(++result.httpRequests <= 24 && (github ? allowedGitHub.has(url) : allowedVercel.includes(url)), "http_boundary");
    const response = await fetch(url, { method: "GET", redirect: "error",
      signal: AbortSignal.timeout(Math.min(15_000, deadline - Date.now())),
      headers: { Authorization: ["Bearer", github ? env.GH_TOKEN : env.VERCEL_REVIEW_TOKEN].join(" ") },
    });
    if (!response.ok) { await response.body?.cancel(); throw new ProductionInspectionRefusal("http_status", response.status); }
    const reader = response.body?.getReader(); requireInspection(reader, "http_body");
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
  const github = (path: string) => {
    const url = `https://api.github.com/repos/drrowdev/hybrid-training-app/${path}`;
    allowedGitHub.add(url); return request(url, true);
  };
  const snapshot = async () => {
    const project = await request(PRODUCTION_ROUTES.project), projectEnv = await request(PRODUCTION_ROUTES.projectEnv);
    const sharedEnv = await request(PRODUCTION_ROUTES.sharedEnv);
    const alias = productionAlias(await request(PRODUCTION_ROUTES.alias));
    requireInspection(deploymentId === undefined || alias.deploymentId === deploymentId, "alias_changed");
    deploymentId = alias.deploymentId;
    const settings = productionSettings(project, projectEnv, sharedEnv);
    requireModularProductionBindings(settings);
    return { settings,
      deployment: productionDeployment(await request(productionDeploymentRoute(deploymentId)), deploymentId, env.EXPECTED_SHA!) };
  };
  try {
    await step("source", () => { source(); modularUpdateMigrations(); });
    if (sourceOnly) { result.status = "source_pass"; return result; }
    let databaseUrl = "";
    await step("credentials", () => {
      databaseUrl = productionDatabaseUrl(env.SUPABASE_PROD_DB_URL);
      for (const value of [env.GH_TOKEN, env.VERCEL_REVIEW_TOKEN]) requireInspection(typeof value === "string" &&
        value.length >= 20 && value.length <= 2048 && !/[\s\x00-\x1f\x7f]/.test(value), "credentials");
    });
    await step("qualification", async () => {
      const sha = result.candidateSha!;
      const native = await modularQualifiedNativeRun(
        await github(`actions/workflows/279507729/runs?head_sha=${sha}&event=workflow_dispatch&per_page=10`), sha,
        (run) => github(`actions/runs/${run}/jobs?per_page=100`));
      const storage = modularQualifiedRun(await github(`actions/workflows/356499149/runs?head_sha=${sha}&per_page=10`), 356499149, sha);
      modularQualifiedJobs(await github(`actions/runs/${storage}/jobs?per_page=100`), storage, sha, ["storage", "pool-storage"]);
      result.qualification = { native, storage };
    });
    let before: Awaited<ReturnType<typeof snapshot>>;
    await step("deployment", async () => { before = await snapshot(); result.deployment = before.deployment; source(); });
    await step("append", async () => {
      result.databaseConnectionAttempted = true;
      sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: "require", connect_timeout: 10, onnotice: () => {},
        connection: { statement_timeout: 60_000, lock_timeout: 5_000, idle_in_transaction_session_timeout: 90_000,
          client_min_messages: "error", row_security: "on", application_name: "modular-production-update" },
      });
      result.ledger = await appendModularProduction(sql, modularUpdateMigrations(), async (phase) => {
        source();
        if (phase === "before_commit") {
          requireInspection(JSON.stringify(await snapshot()) === JSON.stringify(before), "deployment_changed");
          source();
        }
      }, result.progress);
      await sql.end({ timeout: 5 }); sql = undefined; result.databaseClosed = true;
    });
    await step("completion", () => { source(); }); result.status = "update_pass";
  } catch (error) {
    if (error instanceof ProductionInspectionRefusal && error.httpStatus !== undefined) result.httpStatus = error.httpStatus;
    if (stage === "append" && error instanceof Error) {
      const code: unknown = Object.getOwnPropertyDescriptor(error, "code")?.value;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) result.databaseCode = code;
    }
    result.stages.push({ stage, status: "failed", code: error instanceof ProductionInspectionRefusal ? error.code : "refused" });
  } finally {
    if (sql) {
      try { await sql.end({ timeout: 5 }); result.databaseClosed = true; }
      catch { result.status = "failed"; result.stages.push({ stage: "close", status: "failed", code: "close_failed" }); }
    }
    result.manualReconciliation = result.status === "failed" && result.progress.attemptedMigrations > 0;
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== "--check-source")) {
    console.log("MODULAR_PRODUCTION_UPDATE_REFUSED"); process.exitCode = 1; return;
  }
  const result = await updateModularProduction(process.env, args.length === 1);
  const marker = args.length ? "MODULAR_PRODUCTION_UPDATE_SOURCE" : "MODULAR_PRODUCTION_UPDATE_SUMMARY";
  const summary = () => `${marker}\n<pre>${JSON.stringify(result).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre>\n`;
  try { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary()); }
  catch { result.status = "failed"; result.manualReconciliation = result.progress.attemptedMigrations > 0;
    result.stages.push({ stage: "report", status: "failed", code: "report_failed" }); }
  console.log(summary()); if (result.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
